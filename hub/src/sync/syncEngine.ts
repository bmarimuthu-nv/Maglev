/**
 * Sync Engine for Maglev Telegram Bot (Direct Connect)
 *
 * In the direct-connect architecture:
 * - maglev-hub is the hub (Socket.IO + REST)
 * - maglev CLI connects directly to the hub (no relay)
 * - No E2E encryption; data is stored as JSON in SQLite
 */

import type {
    Metadata,
    Session,
    SyncEvent,
    TerminalPair,
    TerminalPairRole,
    TerminalPairSideRecipe,
    TerminalPairState,
    TerminalSupervision,
    TerminalSupervisionEvent
} from '@maglev/protocol/types'
import { TerminalPairSideRecipeSchema } from '@maglev/protocol/schemas'
import type { Server } from 'socket.io'
import type { Store } from '../store'
import type { RpcRegistry } from '../socket/rpcRegistry'
import type { SSEManager } from '../sse/sseManager'
import { EventPublisher, type SyncEventListener } from './eventPublisher'
import { MachineCache, type Machine } from './machineCache'
import {
    RpcGateway,
    type RpcCommandResponse,
    type RpcDeleteUploadResponse,
    type RpcListDirectoryResponse,
    type RpcPathExistsResponse,
    type RpcReadFileResponse,
    type RpcReviewMode,
    type RpcReviewSummaryResponse,
    type RpcWriteFileResponse,
    type RpcUploadFileResponse
} from './rpcGateway'
import { SessionCache } from './sessionCache'
import { TerminalStateCache } from './terminalStateCache'

export type { Session, SyncEvent } from '@maglev/protocol/types'
export type { Machine } from './machineCache'
export type { SyncEventListener } from './eventPublisher'
export type {
    RpcCommandResponse,
    RpcDeleteUploadResponse,
    RpcListDirectoryResponse,
    RpcPathExistsResponse,
    RpcReadFileResponse,
    RpcReviewMode,
    RpcReviewSummaryResponse,
    RpcWriteFileResponse,
    RpcUploadFileResponse
} from './rpcGateway'

export type ResumeSessionResult =
    | { type: 'success'; sessionId: string }
    | { type: 'error'; message: string; code: 'session_not_found' | 'access_denied' | 'no_machine_online' | 'resume_unavailable' | 'resume_failed' }

export type SpawnTerminalPairResult =
    | { type: 'success'; pair: TerminalPair }
    | { type: 'error'; message: string }

const DEFAULT_HUMAN_OVERRIDE_WINDOW_MS = 30_000
const TERMINAL_SUPERVISION_EVENT_LIMIT = 40

export class SyncEngine {
    private readonly store: Store
    private readonly eventPublisher: EventPublisher
    private readonly sessionCache: SessionCache
    private readonly machineCache: MachineCache
    private readonly rpcGateway: RpcGateway
    private readonly io: Server
    private readonly terminalStateCache: TerminalStateCache
    private readonly boundMachineId: string | null
    private readonly terminalSupervisionHumanOverrideMs: number
    private readonly autoRespawnInFlightSessionIds: Set<string> = new Set()
    private readonly recentHumanTerminalActivityBySessionId: Map<string, number> = new Map()
    private inactivityTimer: NodeJS.Timeout | null = null

    constructor(
        store: Store,
        io: Server,
        rpcRegistry: RpcRegistry,
        sseManager: SSEManager,
        options?: {
            boundMachineId?: string | null
            terminalStateCache?: TerminalStateCache
            terminalSupervisionHumanOverrideMs?: number
        }
    ) {
        this.store = store
        this.io = io
        this.eventPublisher = new EventPublisher(sseManager, (event) => this.resolveNamespace(event))
        this.sessionCache = new SessionCache(store, this.eventPublisher)
        this.machineCache = new MachineCache(store, this.eventPublisher)
        this.rpcGateway = new RpcGateway(io, rpcRegistry)
        this.terminalStateCache = options?.terminalStateCache ?? new TerminalStateCache()
        this.boundMachineId = options?.boundMachineId?.trim() || null
        this.terminalSupervisionHumanOverrideMs = Math.max(
            0,
            options?.terminalSupervisionHumanOverrideMs ?? DEFAULT_HUMAN_OVERRIDE_WINDOW_MS
        )
        this.reloadAll()
        this.inactivityTimer = setInterval(() => this.expireInactive(), 5_000)
    }

    stop(): void {
        if (this.inactivityTimer) {
            clearInterval(this.inactivityTimer)
            this.inactivityTimer = null
        }
    }

    subscribe(listener: SyncEventListener): () => void {
        return this.eventPublisher.subscribe(listener)
    }

    private resolveNamespace(event: SyncEvent): string | undefined {
        if (event.namespace) {
            return event.namespace
        }
        if ('sessionId' in event) {
            return this.getSession(event.sessionId)?.namespace
        }
        if ('machineId' in event) {
            return this.machineCache.getMachine(event.machineId)?.namespace
        }
        return undefined
    }

    getSessions(): Session[] {
        return this.sessionCache.getSessions()
    }

    getSessionsByNamespace(namespace: string): Session[] {
        return this.sessionCache.getSessionsByNamespace(namespace)
    }

    getSession(sessionId: string): Session | undefined {
        return this.sessionCache.getSession(sessionId) ?? this.sessionCache.refreshSession(sessionId) ?? undefined
    }

    getSessionByNamespace(sessionId: string, namespace: string): Session | undefined {
        const session = this.sessionCache.getSessionByNamespace(sessionId, namespace)
            ?? this.sessionCache.refreshSession(sessionId)
        if (!session || session.namespace !== namespace) {
            return undefined
        }
        return session
    }

    resolveSessionAccess(
        sessionId: string,
        namespace: string
    ): { ok: true; sessionId: string; session: Session } | { ok: false; reason: 'not-found' | 'access-denied' } {
        return this.sessionCache.resolveSessionAccess(sessionId, namespace)
    }

    getActiveSessions(): Session[] {
        return this.sessionCache.getActiveSessions()
    }

    getMachines(): Machine[] {
        return this.machineCache.getMachines()
    }

    getMachinesByNamespace(namespace: string): Machine[] {
        return this.machineCache.getMachinesByNamespace(namespace)
    }

    getMachine(machineId: string): Machine | undefined {
        return this.machineCache.getMachine(machineId)
    }

    getMachineByNamespace(machineId: string, namespace: string): Machine | undefined {
        return this.machineCache.getMachineByNamespace(machineId, namespace)
    }

    getOnlineMachines(): Machine[] {
        return this.machineCache.getOnlineMachines()
    }

    getOnlineMachinesByNamespace(namespace: string): Machine[] {
        return this.machineCache.getOnlineMachinesByNamespace(namespace)
    }

    getBoundMachine(namespace: string): Machine | undefined {
        if (!this.boundMachineId) {
            return undefined
        }
        return this.machineCache.getMachineByNamespace(this.boundMachineId, namespace) ?? undefined
    }

    handleRealtimeEvent(event: SyncEvent): void {
        if (event.type === 'session-updated' && event.sessionId) {
            this.sessionCache.refreshSession(event.sessionId)
            return
        }

        if (event.type === 'machine-updated' && event.machineId) {
            this.machineCache.refreshMachine(event.machineId)
            return
        }

        this.eventPublisher.emit(event)
    }

    handleSessionAlive(payload: {
        sid: string
        time: number
        thinking?: boolean
        mode?: 'local' | 'remote'
        model?: string | null
    }): void {
        this.sessionCache.handleSessionAlive(payload)
    }

    handleSessionEnd(payload: { sid: string; time: number }): void {
        this.sessionCache.handleSessionEnd(payload)
        this.terminalStateCache.evictStale()
    }

    handleMachineAlive(payload: { machineId: string; time: number }): void {
        this.machineCache.handleMachineAlive(payload)
        if (this.boundMachineId && payload.machineId === this.boundMachineId) {
            const machine = this.getMachine(payload.machineId)
            if (machine?.namespace) {
                void this.reconcileAutoRespawnPinnedShells(machine.namespace)
                void this.reconcileTerminalPairs(machine.namespace)
            }
        }
    }

    private expireInactive(): void {
        this.sessionCache.expireInactive()
        this.machineCache.expireInactive()
    }

    private reloadAll(): void {
        this.sessionCache.reloadAll()
        this.machineCache.reloadAll()
    }

    getTerminalPairBySession(sessionId: string, namespace: string): TerminalPair | null {
        const session = this.getSessionByNamespace(sessionId, namespace)
        const pairId = session?.metadata?.terminalPair?.pairId
        if (!pairId) {
            return null
        }
        return this.getTerminalPair(pairId, namespace)
    }

    getTerminalPair(pairId: string, namespace: string): TerminalPair | null {
        const stored = this.store.terminalPairs.getById(pairId, namespace)
        return stored ? this.toTerminalPair(stored) : null
    }

    async createTerminalPair(
        namespace: string,
        options: {
            directory: string
            name: string
        }
    ): Promise<SpawnTerminalPairResult> {
        if (this.store.terminalPairs.getByName(options.name, namespace)) {
            return { type: 'error', message: 'A terminal pair with that name already exists' }
        }

        const now = Date.now()
        const pair = this.toTerminalPair(this.store.terminalPairs.create({
            id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
            namespace,
            name: options.name,
            createdAt: now,
            updatedAt: now,
            state: 'recovering',
            workerSessionId: null,
            supervisorSessionId: null,
            worker: this.buildTerminalPairSideRecipe('worker', options.directory, options.name),
            supervisor: this.buildTerminalPairSideRecipe('supervisor', options.directory, options.name)
        }))

        const recovered = await this.recoverTerminalPair(pair, namespace, { mode: 'launch' })
        return { type: 'success', pair: recovered }
    }

    async restartTerminalPairBySession(sessionId: string, namespace: string): Promise<SpawnTerminalPairResult> {
        const pair = this.getTerminalPairBySession(sessionId, namespace)
        if (!pair) {
            return { type: 'error', message: 'Session is not linked to a terminal pair' }
        }
        const recovered = await this.recoverTerminalPair(pair, namespace, { mode: 'resume' })
        return { type: 'success', pair: recovered }
    }

    async setTerminalPairPausedBySession(sessionId: string, paused: boolean, namespace: string): Promise<TerminalPair> {
        const pair = this.getTerminalPairBySession(sessionId, namespace)
        if (!pair) {
            throw new Error('Session is not linked to a terminal pair')
        }
        return this.persistTerminalPair({
            ...pair,
            updatedAt: Date.now(),
            state: paused ? 'paused' : 'active'
        })
    }

    async rebindTerminalPairBySession(
        sessionId: string,
        replacementSessionId: string,
        namespace: string
    ): Promise<TerminalPair> {
        const pair = this.getTerminalPairBySession(sessionId, namespace)
        if (!pair) {
            throw new Error('Session is not linked to a terminal pair')
        }

        const current = this.getRequiredSession(sessionId, namespace)
        const replacement = this.getRequiredSession(replacementSessionId, namespace)
        this.assertTerminalSupervisionEligible(replacement, current.metadata?.terminalPair?.role === 'worker' ? 'worker' : 'orchestrator')

        if (replacement.id === current.id) {
            return pair
        }

        if (replacement.metadata?.terminalPair && replacement.metadata.terminalPair.pairId !== pair.id) {
            throw new Error('Replacement session is already linked to another terminal pair')
        }

        const role = current.metadata?.terminalPair?.role
        if (!role) {
            throw new Error('Current session is missing terminal pair role')
        }
        const peerSessionId = role === 'worker' ? pair.supervisorSessionId : pair.workerSessionId
        if (replacement.id === peerSessionId) {
            throw new Error('Replacement session is already linked to the other side of this terminal pair')
        }
        if (replacement.metadata?.terminalPair) {
            throw new Error('Replacement session is already linked to a terminal pair')
        }

        const updatedWorker = role === 'worker'
            ? { ...pair.worker, workingDirectory: replacement.metadata?.path ?? pair.worker.workingDirectory }
            : pair.worker
        const updatedSupervisor = role === 'supervisor'
            ? { ...pair.supervisor, workingDirectory: replacement.metadata?.path ?? pair.supervisor.workingDirectory }
            : pair.supervisor

        const next = await this.persistTerminalPair({
            ...pair,
            updatedAt: Date.now(),
            workerSessionId: role === 'worker' ? replacement.id : pair.workerSessionId,
            supervisorSessionId: role === 'supervisor' ? replacement.id : pair.supervisorSessionId,
            worker: updatedWorker,
            supervisor: updatedSupervisor
        })

        await this.sessionCache.updateSessionMetadataFields(current.id, (metadata) => {
            const { terminalPair, ...rest } = metadata
            return rest
        })

        const recipe = role === 'worker' ? next.worker : next.supervisor
        await this.renameSession(replacement.id, `${next.name} ${role}`)
        await this.setShellSessionOptions(replacement.id, {
            pinned: true,
            autoRespawn: true,
            startupCommand: recipe.startupCommand ?? null
        })
        if (recipe.startupCommand) {
            await this.writeSessionTerminalCommands(replacement.id, [recipe.startupCommand], namespace)
        }
        return this.getTerminalPair(next.id, namespace) ?? next
    }

    async addSupervisorToWorkerSession(
        workerSessionId: string,
        namespace: string,
        options: { name: string }
    ): Promise<SpawnTerminalPairResult> {
        const workerSession = this.getRequiredSession(workerSessionId, namespace)
        this.assertTerminalSupervisionEligible(workerSession, 'worker')

        if (workerSession.metadata?.terminalPair) {
            return { type: 'error', message: 'Session is already linked to a terminal pair' }
        }

        if (this.store.terminalPairs.getByName(options.name, namespace)) {
            return { type: 'error', message: 'A terminal pair with that name already exists' }
        }

        const workerDirectory = workerSession.metadata?.path?.trim()
        if (!workerDirectory) {
            return { type: 'error', message: 'Worker session is missing a working directory' }
        }

        const now = Date.now()
        let pair = this.toTerminalPair(this.store.terminalPairs.create({
            id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
            namespace,
            name: options.name,
            createdAt: now,
            updatedAt: now,
            state: 'recovering',
            workerSessionId: workerSession.id,
            supervisorSessionId: null,
            worker: this.buildTerminalPairSideRecipe(
                'worker',
                workerDirectory,
                options.name,
                workerSession.metadata?.startupCommand?.trim() || undefined
            ),
            supervisor: this.buildTerminalPairSideRecipe('supervisor', workerDirectory, options.name)
        }))

        await this.renameSession(workerSession.id, `${pair.name} worker`)
        await this.setShellSessionOptions(workerSession.id, {
            pinned: true,
            autoRespawn: true,
            startupCommand: pair.worker.startupCommand ?? null
        })
        if (pair.worker.startupCommand) {
            await this.writeSessionTerminalCommands(workerSession.id, [pair.worker.startupCommand], namespace)
        }

        pair = await this.persistTerminalPair({
            ...pair,
            updatedAt: Date.now(),
            state: 'recovering'
        })

        const recovered = await this.recoverTerminalPair(pair, namespace, { mode: 'launch', skipWorkerRecovery: true })
        return { type: 'success', pair: recovered }
    }

    getOrCreateSession(tag: string, metadata: unknown, agentState: unknown, namespace: string, model?: string): Session {
        return this.sessionCache.getOrCreateSession(tag, metadata, agentState, namespace, model)
    }

    getOrCreateMachine(id: string, metadata: unknown, runnerState: unknown, namespace: string): Machine {
        return this.machineCache.getOrCreateMachine(id, metadata, runnerState, namespace)
    }

    async approvePermission(
        sessionId: string,
        requestId: string,
        allowTools?: string[],
        decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort',
        answers?: Record<string, string[]> | Record<string, { answers: string[] }>
    ): Promise<void> {
        await this.rpcGateway.approvePermission(sessionId, requestId, allowTools, decision, answers)
    }

    async denyPermission(
        sessionId: string,
        requestId: string,
        decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort'
    ): Promise<void> {
        await this.rpcGateway.denyPermission(sessionId, requestId, decision)
    }

    async abortSession(sessionId: string): Promise<void> {
        await this.rpcGateway.abortSession(sessionId)
    }

    async archiveSession(sessionId: string): Promise<void> {
        await this.rpcGateway.killSession(sessionId)
        this.handleSessionEnd({ sid: sessionId, time: Date.now() })
    }

    async switchSession(sessionId: string, to: 'remote' | 'local'): Promise<void> {
        await this.rpcGateway.switchSession(sessionId, to)
    }

    async renameSession(sessionId: string, name: string): Promise<void> {
        await this.updateSessionDetails(sessionId, { name })
    }

    async updateSessionDetails(sessionId: string, updates: { name?: string; directory?: string }): Promise<void> {
        await this.sessionCache.updateSessionMetadataFields(sessionId, (metadata) => {
            const next = { ...metadata }
            if (updates.name !== undefined) {
                next.name = updates.name
            }
            if (updates.directory !== undefined) {
                if (metadata.worktree) {
                    next.worktree = {
                        ...metadata.worktree,
                        basePath: updates.directory
                    }
                } else {
                    next.path = updates.directory
                }
            }
            return next
        })
    }

    async setSessionNotesPath(sessionId: string, notesPath: string): Promise<void> {
        await this.sessionCache.updateSessionMetadataFields(sessionId, (metadata) => ({
            ...metadata,
            notesPath
        }))
    }

    async setParentSessionId(sessionId: string, parentSessionId: string): Promise<void> {
        await this.sessionCache.updateSessionMetadataFields(sessionId, (metadata) => ({
            ...metadata,
            parentSessionId
        }))
    }

    async setShellSessionOptions(sessionId: string, options: { pinned?: boolean; autoRespawn?: boolean; startupCommand?: string | null }): Promise<void> {
        await this.sessionCache.updateSessionMetadataFields(sessionId, (metadata) => ({
            ...metadata,
            ...this.resolveShellSessionOptions(metadata, options)
        }))
    }

    private resolveShellSessionOptions(
        metadata: NonNullable<Session['metadata']>,
        options: { pinned?: boolean; autoRespawn?: boolean; startupCommand?: string | null }
    ): Pick<NonNullable<Session['metadata']>, 'pinned' | 'autoRespawn' | 'startupCommand'> {
        const nextPinned = options.autoRespawn === true
            ? true
            : (options.pinned ?? metadata.pinned)
        const nextAutoRespawn = nextPinned
            ? (options.autoRespawn ?? metadata.autoRespawn ?? false)
            : undefined

        return {
            pinned: nextPinned,
            autoRespawn: nextAutoRespawn,
            startupCommand: options.startupCommand === undefined
                ? metadata.startupCommand
                : options.startupCommand || undefined
        }
    }

    async deleteSession(sessionId: string): Promise<void> {
        await this.sessionCache.deleteSession(sessionId)
        this.terminalStateCache.removeSession(sessionId)
    }

    async closeSession(sessionId: string): Promise<void> {
        const session = this.getSession(sessionId)
        if (!session) {
            throw new Error('Session not found')
        }

        if (session.metadata?.flavor === 'shell' && (session.metadata.pinned || session.metadata.autoRespawn)) {
            await this.setShellSessionOptions(sessionId, {
                pinned: false,
                autoRespawn: false
            })
        }

        const refreshed = this.getSession(sessionId)
        if (refreshed?.active) {
            await this.archiveSession(sessionId)
        }

        await this.deleteSession(sessionId)
    }

    async applySessionConfig(
        sessionId: string,
        config: {
            model?: string | null
        }
    ): Promise<void> {
        const result = await this.rpcGateway.requestSessionConfig(sessionId, config)
        if (!result || typeof result !== 'object') {
            throw new Error('Invalid response from session config RPC')
        }
        const obj = result as {
            applied?: {
                model?: Session['model']
            }
        }
        const applied = obj.applied
        if (!applied || typeof applied !== 'object') {
            throw new Error('Missing applied session config')
        }

        this.sessionCache.applySessionConfig(sessionId, applied)
    }

    async spawnSession(
        machineId: string,
        directory: string,
        sessionType?: 'simple' | 'worktree',
        worktreeName?: string,
        resumeSessionId?: string,
        startupCommand?: string
    ): Promise<{ type: 'success'; sessionId: string } | { type: 'error'; message: string }> {
        return await this.rpcGateway.spawnSession(machineId, directory, sessionType, worktreeName, resumeSessionId, startupCommand)
    }

    async spawnSessionForBoundMachine(
        namespace: string,
        directory: string,
        sessionType?: 'simple' | 'worktree',
        worktreeName?: string,
        resumeSessionId?: string,
        startupCommand?: string
    ): Promise<{ type: 'success'; sessionId: string } | { type: 'error'; message: string }> {
        const machine = this.getBoundMachine(namespace)
        if (!machine?.active) {
            return { type: 'error', message: 'No machine online' }
        }
        return await this.rpcGateway.spawnSession(machine.id, directory, sessionType, worktreeName, resumeSessionId, startupCommand)
    }

    async respawnPinnedShellSession(sessionId: string, namespace: string): Promise<ResumeSessionResult> {
        const access = this.sessionCache.resolveSessionAccess(sessionId, namespace)
        if (!access.ok) {
            return {
                type: 'error',
                message: access.reason === 'access-denied' ? 'Session access denied' : 'Session not found',
                code: access.reason === 'access-denied' ? 'access_denied' : 'session_not_found'
            }
        }

        const session = access.session
        const metadata = session.metadata
        if (!metadata || metadata.flavor !== 'shell') {
            return { type: 'error', message: 'Session is not a shell session', code: 'resume_unavailable' }
        }
        if (!metadata.pinned) {
            return { type: 'error', message: 'Session is not pinned', code: 'resume_unavailable' }
        }
        if (typeof metadata.path !== 'string' || !metadata.path.trim()) {
            return { type: 'error', message: 'Session metadata missing path', code: 'resume_unavailable' }
        }

        const targetMachine = this.getBoundMachine(namespace)
        if (!targetMachine?.active) {
            return { type: 'error', message: 'No machine online', code: 'no_machine_online' }
        }

        const spawnResult = await this.rpcGateway.spawnSession(
            targetMachine.id,
            metadata.path,
            undefined,
            undefined,
            undefined,
            metadata.startupCommand ?? undefined
        )
        if (spawnResult.type !== 'success') {
            return { type: 'error', message: spawnResult.message, code: 'resume_failed' }
        }

        await this.setShellSessionOptions(spawnResult.sessionId, {
            pinned: true,
            autoRespawn: metadata.autoRespawn === true,
            startupCommand: metadata.startupCommand ?? null
        })
        if (metadata.notesPath) {
            await this.setSessionNotesPath(spawnResult.sessionId, metadata.notesPath)
        }
        if (metadata.name?.trim()) {
            await this.renameSession(spawnResult.sessionId, metadata.name.trim())
        }

        const becameActive = await this.waitForSessionActive(spawnResult.sessionId)
        if (!becameActive) {
            return { type: 'error', message: 'Session failed to become active', code: 'resume_failed' }
        }

        if (spawnResult.sessionId !== access.sessionId) {
            try {
                await this.sessionCache.mergeSessions(access.sessionId, spawnResult.sessionId, namespace)
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Failed to merge respawned shell session'
                return { type: 'error', message, code: 'resume_failed' }
            }

            // Re-link supervision peers to the new session ID
            if (metadata.terminalSupervision?.peerSessionId) {
                const peerSessionId = metadata.terminalSupervision.peerSessionId
                try {
                    await this.sessionCache.updateSessionMetadataFields(peerSessionId, (peerMeta) => {
                        if (!peerMeta.terminalSupervision || peerMeta.terminalSupervision.peerSessionId !== access.sessionId) {
                            return peerMeta
                        }
                        return {
                            ...peerMeta,
                            terminalSupervision: {
                                ...peerMeta.terminalSupervision,
                                peerSessionId: spawnResult.sessionId
                            }
                        }
                    })
                } catch {
                    // Best-effort: supervision link may be stale but won't crash
                }
            }

            // Update terminal pair references to the new session ID
            const pairLink = metadata.terminalPair as { pairId?: string; role?: string } | undefined
            if (pairLink?.pairId) {
                try {
                    const pair = this.getTerminalPair(pairLink.pairId, namespace)
                    if (pair) {
                        const field = pairLink.role === 'worker' ? 'workerSessionId' : 'supervisorSessionId'
                        if ((pair as Record<string, unknown>)[field] === access.sessionId) {
                            await this.persistTerminalPair({
                                ...pair,
                                [field]: spawnResult.sessionId
                            })
                            await this.syncTerminalPairSessionMetadata(
                                { ...pair, [field]: spawnResult.sessionId }
                            )
                        }
                    }
                } catch {
                    // Best-effort: pair link may be stale but won't crash
                }
            }
        }

        return { type: 'success', sessionId: spawnResult.sessionId }
    }

    private async reconcileAutoRespawnPinnedShells(namespace: string): Promise<void> {
        const targetMachine = this.getBoundMachine(namespace)
        if (!targetMachine?.active) {
            return
        }

        const sessions = this.getSessionsByNamespace(namespace)
        for (const session of sessions) {
            const metadata = session.metadata
            if (!metadata || metadata.flavor !== 'shell' || metadata.pinned !== true || metadata.autoRespawn !== true) {
                continue
            }
            if (metadata.terminalPair) {
                continue
            }
            if (session.active && metadata.shellTerminalState !== 'stale') {
                continue
            }
            if (this.autoRespawnInFlightSessionIds.has(session.id)) {
                continue
            }

            this.autoRespawnInFlightSessionIds.add(session.id)
            try {
                await this.respawnPinnedShellSession(session.id, namespace)
            } catch {
                // Keep reconciliation best-effort; the existing UI fallback can still retry later.
            } finally {
                this.autoRespawnInFlightSessionIds.delete(session.id)
            }
        }
    }

    async attachTerminalSupervision(orchestratorSessionId: string, workerSessionId: string, namespace: string): Promise<void> {
        if (orchestratorSessionId === workerSessionId) {
            throw new Error('Worker and orchestrator must be different sessions')
        }

        const orchestrator = this.getRequiredSession(orchestratorSessionId, namespace)
        const worker = this.getRequiredSession(workerSessionId, namespace)

        this.assertTerminalSupervisionEligible(orchestrator, 'orchestrator')
        this.assertTerminalSupervisionEligible(worker, 'worker')
        this.assertTerminalSupervisionAvailable(orchestrator)
        this.assertTerminalSupervisionAvailable(worker)

        const event = this.createTerminalSupervisionEvent('attached', 'system', `Attached orchestrator ${orchestrator.id.slice(0, 8)} to worker ${worker.id.slice(0, 8)}`)

        await this.sessionCache.updateSessionMetadataFields(orchestrator.id, (metadata) => ({
            ...metadata,
            terminalSupervision: {
                role: 'orchestrator',
                peerSessionId: worker.id,
                state: 'active',
                events: this.appendTerminalSupervisionEvent(metadata.terminalSupervision, event)
            }
        }))

        await this.sessionCache.updateSessionMetadataFields(worker.id, (metadata) => ({
            ...metadata,
            terminalSupervision: {
                role: 'worker',
                peerSessionId: orchestrator.id,
                state: 'active',
                events: this.appendTerminalSupervisionEvent(metadata.terminalSupervision, event)
            }
        }))
    }

    async setTerminalSupervisionPaused(sessionId: string, paused: boolean, namespace: string): Promise<void> {
        const session = this.getRequiredSession(sessionId, namespace)
        const pairing = session.metadata?.terminalSupervision
        if (!pairing) {
            throw new Error('Session is not paired')
        }

        const peer = this.getRequiredSession(pairing.peerSessionId, namespace)
        const nextState: TerminalSupervision['state'] = paused ? 'paused' : 'active'
        const event = this.createTerminalSupervisionEvent(
            paused ? 'paused' : 'resumed',
            'human',
            paused ? 'Paused terminal supervision' : 'Resumed terminal supervision'
        )

        await this.sessionCache.updateSessionMetadataFields(session.id, (metadata) =>
            this.setTerminalSupervisionState(metadata, peer.id, pairing.role, nextState, event)
        )
        await this.sessionCache.updateSessionMetadataFields(peer.id, (metadata) =>
            this.setTerminalSupervisionState(
                metadata,
                session.id,
                metadata.terminalSupervision?.role === 'worker' ? 'worker' : 'orchestrator',
                nextState,
                event
            )
        )
    }

    async detachTerminalSupervision(sessionId: string, namespace: string): Promise<void> {
        const session = this.getRequiredSession(sessionId, namespace)
        const pairing = session.metadata?.terminalSupervision
        if (!pairing) {
            return
        }

        const peer = this.getSessionByNamespace(pairing.peerSessionId, namespace)
        await this.sessionCache.updateSessionMetadataFields(session.id, (metadata) => {
            const { terminalSupervision, ...rest } = metadata
            return rest
        })
        if (peer) {
            await this.sessionCache.updateSessionMetadataFields(peer.id, (metadata) => {
                const { terminalSupervision, ...rest } = metadata
                return rest
            })
        }
        this.recentHumanTerminalActivityBySessionId.delete(session.id)
        this.recentHumanTerminalActivityBySessionId.delete(pairing.peerSessionId)
    }

    noteHumanTerminalInput(sessionId: string): void {
        const session = this.getSession(sessionId)
        if (session?.metadata?.terminalSupervision?.role !== 'worker') {
            return
        }
        this.recentHumanTerminalActivityBySessionId.set(sessionId, Date.now())
    }

    getTerminalSupervisionTarget(sessionId: string, namespace: string): {
        session: Session
        peer: Session
        worker: Session
        orchestrator: Session
        snapshot: ReturnType<TerminalStateCache['getSnapshot']>
        events: TerminalSupervisionEvent[]
    } {
        const session = this.getRequiredSession(sessionId, namespace)
        const pairing = session.metadata?.terminalSupervision
        if (!pairing) {
            throw new Error('Session is not paired')
        }

        const peer = this.getRequiredSession(pairing.peerSessionId, namespace)
        const worker = pairing.role === 'worker' ? session : peer
        const orchestrator = pairing.role === 'orchestrator' ? session : peer
        const workerTerminalId = worker.metadata?.shellTerminalId
        const snapshot = workerTerminalId ? this.terminalStateCache.getSnapshot(worker.id, workerTerminalId) : null

        return {
            session,
            peer,
            worker,
            orchestrator,
            snapshot,
            events: worker.metadata?.terminalSupervision?.events ?? session.metadata?.terminalSupervision?.events ?? []
        }
    }

    async writeTerminalSupervisionInput(orchestratorSessionId: string, data: string, namespace: string): Promise<{
        delivered: boolean
        blockedReason?: 'paused' | 'human_override'
    }> {
        const orchestrator = this.getRequiredSession(orchestratorSessionId, namespace)
        const pairing = orchestrator.metadata?.terminalSupervision
        if (!pairing || pairing.role !== 'orchestrator') {
            throw new Error('Session is not an orchestrator')
        }

        const worker = this.getRequiredSession(pairing.peerSessionId, namespace)
        this.assertTerminalSupervisionEligible(worker, 'worker')

        if (pairing.state === 'paused' || worker.metadata?.terminalSupervision?.state === 'paused') {
            await this.recordTerminalSupervisionEvent(orchestrator, worker, 'write_blocked', 'orchestrator', 'Blocked orchestrator input because supervision is paused')
            return { delivered: false, blockedReason: 'paused' }
        }

        const lastHumanActivityAt = this.recentHumanTerminalActivityBySessionId.get(worker.id) ?? 0
        if (Date.now() - lastHumanActivityAt < this.terminalSupervisionHumanOverrideMs) {
            await this.recordTerminalSupervisionEvent(orchestrator, worker, 'write_blocked', 'orchestrator', 'Blocked orchestrator input because the human is actively using the worker terminal')
            return { delivered: false, blockedReason: 'human_override' }
        }

        const terminalId = worker.metadata?.shellTerminalId
        if (!terminalId || worker.metadata?.shellTerminalState !== 'ready') {
            throw new Error('Worker terminal is not ready')
        }

        const cliSocket = this.pickCliSocketForSession(worker.id, namespace)
        if (!cliSocket) {
            throw new Error('CLI is not connected for worker session')
        }

        cliSocket.emit('terminal:write', {
            sessionId: worker.id,
            terminalId,
            data
        })
        await this.recordTerminalSupervisionEvent(orchestrator, worker, 'write_accepted', 'orchestrator', 'Sent orchestrator input to worker terminal')
        return { delivered: true }
    }

    getTerminalSnapshot(sessionId: string, terminalId: string) {
        return this.terminalStateCache.getSnapshot(sessionId, terminalId)
    }

    private getRequiredSession(sessionId: string, namespace: string): Session {
        const session = this.getSessionByNamespace(sessionId, namespace)
        if (!session) {
            throw new Error('Session not found')
        }
        return session
    }

    private assertTerminalSupervisionEligible(session: Session, role: 'worker' | 'orchestrator'): void {
        if (!session.metadata?.shellTerminalId || session.metadata.shellTerminalState !== 'ready') {
            throw new Error(`${role === 'worker' ? 'Worker' : 'Orchestrator'} terminal is not ready`)
        }
    }

    private assertTerminalSupervisionAvailable(session: Session): void {
        if (session.metadata?.terminalSupervision) {
            throw new Error('Session is already paired')
        }
    }

    private createTerminalSupervisionEvent(
        type: TerminalSupervisionEvent['type'],
        actor: TerminalSupervisionEvent['actor'],
        message: string
    ): TerminalSupervisionEvent {
        return {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            createdAt: Date.now(),
            type,
            actor,
            message
        }
    }

    private appendTerminalSupervisionEvent(
        supervision: TerminalSupervision | undefined,
        event: TerminalSupervisionEvent
    ): TerminalSupervisionEvent[] {
        const next = [...(supervision?.events ?? []), event]
        return next.slice(Math.max(0, next.length - TERMINAL_SUPERVISION_EVENT_LIMIT))
    }

    private setTerminalSupervisionState(
        metadata: NonNullable<Metadata>,
        peerSessionId: string,
        role: TerminalSupervision['role'],
        state: TerminalSupervision['state'],
        event: TerminalSupervisionEvent
    ): NonNullable<Metadata> {
        return {
            ...metadata,
            terminalSupervision: {
                role,
                peerSessionId,
                state,
                events: this.appendTerminalSupervisionEvent(metadata.terminalSupervision, event)
            }
        }
    }

    private async recordTerminalSupervisionEvent(
        orchestrator: Session,
        worker: Session,
        type: TerminalSupervisionEvent['type'],
        actor: TerminalSupervisionEvent['actor'],
        message: string
    ): Promise<void> {
        const event = this.createTerminalSupervisionEvent(type, actor, message)
        await this.sessionCache.updateSessionMetadataFields(orchestrator.id, (metadata) => ({
            ...metadata,
            terminalSupervision: metadata.terminalSupervision ? {
                ...metadata.terminalSupervision,
                events: this.appendTerminalSupervisionEvent(metadata.terminalSupervision, event)
            } : metadata.terminalSupervision
        }))
        await this.sessionCache.updateSessionMetadataFields(worker.id, (metadata) => ({
            ...metadata,
            terminalSupervision: metadata.terminalSupervision ? {
                ...metadata.terminalSupervision,
                events: this.appendTerminalSupervisionEvent(metadata.terminalSupervision, event)
            } : metadata.terminalSupervision
        }))
    }

    private pickCliSocketForSession(sessionId: string, namespace: string) {
        const cliNamespace = this.io.of('/cli')
        const room = cliNamespace.adapter.rooms.get(`session:${sessionId}`)
        if (!room || room.size === 0) {
            return null
        }
        for (const socketId of room) {
            const cliSocket = cliNamespace.sockets.get(socketId)
            if (cliSocket && cliSocket.data.namespace === namespace) {
                return cliSocket
            }
        }
        return null
    }

    private toTerminalPair(stored: {
        id: string
        namespace: string
        name: string
        createdAt: number
        updatedAt: number
        state: string
        workerSessionId: string | null
        supervisorSessionId: string | null
        worker: unknown
        supervisor: unknown
    }): TerminalPair {
        const worker = TerminalPairSideRecipeSchema.parse(stored.worker)
        const supervisor = TerminalPairSideRecipeSchema.parse(stored.supervisor)
        const state = (stored.state === 'active' || stored.state === 'recovering' || stored.state === 'degraded' || stored.state === 'paused')
            ? stored.state
            : 'degraded'

        return {
            id: stored.id,
            namespace: stored.namespace,
            name: stored.name,
            createdAt: stored.createdAt,
            updatedAt: stored.updatedAt,
            state,
            workerSessionId: stored.workerSessionId,
            supervisorSessionId: stored.supervisorSessionId,
            worker,
            supervisor
        }
    }

    private buildTerminalPairSideRecipe(
        role: TerminalPairRole,
        workingDirectory: string,
        pairName: string,
        startupCommand?: string
    ): TerminalPairSideRecipe {
        return {
            role,
            workingDirectory,
            sessionName: `${pairName}_${role}`,
            startupCommand
        }
    }

    private async recoverTerminalPair(
        pair: TerminalPair,
        namespace: string,
        options: { mode: 'launch' | 'resume'; skipWorkerRecovery?: boolean }
    ): Promise<TerminalPair> {
        let current = await this.persistTerminalPair({
            ...pair,
            updatedAt: Date.now(),
            state: 'recovering'
        })

        const workerSessionId = options.skipWorkerRecovery && current.workerSessionId
            ? current.workerSessionId
            : await this.ensureTerminalPairSide(current, current.worker, namespace, {
                currentSessionId: current.workerSessionId,
                mode: options.mode,
                displayName: `${current.name} worker`
            })

        current = await this.persistTerminalPair({
            ...current,
            updatedAt: Date.now(),
            workerSessionId
        })

        try {
            const supervisorSessionId = await this.ensureTerminalPairSide(current, current.supervisor, namespace, {
                currentSessionId: current.supervisorSessionId,
                mode: options.mode,
                displayName: `${current.name} supervisor`
            })

            current = await this.persistTerminalPair({
                ...current,
                updatedAt: Date.now(),
                workerSessionId,
                supervisorSessionId,
                state: 'active'
            })
        } catch {
            current = await this.persistTerminalPair({
                ...current,
                updatedAt: Date.now(),
                workerSessionId,
                state: 'degraded'
            })
        }

        return current
    }

    private async ensureTerminalPairSide(
        pair: TerminalPair,
        recipe: TerminalPairSideRecipe,
        namespace: string,
        options: {
            currentSessionId: string | null
            mode: 'launch' | 'resume'
            displayName: string
        }
    ): Promise<string> {
        const currentSession = options.currentSessionId
            ? this.getSessionByNamespace(options.currentSessionId, namespace)
            : undefined
        if (currentSession?.active && currentSession.metadata?.shellTerminalState === 'ready') {
            return currentSession.id
        }

        const spawnResult = await this.spawnSessionForBoundMachine(
            namespace,
            recipe.workingDirectory,
            undefined,
            undefined,
            undefined,
            recipe.startupCommand
        )
        if (spawnResult.type !== 'success') {
            throw new Error(spawnResult.message)
        }

        await this.renameSession(spawnResult.sessionId, options.displayName)
        await this.setShellSessionOptions(spawnResult.sessionId, {
            pinned: true,
            autoRespawn: true,
            startupCommand: recipe.startupCommand ?? null
        })

        const shellReady = await this.waitForShellTerminalReady(spawnResult.sessionId)
        if (!shellReady) {
            throw new Error('Shell terminal failed to become ready')
        }

        return spawnResult.sessionId
    }

    private async persistTerminalPair(pair: TerminalPair): Promise<TerminalPair> {
        const updated = this.store.terminalPairs.update({
            id: pair.id,
            namespace: pair.namespace,
            name: pair.name,
            createdAt: pair.createdAt,
            updatedAt: pair.updatedAt,
            state: pair.state,
            workerSessionId: pair.workerSessionId,
            supervisorSessionId: pair.supervisorSessionId,
            worker: pair.worker,
            supervisor: pair.supervisor
        }) ?? this.store.terminalPairs.create({
            id: pair.id,
            namespace: pair.namespace,
            name: pair.name,
            createdAt: pair.createdAt,
            updatedAt: pair.updatedAt,
            state: pair.state,
            workerSessionId: pair.workerSessionId,
            supervisorSessionId: pair.supervisorSessionId,
            worker: pair.worker,
            supervisor: pair.supervisor
        })

        const next = this.toTerminalPair(updated)
        await this.syncTerminalPairSessionMetadata(next)
        return next
    }

    private async syncTerminalPairSessionMetadata(pair: TerminalPair): Promise<void> {
        const mappings: Array<{ sessionId: string | null; role: TerminalPairRole }> = [
            { sessionId: pair.workerSessionId, role: 'worker' },
            { sessionId: pair.supervisorSessionId, role: 'supervisor' }
        ]

        for (const mapping of mappings) {
            if (!mapping.sessionId) {
                continue
            }
            const session = this.getSessionByNamespace(mapping.sessionId, pair.namespace)
            if (!session) {
                continue
            }
            await this.sessionCache.updateSessionMetadataFields(mapping.sessionId, (metadata) => ({
                ...metadata,
                terminalPair: {
                    pairId: pair.id,
                    pairName: pair.name,
                    role: mapping.role,
                    state: pair.state
                }
            }))
        }
    }

    private async reconcileTerminalPairs(namespace: string): Promise<void> {
        const pairs = this.store.terminalPairs.getByNamespace(namespace).map((stored) => this.toTerminalPair(stored))
        for (const pair of pairs) {
            if (pair.state === 'paused') {
                continue
            }

            const worker = pair.workerSessionId ? this.getSessionByNamespace(pair.workerSessionId, namespace) : null
            const supervisor = pair.supervisorSessionId ? this.getSessionByNamespace(pair.supervisorSessionId, namespace) : null
            const workerReady = Boolean(worker?.active && worker.metadata?.shellTerminalState === 'ready')
            const supervisorReady = Boolean(supervisor?.active && supervisor.metadata?.shellTerminalState === 'ready')

            if (workerReady && supervisorReady) {
                continue
            }

            try {
                await this.recoverTerminalPair(pair, namespace, { mode: 'resume' })
            } catch {
                await this.persistTerminalPair({
                    ...pair,
                    updatedAt: Date.now(),
                    state: 'degraded'
                })
            }
        }
    }

    private async writeSessionTerminalInput(sessionId: string, data: string, namespace: string): Promise<void> {
        const session = this.getRequiredSession(sessionId, namespace)
        const terminalId = session.metadata?.shellTerminalId
        if (!terminalId || session.metadata?.shellTerminalState !== 'ready') {
            throw new Error('Session terminal is not ready')
        }
        const cliSocket = this.pickCliSocketForSession(sessionId, namespace)
        if (!cliSocket) {
            throw new Error('CLI is not connected for session')
        }
        cliSocket.emit('terminal:write', {
            sessionId,
            terminalId,
            data
        })
    }

    private async writeSessionTerminalCommands(sessionId: string, commands: string[], namespace: string): Promise<void> {
        for (const command of commands) {
            const trimmed = command.trim()
            if (!trimmed) {
                continue
            }
            await this.writeSessionTerminalInput(sessionId, `${trimmed}\n`, namespace)
        }
    }

    async waitForShellTerminalReady(sessionId: string, timeoutMs: number = 15_000): Promise<boolean> {
        const start = Date.now()
        while (Date.now() - start < timeoutMs) {
            const session = this.getSession(sessionId)
            if (session?.active && session.metadata?.shellTerminalId && session.metadata.shellTerminalState === 'ready') {
                return true
            }
            await new Promise((resolve) => setTimeout(resolve, 250))
        }
        return false
    }

    async waitForSessionActive(sessionId: string, timeoutMs: number = 15_000): Promise<boolean> {
        const start = Date.now()
        while (Date.now() - start < timeoutMs) {
            const session = this.getSession(sessionId)
            if (session?.active) {
                return true
            }
            await new Promise((resolve) => setTimeout(resolve, 250))
        }
        return false
    }

    async checkPathsExist(machineId: string, paths: string[]): Promise<Record<string, boolean>> {
        return await this.rpcGateway.checkPathsExist(machineId, paths)
    }

    async checkPathsExistForBoundMachine(namespace: string, paths: string[]): Promise<Record<string, boolean>> {
        const machine = this.getBoundMachine(namespace)
        if (!machine?.active) {
            throw new Error('No machine online')
        }
        return await this.rpcGateway.checkPathsExist(machine.id, paths)
    }

    async getGitStatus(sessionId: string, cwd?: string): Promise<RpcCommandResponse> {
        return await this.rpcGateway.getGitStatus(sessionId, cwd)
    }

    async getGitDiffNumstat(sessionId: string, options: { cwd?: string; staged?: boolean }): Promise<RpcCommandResponse> {
        return await this.rpcGateway.getGitDiffNumstat(sessionId, options)
    }

    async getGitDiffFile(sessionId: string, options: { cwd?: string; filePath: string; staged?: boolean }): Promise<RpcCommandResponse> {
        return await this.rpcGateway.getGitDiffFile(sessionId, options)
    }

    async getReviewSummary(sessionId: string, options: { cwd?: string; mode: RpcReviewMode }): Promise<RpcReviewSummaryResponse> {
        return await this.rpcGateway.getReviewSummary(sessionId, options)
    }

    async getReviewFile(sessionId: string, options: { cwd?: string; filePath: string; mode: RpcReviewMode }): Promise<RpcCommandResponse> {
        return await this.rpcGateway.getReviewFile(sessionId, options)
    }

    async readSessionFile(sessionId: string, path: string): Promise<RpcReadFileResponse> {
        return await this.rpcGateway.readSessionFile(sessionId, path)
    }

    async writeSessionFile(
        sessionId: string,
        path: string,
        content: string,
        expectedHash?: string | null
    ): Promise<RpcWriteFileResponse> {
        return await this.rpcGateway.writeSessionFile(sessionId, path, content, expectedHash)
    }

    async listDirectory(sessionId: string, path: string): Promise<RpcListDirectoryResponse> {
        return await this.rpcGateway.listDirectory(sessionId, path)
    }

    async uploadFile(sessionId: string, filename: string, content: string, mimeType: string): Promise<RpcUploadFileResponse> {
        return await this.rpcGateway.uploadFile(sessionId, filename, content, mimeType)
    }

    async deleteUploadFile(sessionId: string, path: string): Promise<RpcDeleteUploadResponse> {
        return await this.rpcGateway.deleteUploadFile(sessionId, path)
    }

    async runRipgrep(sessionId: string, args: string[], cwd?: string, limit?: number): Promise<RpcCommandResponse> {
        return await this.rpcGateway.runRipgrep(sessionId, args, cwd, limit)
    }

}
