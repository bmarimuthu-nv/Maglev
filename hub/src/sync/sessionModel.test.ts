import { describe, expect, it } from 'bun:test'
import { toSessionSummary } from '@maglev/protocol'
import type { SyncEvent } from '@maglev/protocol/types'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { Store } from '../store'
import { RpcRegistry } from '../socket/rpcRegistry'
import type { EventPublisher } from './eventPublisher'
import { SessionCache } from './sessionCache'
import { SyncEngine } from './syncEngine'

class FakeCliSocket {
    readonly id: string
    readonly data: Record<string, unknown>
    readonly emitted: Array<{ event: string; data: unknown }> = []

    constructor(id: string, namespace: string) {
        this.id = id
        this.data = { namespace }
    }

    emit(event: string, data: unknown): boolean {
        this.emitted.push({ event, data })
        return true
    }
}

class FakeNamespace {
    readonly sockets = new Map<string, FakeCliSocket>()
    readonly adapter = { rooms: new Map<string, Set<string>>() }
}

class FakeIo {
    private readonly namespaces = new Map<string, FakeNamespace>()

    of(name: string): FakeNamespace {
        const existing = this.namespaces.get(name)
        if (existing) {
            return existing
        }
        const namespace = new FakeNamespace()
        this.namespaces.set(name, namespace)
        return namespace
    }
}

function connectCliSession(io: FakeIo, sessionId: string, namespace: string): FakeCliSocket {
    const socket = new FakeCliSocket(`cli-${sessionId}`, namespace)
    const cliNamespace = io.of('/cli')
    cliNamespace.sockets.set(socket.id, socket)
    cliNamespace.adapter.rooms.set(`session:${sessionId}`, new Set([socket.id]))
    return socket
}

function createPublisher(events: SyncEvent[]): EventPublisher {
    return {
        emit: (event: SyncEvent) => {
            events.push(event)
        }
    } as unknown as EventPublisher
}

describe('session model', () => {
    it('persists terminal supervision pairing in session summaries', async () => {
        const store = new Store(':memory:')
        const io = new FakeIo()
        const engine = new SyncEngine(
            store,
            io as never,
            new RpcRegistry(),
            { broadcast() {} } as never,
            { terminalSupervisionHumanOverrideMs: 5_000 }
        )

        try {
            const worker = engine.getOrCreateSession(
                'worker-session',
                {
                    path: '/tmp/project',
                    host: 'localhost',
                    flavor: 'shell',
                    shellTerminalId: 'terminal:worker',
                    shellTerminalState: 'ready'
                },
                null,
                'default'
            )
            const supervisor = engine.getOrCreateSession(
                'supervisor-session',
                {
                    path: '/tmp/project',
                    host: 'localhost',
                    flavor: 'shell',
                    shellTerminalId: 'terminal:supervisor',
                    shellTerminalState: 'ready'
                },
                null,
                'default'
            )

            await engine.attachTerminalSupervision(supervisor.id, worker.id, 'default')

            const refreshedWorker = engine.getSession(worker.id)
            const refreshedSupervisor = engine.getSession(supervisor.id)

            expect(refreshedWorker?.metadata?.terminalSupervision).toMatchObject({
                role: 'worker',
                peerSessionId: supervisor.id,
                state: 'active'
            })
            expect(toSessionSummary(refreshedSupervisor!).metadata?.terminalSupervision).toMatchObject({
                role: 'supervisor',
                peerSessionId: worker.id,
                state: 'active'
            })
        } finally {
            engine.stop()
        }
    })

    it('retries transient metadata version mismatches while attaching terminal supervision', async () => {
        const store = new Store(':memory:')
        const io = new FakeIo()
        const engine = new SyncEngine(
            store,
            io as never,
            new RpcRegistry(),
            { broadcast() {} } as never,
            { terminalSupervisionHumanOverrideMs: 5_000 }
        )

        try {
            const worker = engine.getOrCreateSession(
                'worker-session-retry',
                {
                    path: '/tmp/project',
                    host: 'localhost',
                    flavor: 'shell',
                    shellTerminalId: 'terminal:worker',
                    shellTerminalState: 'ready'
                },
                null,
                'default'
            )
            const supervisor = engine.getOrCreateSession(
                'supervisor-session-retry',
                {
                    path: '/tmp/project',
                    host: 'localhost',
                    flavor: 'shell',
                    shellTerminalId: 'terminal:supervisor',
                    shellTerminalState: 'ready'
                },
                null,
                'default'
            )

            const originalUpdate = store.sessions.updateSessionMetadata.bind(store.sessions)
            let transientMismatchPending = true
            store.sessions.updateSessionMetadata = ((id, metadata, expectedVersion, namespace, options) => {
                if (transientMismatchPending && id === supervisor.id) {
                    transientMismatchPending = false
                    return {
                        result: 'version-mismatch',
                        currentValue: metadata
                    }
                }
                return originalUpdate(id, metadata, expectedVersion, namespace, options)
            }) as typeof store.sessions.updateSessionMetadata

            await engine.attachTerminalSupervision(supervisor.id, worker.id, 'default')

            expect(engine.getSession(supervisor.id)?.metadata?.terminalSupervision).toMatchObject({
                role: 'supervisor',
                peerSessionId: worker.id,
                state: 'active'
            })
            expect(engine.getSession(worker.id)?.metadata?.terminalSupervision).toMatchObject({
                role: 'worker',
                peerSessionId: supervisor.id,
                state: 'active'
            })
            expect(transientMismatchPending).toBeFalse()
        } finally {
            engine.stop()
        }
    })

    it('rolls back a partial terminal supervision attach when the peer update fails', async () => {
        const store = new Store(':memory:')
        const io = new FakeIo()
        const engine = new SyncEngine(
            store,
            io as never,
            new RpcRegistry(),
            { broadcast() {} } as never,
            { terminalSupervisionHumanOverrideMs: 5_000 }
        )

        try {
            const worker = engine.getOrCreateSession(
                'worker-session-rollback-attach',
                {
                    path: '/tmp/project',
                    host: 'localhost',
                    flavor: 'shell',
                    shellTerminalId: 'terminal:worker',
                    shellTerminalState: 'ready'
                },
                null,
                'default'
            )
            const supervisor = engine.getOrCreateSession(
                'supervisor-session-rollback-attach',
                {
                    path: '/tmp/project',
                    host: 'localhost',
                    flavor: 'shell',
                    shellTerminalId: 'terminal:supervisor',
                    shellTerminalState: 'ready'
                },
                null,
                'default'
            )

            const sessionCache = (engine as any).sessionCache
            const originalUpdate = sessionCache.updateSessionMetadataFields.bind(sessionCache)
            let failedOnce = false
            sessionCache.updateSessionMetadataFields = async (
                sessionId: string,
                mutate: (metadata: Record<string, unknown>) => Record<string, unknown>
            ) => {
                if (!failedOnce && sessionId === worker.id) {
                    failedOnce = true
                    throw new Error('simulated peer write failure')
                }
                return originalUpdate(sessionId, mutate)
            }

            await expect(engine.attachTerminalSupervision(supervisor.id, worker.id, 'default')).rejects.toThrow(
                'Failed to attach terminal supervision consistently. Partial update was rolled back: simulated peer write failure'
            )

            expect(engine.getSession(supervisor.id)?.metadata?.terminalSupervision).toBeUndefined()
            expect(engine.getSession(worker.id)?.metadata?.terminalSupervision).toBeUndefined()
        } finally {
            engine.stop()
        }
    })

    it('rolls back a partial terminal supervision detach when the peer update fails', async () => {
        const store = new Store(':memory:')
        const io = new FakeIo()
        const engine = new SyncEngine(
            store,
            io as never,
            new RpcRegistry(),
            { broadcast() {} } as never,
            { terminalSupervisionHumanOverrideMs: 5_000 }
        )

        try {
            const worker = engine.getOrCreateSession(
                'worker-session-rollback-detach',
                {
                    path: '/tmp/project',
                    host: 'localhost',
                    flavor: 'shell',
                    shellTerminalId: 'terminal:worker',
                    shellTerminalState: 'ready'
                },
                null,
                'default'
            )
            const supervisor = engine.getOrCreateSession(
                'supervisor-session-rollback-detach',
                {
                    path: '/tmp/project',
                    host: 'localhost',
                    flavor: 'shell',
                    shellTerminalId: 'terminal:supervisor',
                    shellTerminalState: 'ready'
                },
                null,
                'default'
            )

            await engine.attachTerminalSupervision(supervisor.id, worker.id, 'default')

            const sessionCache = (engine as any).sessionCache
            const originalUpdate = sessionCache.updateSessionMetadataFields.bind(sessionCache)
            let failedOnce = false
            sessionCache.updateSessionMetadataFields = async (
                sessionId: string,
                mutate: (metadata: Record<string, unknown>) => Record<string, unknown>
            ) => {
                if (!failedOnce && sessionId === worker.id) {
                    failedOnce = true
                    throw new Error('simulated peer detach failure')
                }
                return originalUpdate(sessionId, mutate)
            }

            await expect(engine.detachTerminalSupervision(supervisor.id, 'default')).rejects.toThrow(
                'Failed to detach terminal supervision consistently. Partial update was rolled back: simulated peer detach failure'
            )

            expect(engine.getSession(supervisor.id)?.metadata?.terminalSupervision).toMatchObject({
                role: 'supervisor',
                peerSessionId: worker.id,
                state: 'active'
            })
            expect(engine.getSession(worker.id)?.metadata?.terminalSupervision).toMatchObject({
                role: 'worker',
                peerSessionId: supervisor.id,
                state: 'active'
            })
        } finally {
            engine.stop()
        }
    })

    it('blocks supervisor writes during the human override window and delivers them after it expires', async () => {
        const store = new Store(':memory:')
        const io = new FakeIo()
        const engine = new SyncEngine(
            store,
            io as never,
            new RpcRegistry(),
            { broadcast() {} } as never,
            { terminalSupervisionHumanOverrideMs: 5_000 }
        )

        try {
            const worker = engine.getOrCreateSession(
                'worker-session-write',
                {
                    path: '/tmp/project',
                    host: 'localhost',
                    flavor: 'shell',
                    shellTerminalId: 'terminal:worker',
                    shellTerminalState: 'ready'
                },
                null,
                'default'
            )
            const supervisor = engine.getOrCreateSession(
                'supervisor-session-write',
                {
                    path: '/tmp/project',
                    host: 'localhost',
                    flavor: 'shell',
                    shellTerminalId: 'terminal:supervisor',
                    shellTerminalState: 'ready'
                },
                null,
                'default'
            )
            const workerCli = connectCliSession(io, worker.id, 'default')

            await engine.attachTerminalSupervision(supervisor.id, worker.id, 'default')
            engine.noteHumanTerminalInput(worker.id)

            const blocked = await engine.writeTerminalSupervisionInput(supervisor.id, 'pwd\n', 'default')
            expect(blocked).toEqual({ delivered: false, blockedReason: 'human_override' })
            expect(workerCli.emitted).toHaveLength(0)

            ;(engine as any).recentHumanTerminalActivityBySessionId.set(worker.id, Date.now() - 6_000)
            const delivered = await engine.writeTerminalSupervisionInput(supervisor.id, 'pwd\n', 'default')
            expect(delivered).toEqual({ delivered: true })
            expect(workerCli.emitted.at(-1)).toEqual({
                event: 'terminal:write',
                data: {
                    sessionId: worker.id,
                    terminalId: 'terminal:worker',
                    data: 'pwd\n'
                }
            })
        } finally {
            engine.stop()
        }
    })

    it('mirrors worker terminal state into the supervisor bridge workspace and clears it on detach', async () => {
        const root = await mkdtemp(join(tmpdir(), 'maglev-supervision-session-'))
        const workerPath = join(root, 'worker')
        const supervisorPath = join(root, 'supervisor')
        const store = new Store(':memory:')
        const io = new FakeIo()
        const engine = new SyncEngine(
            store,
            io as never,
            new RpcRegistry(),
            { broadcast() {} } as never,
            { terminalSupervisionHumanOverrideMs: 5_000 }
        )

        try {
            const worker = engine.getOrCreateSession(
                'worker-session-bridge',
                {
                    path: workerPath,
                    host: 'localhost',
                    flavor: 'shell',
                    shellTerminalId: 'terminal:worker',
                    shellTerminalState: 'ready'
                },
                null,
                'default'
            )
            const supervisor = engine.getOrCreateSession(
                'supervisor-session-bridge',
                {
                    path: supervisorPath,
                    host: 'localhost',
                    flavor: 'shell',
                    shellTerminalId: 'terminal:supervisor',
                    shellTerminalState: 'ready'
                },
                null,
                'default'
            )

            await engine.attachTerminalSupervision(supervisor.id, worker.id, 'default')
            ;(engine as any).terminalStateCache.noteOutput(worker.id, 'terminal:worker', 'worker ready\n')
            await engine.syncTerminalSupervisionBridge(worker.id, 'default')

            const bridgeDir = join(supervisorPath, '.maglev-supervision', supervisor.id)
            expect(await readFile(join(bridgeDir, 'worker-terminal.log'), 'utf8')).toBe('worker ready\n')

            const state = JSON.parse(await readFile(join(bridgeDir, 'worker-terminal.json'), 'utf8')) as Record<string, unknown>
            expect(state.supervisorSessionId).toBe(supervisor.id)
            expect(state.workerSessionId).toBe(worker.id)
            expect(state.supervisionState).toBe('active')
            expect(await readFile(join(bridgeDir, 'send-to-worker.sh'), 'utf8')).toContain(`--session "${supervisor.id}"`)

            await engine.setTerminalSupervisionPaused(supervisor.id, true, 'default')
            const pausedState = JSON.parse(await readFile(join(bridgeDir, 'worker-terminal.json'), 'utf8')) as Record<string, unknown>
            expect(pausedState.supervisionState).toBe('paused')

            await engine.detachTerminalSupervision(supervisor.id, 'default')
            expect(await readFile(join(bridgeDir, 'worker-terminal.log'), 'utf8').catch(() => null)).toBeNull()
        } finally {
            engine.stop()
            await rm(root, { recursive: true, force: true })
        }
    })

    it('creates a named terminal pair and links both shell sessions with deterministic names', async () => {
        const store = new Store(':memory:')
        const io = new FakeIo()
        const engine = new SyncEngine(
            store,
            io as never,
            new RpcRegistry(),
            { broadcast() {} } as never,
            { boundMachineId: 'machine-1' }
        )

        try {
            engine.getOrCreateMachine(
                'machine-1',
                { host: 'localhost', platform: 'linux', maglevCliVersion: '0.1.0' },
                null,
                'default'
            )
            engine.handleMachineAlive({ machineId: 'machine-1', time: Date.now() })

            const workerShell = engine.getOrCreateSession(
                'pair-worker-shell',
                {
                    path: '/tmp/project',
                    host: 'localhost',
                    flavor: 'shell',
                    shellTerminalId: 'terminal:worker',
                    shellTerminalState: 'ready'
                },
                null,
                'default'
            )
            const supervisorShell = engine.getOrCreateSession(
                'pair-supervisor-shell',
                {
                    path: '/tmp/project',
                    host: 'localhost',
                    flavor: 'shell',
                    shellTerminalId: 'terminal:supervisor',
                    shellTerminalState: 'ready'
                },
                null,
                'default'
            )
            engine.handleSessionAlive({ sid: workerShell.id, time: Date.now(), thinking: false })
            engine.handleSessionAlive({ sid: supervisorShell.id, time: Date.now(), thinking: false })

            const workerCli = connectCliSession(io, workerShell.id, 'default')
            const supervisorCli = connectCliSession(io, supervisorShell.id, 'default')

            let spawnCount = 0
            ;(engine as any).rpcGateway.spawnSession = async () => {
                spawnCount += 1
                return { type: 'success', sessionId: spawnCount === 1 ? workerShell.id : supervisorShell.id }
            }

            const result = await engine.createTerminalPair('default', {
                directory: '/tmp/project',
                name: 'deploy'
            })

            expect(result.type).toBe('success')
            if (result.type !== 'success') {
                return
            }

            expect(result.pair.worker.sessionName).toBe('deploy_worker')
            expect(result.pair.worker.startupCommand).toBeUndefined()
            expect(result.pair.supervisor.sessionName).toBe('deploy_supervisor')
            expect(result.pair.supervisor.startupCommand).toBeUndefined()
            expect(result.pair.state).toBe('active')

            expect(engine.getSession(workerShell.id)?.metadata?.terminalPair).toMatchObject({
                pairName: 'deploy',
                role: 'worker',
                state: 'active'
            })
            expect(engine.getSession(supervisorShell.id)?.metadata?.terminalPair).toMatchObject({
                pairName: 'deploy',
                role: 'supervisor',
                state: 'active'
            })
            expect(engine.getSession(workerShell.id)?.metadata?.startupCommand).toBeUndefined()
            expect(engine.getSession(supervisorShell.id)?.metadata?.startupCommand).toBeUndefined()
            expect(workerCli.emitted).toHaveLength(0)
            expect(supervisorCli.emitted).toHaveLength(0)
        } finally {
            engine.stop()
        }
    })

    it('rebinds one side of a named terminal pair to a replacement shell session', async () => {
        const store = new Store(':memory:')
        const io = new FakeIo()
        const engine = new SyncEngine(
            store,
            io as never,
            new RpcRegistry(),
            { broadcast() {} } as never,
            { boundMachineId: 'machine-1' }
        )

        try {
            engine.getOrCreateMachine(
                'machine-1',
                { host: 'localhost', platform: 'linux', maglevCliVersion: '0.1.0' },
                null,
                'default'
            )
            engine.handleMachineAlive({ machineId: 'machine-1', time: Date.now() })

            const workerShell = engine.getOrCreateSession(
                'pair-worker-shell-rebind',
                {
                    path: '/tmp/project',
                    host: 'localhost',
                    flavor: 'shell',
                    shellTerminalId: 'terminal:worker',
                    shellTerminalState: 'ready'
                },
                null,
                'default'
            )
            const supervisorShell = engine.getOrCreateSession(
                'pair-supervisor-shell-rebind',
                {
                    path: '/tmp/project',
                    host: 'localhost',
                    flavor: 'shell',
                    shellTerminalId: 'terminal:supervisor',
                    shellTerminalState: 'ready'
                },
                null,
                'default'
            )
            const replacementWorkerShell = engine.getOrCreateSession(
                'pair-worker-shell-replacement',
                {
                    path: '/tmp/other-project',
                    host: 'localhost',
                    flavor: 'shell',
                    shellTerminalId: 'terminal:worker-replacement',
                    shellTerminalState: 'ready'
                },
                null,
                'default'
            )
            engine.handleSessionAlive({ sid: workerShell.id, time: Date.now(), thinking: false })
            engine.handleSessionAlive({ sid: supervisorShell.id, time: Date.now(), thinking: false })
            engine.handleSessionAlive({ sid: replacementWorkerShell.id, time: Date.now(), thinking: false })

            connectCliSession(io, workerShell.id, 'default')
            connectCliSession(io, supervisorShell.id, 'default')
            const replacementCli = connectCliSession(io, replacementWorkerShell.id, 'default')

            let spawnCount = 0
            ;(engine as any).rpcGateway.spawnSession = async () => {
                spawnCount += 1
                return { type: 'success', sessionId: spawnCount === 1 ? workerShell.id : supervisorShell.id }
            }

            const created = await engine.createTerminalPair('default', {
                directory: '/tmp/project',
                name: 'deploy-rebind'
            })

            expect(created.type).toBe('success')
            if (created.type !== 'success') {
                return
            }

            const rebound = await engine.rebindTerminalPairBySession(workerShell.id, replacementWorkerShell.id, 'default')

            expect(rebound.workerSessionId).toBe(replacementWorkerShell.id)
            expect(rebound.worker.workingDirectory).toBe('/tmp/other-project')
            expect(engine.getSession(workerShell.id)?.metadata?.terminalPair).toBeUndefined()
            expect(engine.getSession(replacementWorkerShell.id)?.metadata?.terminalPair).toMatchObject({
                pairName: 'deploy-rebind',
                role: 'worker',
                state: 'active'
            })
            expect(engine.getSession(replacementWorkerShell.id)?.metadata?.startupCommand).toBeUndefined()
            expect(replacementCli.emitted).toHaveLength(0)
        } finally {
            engine.stop()
        }
    })

    it('adopts an existing worker terminal and spawns a linked supervisor shell', async () => {
        const store = new Store(':memory:')
        const io = new FakeIo()
        const engine = new SyncEngine(
            store,
            io as never,
            new RpcRegistry(),
            { broadcast() {} } as never,
            { boundMachineId: 'machine-1' }
        )

        try {
            engine.getOrCreateMachine(
                'machine-1',
                { host: 'localhost', platform: 'linux', maglevCliVersion: '0.1.0' },
                null,
                'default'
            )
            engine.handleMachineAlive({ machineId: 'machine-1', time: Date.now() })

            const workerShell = engine.getOrCreateSession(
                'existing-worker-shell',
                {
                    path: '/tmp/project',
                    host: 'localhost',
                    flavor: 'shell',
                    startupCommand: 'pwd',
                    shellTerminalId: 'terminal:worker-existing',
                    shellTerminalState: 'ready'
                },
                null,
                'default'
            )
            const supervisorShell = engine.getOrCreateSession(
                'new-supervisor-shell',
                {
                    path: '/tmp/project',
                    host: 'localhost',
                    flavor: 'shell',
                    shellTerminalId: 'terminal:supervisor-new',
                    shellTerminalState: 'ready'
                },
                null,
                'default'
            )
            engine.handleSessionAlive({ sid: workerShell.id, time: Date.now(), thinking: false })
            engine.handleSessionAlive({ sid: supervisorShell.id, time: Date.now(), thinking: false })

            const workerCli = connectCliSession(io, workerShell.id, 'default')
            const supervisorCli = connectCliSession(io, supervisorShell.id, 'default')

            ;(engine as any).rpcGateway.spawnSession = async () => ({
                type: 'success',
                sessionId: supervisorShell.id
            })

            const result = await engine.addSupervisorToWorkerSession(workerShell.id, 'default', {
                name: 'adopted'
            })

            expect(result.type).toBe('success')
            if (result.type !== 'success') {
                return
            }

            expect(result.pair.workerSessionId).toBe(workerShell.id)
            expect(result.pair.supervisorSessionId).toBe(supervisorShell.id)
            expect(result.pair.worker.sessionName).toBe('adopted_worker')
            expect(result.pair.supervisor.sessionName).toBe('adopted_supervisor')
            expect(engine.getSession(workerShell.id)?.metadata?.terminalPair).toMatchObject({
                pairName: 'adopted',
                role: 'worker',
                state: 'active'
            })
            expect(engine.getSession(supervisorShell.id)?.metadata?.terminalPair).toMatchObject({
                pairName: 'adopted',
                role: 'supervisor',
                state: 'active'
            })
            expect(engine.getSession(workerShell.id)?.metadata?.startupCommand).toBe('pwd')
            expect(engine.getSession(supervisorShell.id)?.metadata?.startupCommand).toBeUndefined()
            expect(workerCli.emitted.at(-1)).toEqual({
                event: 'terminal:write',
                data: {
                    sessionId: workerShell.id,
                    terminalId: 'terminal:worker-existing',
                    data: 'pwd\n'
                }
            })
            expect(supervisorCli.emitted).toHaveLength(0)
        } finally {
            engine.stop()
        }
    })

    it('preserves model from old session when merging into resumed session', async () => {
        const store = new Store(':memory:')
        const events: SyncEvent[] = []
        const cache = new SessionCache(store, createPublisher(events))

        const oldSession = cache.getOrCreateSession(
            'session-model-old',
            { path: '/tmp/project', host: 'localhost', flavor: 'shell' },
            null,
            'default',
            'gpt-5.4'
        )
        const newSession = cache.getOrCreateSession(
            'session-model-new',
            { path: '/tmp/project', host: 'localhost', flavor: 'shell' },
            null,
            'default'
        )

        await cache.mergeSessions(oldSession.id, newSession.id, 'default')

        const merged = cache.getSession(newSession.id)
        expect(merged?.model).toBe('gpt-5.4')
    })

    it('persists applied session model updates, including clear-to-auto', () => {
        const store = new Store(':memory:')
        const events: SyncEvent[] = []
        const cache = new SessionCache(store, createPublisher(events))

        const session = cache.getOrCreateSession(
            'session-model-config',
            { path: '/tmp/project', host: 'localhost', flavor: 'shell' },
            null,
            'default',
            'sonnet'
        )

        cache.applySessionConfig(session.id, { model: 'opus[1m]' })
        expect(cache.getSession(session.id)?.model).toBe('opus[1m]')
        expect(store.sessions.getSession(session.id)?.model).toBe('opus[1m]')

        cache.applySessionConfig(session.id, { model: null })
        expect(cache.getSession(session.id)?.model).toBeNull()
        expect(store.sessions.getSession(session.id)?.model).toBeNull()
    })

    it('persists keepalive model changes, including clearing the model', () => {
        const store = new Store(':memory:')
        const events: SyncEvent[] = []
        const cache = new SessionCache(store, createPublisher(events))

        const session = cache.getOrCreateSession(
            'session-model-heartbeat',
            { path: '/tmp/project', host: 'localhost', flavor: 'shell' },
            null,
            'default',
            'sonnet'
        )

        cache.handleSessionAlive({
            sid: session.id,
            time: Date.now(),
            thinking: false,
            model: null
        })

        expect(cache.getSession(session.id)?.model).toBeNull()
        expect(store.sessions.getSession(session.id)?.model).toBeNull()
    })

    it('spawns only on the bound machine for the namespace', async () => {
        const store = new Store(':memory:')
        const engine = new SyncEngine(
            store,
            {} as never,
            new RpcRegistry(),
            { broadcast() {} } as never,
            { boundMachineId: 'bound-machine' }
        )

        try {
            engine.getOrCreateMachine(
                'bound-machine',
                { host: 'bound-host', platform: 'linux', maglevCliVersion: '0.1.0' },
                null,
                'default'
            )
            engine.getOrCreateMachine(
                'foreign-machine',
                { host: 'foreign-host', platform: 'linux', maglevCliVersion: '0.1.0' },
                null,
                'default'
            )
            engine.handleMachineAlive({ machineId: 'bound-machine', time: Date.now() })
            engine.handleMachineAlive({ machineId: 'foreign-machine', time: Date.now() })

            let capturedMachineId: string | undefined
            ;(engine as any).rpcGateway.spawnSession = async (machineId: string) => {
                capturedMachineId = machineId
                return { type: 'success', sessionId: 'session-1' }
            }

            const result = await engine.spawnSessionForBoundMachine('default', '/tmp/project')

            expect(result).toEqual({ type: 'success', sessionId: 'session-1' })
            expect(capturedMachineId).toBe('bound-machine')
        } finally {
            engine.stop()
        }
    })

    it('retains inactive pinned shell sessions in the store across cleanup', () => {
        const store = new Store(':memory:')
        const events: SyncEvent[] = []
        const cache = new SessionCache(store, createPublisher(events))

        const pinnedShell = cache.getOrCreateSession(
            'pinned-shell-retained',
            {
                path: '/tmp/project',
                host: 'localhost',
                flavor: 'shell',
                pinned: true,
                startupCommand: 'echo hello',
                shellTerminalId: 'term-1'
            },
            null,
            'default'
        )

        cache.handleSessionAlive({
            sid: pinnedShell.id,
            time: Date.now(),
            thinking: false
        })
        cache.handleSessionEnd({ sid: pinnedShell.id, time: Date.now() })

        cache.expireInactive(Date.now() + 120_000)

        expect(cache.getSession(pinnedShell.id)?.active).toBeFalse()
        expect(store.sessions.getSession(pinnedShell.id)?.metadata).toMatchObject({
            flavor: 'shell',
            pinned: true,
            startupCommand: 'echo hello',
            shellTerminalId: 'term-1'
        })
    })

    it('auto-archives stale inactive sessions instead of deleting them', () => {
        const store = new Store(':memory:')
        const events: SyncEvent[] = []
        const cache = new SessionCache(store, createPublisher(events), {
            staleSessionArchiveMs: 60_000
        })

        const session = cache.getOrCreateSession(
            'stale-session-archive',
            { path: '/tmp/project', host: 'localhost', flavor: 'shell' },
            null,
            'default'
        )

        const aliveAt = Date.now()
        cache.handleSessionAlive({
            sid: session.id,
            time: aliveAt,
            thinking: false
        })
        cache.handleSessionEnd({ sid: session.id, time: aliveAt + 1_000 })

        cache.expireInactive(aliveAt + 120_000)

        expect(cache.getSession(session.id)).not.toBeNull()
        expect(store.sessions.getSession(session.id)?.metadata).toMatchObject({
            lifecycleState: 'archived',
            archivedBy: 'hub',
            archiveReason: 'Inactive session auto-archived'
        })
    })

    it('does not auto-archive inactive auto-respawn shells', () => {
        const store = new Store(':memory:')
        const events: SyncEvent[] = []
        const cache = new SessionCache(store, createPublisher(events), {
            staleSessionArchiveMs: 60_000
        })

        const session = cache.getOrCreateSession(
            'auto-respawn-retained',
            {
                path: '/tmp/project',
                host: 'localhost',
                flavor: 'shell',
                pinned: true,
                autoRespawn: true
            },
            null,
            'default'
        )

        const aliveAt = Date.now()
        cache.handleSessionAlive({
            sid: session.id,
            time: aliveAt,
            thinking: false
        })
        cache.handleSessionEnd({ sid: session.id, time: aliveAt + 1_000 })

        cache.expireInactive(aliveAt + 120_000)

        const storedMetadata = store.sessions.getSession(session.id)?.metadata as Record<string, unknown> | null | undefined
        expect(storedMetadata).toMatchObject({
            pinned: true,
            autoRespawn: true
        })
        expect(storedMetadata?.lifecycleState).not.toBe('archived')
    })

    it('preserves recent session activity across cache reload so restart does not immediately delete sessions', () => {
        const store = new Store(':memory:')
        const events: SyncEvent[] = []
        const cache = new SessionCache(store, createPublisher(events))

        const session = cache.getOrCreateSession(
            'session-restart-persistence',
            { path: '/tmp/project', host: 'localhost', flavor: 'shell' },
            null,
            'default'
        )

        const aliveAt = Date.now()
        cache.handleSessionAlive({
            sid: session.id,
            time: aliveAt,
            thinking: false
        })

        const reloadedCache = new SessionCache(store, createPublisher([]))
        reloadedCache.reloadAll()
        reloadedCache.expireInactive(aliveAt + 20_000)

        expect(reloadedCache.getSession(session.id)).not.toBeNull()
        expect(store.sessions.getSession(session.id)?.activeAt).toBe(aliveAt)
    })

    it('respawns pinned shells on the current bound machine even if stored machineId is stale', async () => {
        const store = new Store(':memory:')
        const engine = new SyncEngine(
            store,
            {} as never,
            new RpcRegistry(),
            { broadcast() {} } as never,
            { boundMachineId: 'current-machine' }
        )

        try {
            const session = engine.getOrCreateSession(
                'pinned-shell-stale-machine',
                {
                    path: '/tmp/project',
                    host: 'old-host',
                    machineId: 'stale-machine',
                    flavor: 'shell',
                    pinned: true,
                    startupCommand: 'echo hello',
                    shellTerminalId: 'term-1'
                },
                null,
                'default'
            )

            engine.getOrCreateMachine(
                'current-machine',
                { host: 'new-host', platform: 'linux', maglevCliVersion: '0.1.0' },
                null,
                'default'
            )
            engine.handleMachineAlive({ machineId: 'current-machine', time: Date.now() })

            let capturedMachineId: string | undefined
            let capturedStartupCommand: string | undefined
            ;(engine as any).rpcGateway.spawnSession = async (
                machineId: string,
                _directory: string,
                _sessionType?: string,
                _worktreeName?: string,
                _resumeSessionId?: string,
                startupCommand?: string
            ) => {
                capturedMachineId = machineId
                capturedStartupCommand = startupCommand
                return { type: 'success', sessionId: session.id }
            }
            ;(engine as any).waitForSessionActive = async () => true

            const result = await engine.respawnPinnedShellSession(session.id, 'default')

            expect(result).toEqual({ type: 'success', sessionId: session.id })
            expect(capturedMachineId).toBe('current-machine')
            expect(capturedStartupCommand).toBe('echo hello')
        } finally {
            engine.stop()
        }
    })

    it('marks respawned pinned shells with their replaced session lineage', async () => {
        const store = new Store(':memory:')
        const engine = new SyncEngine(
            store,
            {} as never,
            new RpcRegistry(),
            { broadcast() {} } as never,
            { boundMachineId: 'current-machine' }
        )

        try {
            const oldSession = engine.getOrCreateSession(
                'old-shell',
                {
                    path: '/tmp/project',
                    host: 'old-host',
                    machineId: 'stale-machine',
                    flavor: 'shell',
                    pinned: true,
                    respawnedFromSessionIds: ['original-shell'],
                    shellTerminalId: 'term-1'
                },
                null,
                'default'
            )

            engine.getOrCreateMachine(
                'current-machine',
                { host: 'new-host', platform: 'linux', maglevCliVersion: '0.1.0' },
                null,
                'default'
            )
            engine.handleMachineAlive({ machineId: 'current-machine', time: Date.now() })

            ;(engine as any).rpcGateway.spawnSession = async () => {
                const replacement = engine.getOrCreateSession(
                    'new-shell',
                    {
                        path: '/tmp/project',
                        host: 'new-host',
                        machineId: 'current-machine',
                        flavor: 'shell',
                        shellTerminalId: 'term-2'
                    },
                    null,
                    'default'
                )
                engine.handleSessionAlive({ sid: replacement.id, time: Date.now(), thinking: false })
                return { type: 'success', sessionId: replacement.id }
            }
            ;(engine as any).waitForSessionActive = async () => true

            const result = await engine.respawnPinnedShellSession(oldSession.id, 'default')

            expect(result.type).toBe('success')
            if (result.type !== 'success') {
                return
            }
            expect(engine.getSession(oldSession.id)).toBeUndefined()
            const replacement = engine.getSession(result.sessionId)
            expect(replacement?.metadata).toMatchObject({
                respawnedFromSessionId: oldSession.id,
                respawnedFromSessionIds: ['original-shell', oldSession.id],
                pinned: true
            })
            expect(toSessionSummary(replacement!).metadata).toMatchObject({
                respawnedFromSessionId: oldSession.id,
                respawnedFromSessionIds: ['original-shell', oldSession.id]
            })
        } finally {
            engine.stop()
        }
    })

    it('auto-respawn implies pinned when shell options are updated', async () => {
        const store = new Store(':memory:')
        const engine = new SyncEngine(
            store,
            {} as never,
            new RpcRegistry(),
            { broadcast() {} } as never,
            { boundMachineId: 'machine-1' }
        )

        try {
            const session = engine.getOrCreateSession(
                'shell-options-auto-respawn',
                {
                    path: '/tmp/project',
                    host: 'localhost',
                    flavor: 'shell',
                    pinned: false
                },
                null,
                'default'
            )

            await engine.setShellSessionOptions(session.id, {
                autoRespawn: true,
                startupCommand: 'echo hello'
            })

            expect(engine.getSession(session.id)?.metadata).toMatchObject({
                pinned: true,
                autoRespawn: true,
                startupCommand: 'echo hello'
            })
        } finally {
            engine.stop()
        }
    })

    it('auto-respawns pinned shells when the bound machine comes online after hub restart', async () => {
        const store = new Store(':memory:')
        const engine = new SyncEngine(
            store,
            {} as never,
            new RpcRegistry(),
            { broadcast() {} } as never,
            { boundMachineId: 'machine-1' }
        )

        try {
            const session = engine.getOrCreateSession(
                'pinned-shell-auto-respawn-on-machine-alive',
                {
                    path: '/tmp/project',
                    host: 'localhost',
                    flavor: 'shell',
                    pinned: true,
                    autoRespawn: true,
                    startupCommand: 'echo hello',
                    shellTerminalState: 'stale'
                },
                null,
                'default'
            )
            engine.handleSessionEnd({ sid: session.id, time: Date.now() })

            let spawnCalls = 0
            ;(engine as any).rpcGateway.spawnSession = async () => {
                spawnCalls += 1
                return { type: 'success', sessionId: session.id }
            }
            ;(engine as any).waitForSessionActive = async () => true

            engine.getOrCreateMachine(
                'machine-1',
                { host: 'localhost', platform: 'linux', maglevCliVersion: '0.1.0' },
                null,
                'default'
            )
            engine.handleMachineAlive({ machineId: 'machine-1', time: Date.now() })

            const start = Date.now()
            while (spawnCalls === 0 && Date.now() - start < 2_000) {
                await new Promise((resolve) => setTimeout(resolve, 25))
            }

            expect(spawnCalls).toBe(1)
        } finally {
            engine.stop()
        }
    })
})
