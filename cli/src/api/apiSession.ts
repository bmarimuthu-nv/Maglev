import { EventEmitter } from 'node:events'
import { io, type Socket } from 'socket.io-client'
import type { ZodType } from 'zod'
import { logger } from '@/ui/logger'
import { backoff } from '@/utils/time'
import { AsyncLock } from '@/utils/lock'
import { configuration } from '@/configuration'
import type { ClientToServerEvents, ServerToClientEvents, Update } from '@maglev/protocol'
import {
    TerminalClosePayloadSchema,
    TerminalOpenPayloadSchema,
    TerminalResizePayloadSchema,
    TerminalWritePayloadSchema
} from '@maglev/protocol'
import type {
    AgentState,
    Metadata,
    Session,
    SessionModel,
    SessionPermissionMode
} from './types'
import { AgentStateSchema, MetadataSchema } from './types'
import { RpcHandlerManager } from './rpc/RpcHandlerManager'
import { registerCommonHandlers } from '../modules/common/registerCommonHandlers'
import { cleanupUploadDir } from '../modules/common/handlers/uploads'
import { TerminalManager } from '@/terminal/TerminalManager'
import { applyVersionedAck } from './versionedUpdate'

export class ApiSessionClient extends EventEmitter {
    private readonly token: string
    readonly sessionId: string
    private metadata: Metadata | null
    private metadataVersion: number
    private agentState: AgentState | null
    private agentStateVersion: number
    private readonly socket: Socket<ServerToClientEvents, ClientToServerEvents>
    readonly rpcHandlerManager: RpcHandlerManager
    private readonly terminalManager: TerminalManager
    private agentStateLock = new AsyncLock()
    private metadataLock = new AsyncLock()

    constructor(token: string, session: Session) {
        super()
        this.token = token
        this.sessionId = session.id
        this.metadata = session.metadata
        this.metadataVersion = session.metadataVersion
        this.agentState = session.agentState
        this.agentStateVersion = session.agentStateVersion

        this.rpcHandlerManager = new RpcHandlerManager({
            scopePrefix: this.sessionId,
            logger: (msg, data) => logger.debug(msg, data)
        })

        if (this.metadata?.path) {
            registerCommonHandlers(this.rpcHandlerManager, this.metadata.path)
        }

        this.socket = io(`${configuration.apiUrl}/cli`, {
            auth: {
                token: this.token,
                clientType: 'session-scoped' as const,
                sessionId: this.sessionId
            },
            path: '/socket.io/',
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            transports: ['websocket'],
            autoConnect: false
        })

        this.terminalManager = new TerminalManager({
            sessionId: this.sessionId,
            getSessionPath: () => this.metadata?.path ?? null,
            getStartupCommand: () => this.metadata?.startupCommand ?? null,
            onReady: (payload) => this.socket.emit('terminal:ready', payload),
            onOutput: (payload) => this.socket.emit('terminal:output', payload),
            onExit: (payload) => this.socket.emit('terminal:exit', payload),
            onError: (payload) => this.socket.emit('terminal:error', payload)
        })

        this.socket.on('connect', () => {
            logger.debug('Socket connected successfully')
            this.rpcHandlerManager.onSocketConnect(this.socket)
            this.socket.emit('session-alive', {
                sid: this.sessionId,
                time: Date.now(),
                thinking: false
            })
        })

        this.socket.on('rpc-request', async (data: { method: string; params: string }, callback: (response: string) => void) => {
            callback(await this.rpcHandlerManager.handleRequest(data))
        })

        this.socket.on('disconnect', (reason) => {
            logger.debug('[API] Socket disconnected:', reason)
            this.rpcHandlerManager.onSocketDisconnect()
            this.terminalManager.closeAll({ preserveSessions: true })
        })

        this.socket.on('connect_error', (error) => {
            logger.debug('[API] Socket connection error:', error)
            this.rpcHandlerManager.onSocketDisconnect()
        })

        this.socket.on('error', (payload) => {
            logger.debug('[API] Socket error:', payload)
        })

        const handleTerminalEvent = <T extends { sessionId: string }>(
            schema: ZodType<T>,
            handler: (payload: T) => void
        ) => (data: unknown) => {
            const parsed = schema.safeParse(data)
            if (!parsed.success) {
                return
            }
            if (parsed.data.sessionId !== this.sessionId) {
                return
            }
            handler(parsed.data)
        }

        this.socket.on('terminal:open', handleTerminalEvent(TerminalOpenPayloadSchema, (payload) => {
            this.terminalManager.create(payload.terminalId, payload.cols, payload.rows, {
                createIfMissing: payload.createIfMissing
            })
        }))

        this.socket.on('terminal:write', handleTerminalEvent(TerminalWritePayloadSchema, (payload) => {
            this.terminalManager.write(payload.terminalId, payload.data)
        }))

        this.socket.on('terminal:resize', handleTerminalEvent(TerminalResizePayloadSchema, (payload) => {
            this.terminalManager.resize(payload.terminalId, payload.cols, payload.rows)
        }))

        this.socket.on('terminal:close', handleTerminalEvent(TerminalClosePayloadSchema, (payload) => {
            this.terminalManager.close(payload.terminalId)
        }))

        this.socket.on('update', (data: Update) => {
            try {
                if (!data.body) return

                if (data.body.t === 'update-session') {
                    if (data.body.metadata && data.body.metadata.version > this.metadataVersion) {
                        const parsed = MetadataSchema.safeParse(data.body.metadata.value)
                        if (parsed.success) {
                            this.metadata = parsed.data
                        } else {
                            logger.debug('[API] Ignoring invalid metadata update', { version: data.body.metadata.version })
                        }
                        this.metadataVersion = data.body.metadata.version
                    }
                    if (data.body.agentState && data.body.agentState.version > this.agentStateVersion) {
                        const next = data.body.agentState.value
                        if (next == null) {
                            this.agentState = null
                        } else {
                            const parsed = AgentStateSchema.safeParse(next)
                            if (parsed.success) {
                                this.agentState = parsed.data
                            } else {
                                logger.debug('[API] Ignoring invalid agentState update', { version: data.body.agentState.version })
                            }
                        }
                        this.agentStateVersion = data.body.agentState.version
                    }
                    return
                }

                this.emit('message', data.body)
            } catch (error) {
                logger.debug('[SOCKET] [UPDATE] [ERROR] Error handling update', { error })
            }
        })

        this.socket.connect()
    }

    keepAlive(
        thinking: boolean,
        mode: 'local' | 'remote',
        runtime?: {
            permissionMode?: SessionPermissionMode
            model?: SessionModel
        }
    ): void {
        this.socket.volatile.emit('session-alive', {
            sid: this.sessionId,
            time: Date.now(),
            thinking,
            mode,
            ...(runtime ?? {})
        })
    }

    sendSessionDeath(): void {
        void cleanupUploadDir(this.sessionId)
        this.socket.emit('session-end', { sid: this.sessionId, time: Date.now() })
    }

    ensureTerminal(terminalId: string, cols: number, rows: number, options?: { createIfMissing?: boolean }): void {
        this.terminalManager.create(terminalId, cols, rows, options)
    }

    checkTerminalExists(terminalId: string): { status: 'exists' | 'missing' | 'error'; message?: string } {
        const result = this.terminalManager.checkSessionExists(terminalId)
        if (result.status === 'error') {
            return { status: 'error', message: result.message }
        }
        return result
    }

    updateMetadata(handler: (metadata: Metadata) => Metadata): void {
        this.metadataLock.inLock(async () => {
            await backoff(async () => {
                const current = this.metadata ?? ({} as Metadata)
                const updated = handler(current)

                const answer = await this.socket.emitWithAck('update-metadata', {
                    sid: this.sessionId,
                    expectedVersion: this.metadataVersion,
                    metadata: updated
                }) as unknown

                applyVersionedAck(answer, {
                    valueKey: 'metadata',
                    parseValue: (value) => {
                        const parsed = MetadataSchema.safeParse(value)
                        return parsed.success ? parsed.data : null
                    },
                    applyValue: (value) => {
                        this.metadata = value
                    },
                    applyVersion: (version) => {
                        this.metadataVersion = version
                    },
                    logInvalidValue: (context, version) => {
                        const suffix = context === 'success' ? 'ack' : 'version-mismatch ack'
                        logger.debug(`[API] Ignoring invalid metadata value from ${suffix}`, { version })
                    },
                    invalidResponseMessage: 'Invalid update-metadata response',
                    errorMessage: 'Metadata update failed',
                    versionMismatchMessage: 'Metadata version mismatch'
                })
            })
        })
    }

    updateAgentState(handler: (state: AgentState) => AgentState): void {
        this.agentStateLock.inLock(async () => {
            await backoff(async () => {
                const current = this.agentState ?? ({} as AgentState)
                const updated = handler(current)

                const answer = await this.socket.emitWithAck('update-state', {
                    sid: this.sessionId,
                    expectedVersion: this.agentStateVersion,
                    agentState: updated
                }) as unknown

                applyVersionedAck(answer, {
                    valueKey: 'agentState',
                    parseValue: (value) => {
                        const parsed = AgentStateSchema.safeParse(value)
                        return parsed.success ? parsed.data : null
                    },
                    applyValue: (value) => {
                        this.agentState = value
                    },
                    applyVersion: (version) => {
                        this.agentStateVersion = version
                    },
                    logInvalidValue: (context, version) => {
                        const suffix = context === 'success' ? 'ack' : 'version-mismatch ack'
                        logger.debug(`[API] Ignoring invalid agentState value from ${suffix}`, { version })
                    },
                    invalidResponseMessage: 'Invalid update-state response',
                    errorMessage: 'Agent state update failed',
                    versionMismatchMessage: 'Agent state version mismatch'
                })
            })
        })
    }

    private async waitForConnected(timeoutMs: number): Promise<boolean> {
        if (this.socket.connected) {
            return true
        }

        this.socket.connect()

        return await new Promise<boolean>((resolve) => {
            let settled = false

            const cleanup = () => {
                this.socket.off('connect', onConnect)
                clearTimeout(timeout)
            }

            const onConnect = () => {
                if (settled) return
                settled = true
                cleanup()
                resolve(true)
            }

            const timeout = setTimeout(() => {
                if (settled) return
                settled = true
                cleanup()
                resolve(false)
            }, Math.max(0, timeoutMs))

            this.socket.on('connect', onConnect)
        })
    }

    private async drainLock(lock: AsyncLock, timeoutMs: number): Promise<boolean> {
        if (timeoutMs <= 0) {
            return false
        }

        return await new Promise<boolean>((resolve) => {
            let settled = false
            let timeout: ReturnType<typeof setTimeout> | null = null

            const finish = (value: boolean) => {
                if (settled) return
                settled = true
                if (timeout) {
                    clearTimeout(timeout)
                }
                resolve(value)
            }

            timeout = setTimeout(() => finish(false), timeoutMs)

            lock.inLock(async () => { })
                .then(() => finish(true))
                .catch(() => finish(false))
        })
    }

    async flush(options?: { timeoutMs?: number }): Promise<void> {
        const deadlineMs = Date.now() + (options?.timeoutMs ?? 5_000)

        const remainingMs = () => Math.max(0, deadlineMs - Date.now())

        await this.drainLock(this.metadataLock, remainingMs())
        await this.drainLock(this.agentStateLock, remainingMs())

        if (remainingMs() === 0) {
            return
        }

        const connected = await this.waitForConnected(remainingMs())
        if (!connected) {
            return
        }

        const pingTimeoutMs = remainingMs()
        if (pingTimeoutMs === 0) {
            return
        }

        try {
            await this.socket.timeout(pingTimeoutMs).emitWithAck('ping')
        } catch {
            // best effort
        }
    }

    close(): void {
        this.rpcHandlerManager.onSocketDisconnect()
        this.terminalManager.closeAll()
        this.socket.disconnect()
    }
}
