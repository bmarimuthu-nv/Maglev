import { AgentStateSchema, MetadataSchema } from '@maglev/protocol/schemas'
import type { PermissionMode, Session } from '@maglev/protocol/types'
import type { Store } from '../store'
import { clampAliveTime } from './aliveTime'
import { EventPublisher } from './eventPublisher'

export class SessionCache {
    private static readonly SESSION_TIMEOUT_MS = 30_000
    private static readonly DEAD_SESSION_CLEANUP_MS = 60_000
    private readonly sessions: Map<string, Session> = new Map()
    private readonly lastBroadcastAtBySessionId: Map<string, number> = new Map()

    constructor(
        private readonly store: Store,
        private readonly publisher: EventPublisher
    ) {
    }

    getSessions(): Session[] {
        return Array.from(this.sessions.values())
    }

    getSessionsByNamespace(namespace: string): Session[] {
        return this.getSessions().filter((session) => session.namespace === namespace)
    }

    getSession(sessionId: string): Session | undefined {
        return this.sessions.get(sessionId)
    }

    getSessionByNamespace(sessionId: string, namespace: string): Session | undefined {
        const session = this.sessions.get(sessionId)
        if (!session || session.namespace !== namespace) {
            return undefined
        }
        return session
    }

    resolveSessionAccess(
        sessionId: string,
        namespace: string
    ): { ok: true; sessionId: string; session: Session } | { ok: false; reason: 'not-found' | 'access-denied' } {
        const session = this.sessions.get(sessionId) ?? this.refreshSession(sessionId)
        if (session) {
            if (session.namespace !== namespace) {
                return { ok: false, reason: 'access-denied' }
            }
            return { ok: true, sessionId, session }
        }

        return { ok: false, reason: 'not-found' }
    }

    getActiveSessions(): Session[] {
        return this.getSessions().filter((session) => session.active)
    }

    getOrCreateSession(tag: string, metadata: unknown, agentState: unknown, namespace: string, model?: string): Session {
        const stored = this.store.sessions.getOrCreateSession(tag, metadata, agentState, namespace, model)
        return this.refreshSession(stored.id) ?? (() => { throw new Error('Failed to load session') })()
    }

    refreshSession(sessionId: string): Session | null {
        let stored = this.store.sessions.getSession(sessionId)
        if (!stored) {
            const existed = this.sessions.delete(sessionId)
            if (existed) {
                this.publisher.emit({ type: 'session-removed', sessionId })
            }
            return null
        }

        const existing = this.sessions.get(sessionId)

        const metadata = (() => {
            const parsed = MetadataSchema.safeParse(stored.metadata)
            return parsed.success ? parsed.data : null
        })()

        const agentState = (() => {
            const parsed = AgentStateSchema.safeParse(stored.agentState)
            return parsed.success ? parsed.data : null
        })()

        const session: Session = {
            id: stored.id,
            namespace: stored.namespace,
            seq: stored.seq,
            createdAt: stored.createdAt,
            updatedAt: stored.updatedAt,
            active: existing?.active ?? stored.active,
            activeAt: existing?.activeAt ?? (stored.activeAt ?? stored.createdAt),
            metadata,
            metadataVersion: stored.metadataVersion,
            agentState,
            agentStateVersion: stored.agentStateVersion,
            thinking: existing?.thinking ?? false,
            thinkingAt: existing?.thinkingAt ?? 0,
            model: stored.model,
            permissionMode: existing?.permissionMode
        }

        this.sessions.set(sessionId, session)
        this.publisher.emit({ type: existing ? 'session-updated' : 'session-added', sessionId, data: session })
        return session
    }

    reloadAll(): void {
        const sessions = this.store.sessions.getSessions()
        for (const session of sessions) {
            this.refreshSession(session.id)
        }
    }

    handleSessionAlive(payload: {
        sid: string
        time: number
        thinking?: boolean
        mode?: 'local' | 'remote'
        permissionMode?: PermissionMode
        model?: string | null
    }): void {
        const t = clampAliveTime(payload.time)
        if (!t) return

        const session = this.sessions.get(payload.sid) ?? this.refreshSession(payload.sid)
        if (!session) return

        const wasActive = session.active
        const wasThinking = session.thinking
        const previousPermissionMode = session.permissionMode
        const previousModel = session.model

        session.active = true
        session.activeAt = Math.max(session.activeAt, t)
        session.thinking = Boolean(payload.thinking)
        session.thinkingAt = t
        this.store.sessions.setSessionActivity(session.id, session.namespace, {
            active: true,
            activeAt: session.activeAt,
            updatedAt: t
        })
        if (payload.permissionMode !== undefined) {
            session.permissionMode = payload.permissionMode
        }
        if (payload.model !== undefined) {
            if (payload.model !== session.model) {
                this.store.sessions.setSessionModel(payload.sid, payload.model, session.namespace, {
                    touchUpdatedAt: false
                })
            }
            session.model = payload.model
        }

        const now = Date.now()
        const lastBroadcastAt = this.lastBroadcastAtBySessionId.get(session.id) ?? 0
        const modeChanged = previousPermissionMode !== session.permissionMode
            || previousModel !== session.model
        const shouldBroadcast = (!wasActive && session.active)
            || (wasThinking !== session.thinking)
            || modeChanged
            || (now - lastBroadcastAt > 10_000)

        if (shouldBroadcast) {
            this.lastBroadcastAtBySessionId.set(session.id, now)
            this.publisher.emit({
                type: 'session-updated',
                sessionId: session.id,
                data: {
                    active: true,
                    activeAt: session.activeAt,
                    thinking: session.thinking,
                    permissionMode: session.permissionMode,
                    model: session.model
                }
            })
        }
    }

    handleSessionEnd(payload: { sid: string; time: number }): void {
        const t = clampAliveTime(payload.time) ?? Date.now()

        const session = this.sessions.get(payload.sid) ?? this.refreshSession(payload.sid)
        if (!session) return

        if (!session.active && !session.thinking) {
            return
        }

        session.active = false
        session.thinking = false
        session.thinkingAt = t
        this.store.sessions.setSessionActivity(session.id, session.namespace, {
            active: false,
            activeAt: t,
            updatedAt: t
        })

        this.publisher.emit({ type: 'session-updated', sessionId: session.id, data: { active: false, thinking: false } })
    }

    private shouldRetainInactiveSession(session: Session): boolean {
        return session.metadata?.flavor === 'shell' && session.metadata?.pinned === true
    }

    expireInactive(now: number = Date.now()): void {
        for (const session of Array.from(this.sessions.values())) {
            if (session.active && now - session.activeAt > SessionCache.SESSION_TIMEOUT_MS) {
                session.active = false
                session.thinking = false
                this.store.sessions.setSessionActivity(session.id, session.namespace, {
                    active: false,
                    activeAt: now,
                    updatedAt: now
                })
                this.publisher.emit({ type: 'session-updated', sessionId: session.id, data: { active: false } })
            }

            if (session.active) {
                continue
            }

            const lastSeenAt = Math.max(session.activeAt, session.updatedAt, session.createdAt)
            if (now - lastSeenAt <= SessionCache.DEAD_SESSION_CLEANUP_MS) {
                continue
            }

            if (this.shouldRetainInactiveSession(session)) {
                continue
            }

            const deleted = this.store.sessions.deleteSession(session.id, session.namespace)
            if (!deleted) {
                continue
            }

            this.sessions.delete(session.id)
            this.lastBroadcastAtBySessionId.delete(session.id)
            this.publisher.emit({ type: 'session-removed', sessionId: session.id, namespace: session.namespace })
        }
    }

    applySessionConfig(
        sessionId: string,
        config: {
            permissionMode?: PermissionMode
            model?: string | null
        }
    ): void {
        const session = this.sessions.get(sessionId) ?? this.refreshSession(sessionId)
        if (!session) {
            return
        }

        if (config.permissionMode !== undefined) {
            session.permissionMode = config.permissionMode
        }
        if (config.model !== undefined) {
            if (config.model !== session.model) {
                const updated = this.store.sessions.setSessionModel(sessionId, config.model, session.namespace, {
                    touchUpdatedAt: false
                })
                if (!updated) {
                    throw new Error('Failed to update session model')
                }
            }
            session.model = config.model
        }

        this.publisher.emit({ type: 'session-updated', sessionId, data: session })
    }

    async renameSession(sessionId: string, name: string): Promise<void> {
        const session = this.sessions.get(sessionId)
        if (!session) {
            throw new Error('Session not found')
        }

        const currentMetadata = session.metadata ?? { path: '', host: '' }
        const newMetadata = { ...currentMetadata, name }

        const result = this.store.sessions.updateSessionMetadata(
            sessionId,
            newMetadata,
            session.metadataVersion,
            session.namespace,
            { touchUpdatedAt: false }
        )

        if (result.result === 'error') {
            throw new Error('Failed to update session metadata')
        }

        if (result.result === 'version-mismatch') {
            throw new Error('Session was modified concurrently. Please try again.')
        }

        this.refreshSession(sessionId)
    }

    async updateSessionMetadataFields(
        sessionId: string,
        mutate: (metadata: NonNullable<Session['metadata']>) => NonNullable<Session['metadata']>
    ): Promise<void> {
        const session = this.sessions.get(sessionId)
        if (!session) {
            throw new Error('Session not found')
        }

        const currentMetadata = session.metadata ?? { path: '', host: '' }
        const newMetadata = mutate(currentMetadata)

        const result = this.store.sessions.updateSessionMetadata(
            sessionId,
            newMetadata,
            session.metadataVersion,
            session.namespace,
            { touchUpdatedAt: false }
        )

        if (result.result === 'error') {
            throw new Error('Failed to update session metadata')
        }

        if (result.result === 'version-mismatch') {
            throw new Error('Session was modified concurrently. Please try again.')
        }

        this.refreshSession(sessionId)
    }

    async deleteSession(sessionId: string): Promise<void> {
        const session = this.sessions.get(sessionId)
        if (!session) {
            throw new Error('Session not found')
        }

        if (session.active) {
            throw new Error('Cannot delete active session')
        }

        const deleted = this.store.sessions.deleteSession(sessionId, session.namespace)
        if (!deleted) {
            throw new Error('Failed to delete session')
        }

        this.sessions.delete(sessionId)
        this.lastBroadcastAtBySessionId.delete(sessionId)

        this.publisher.emit({ type: 'session-removed', sessionId, namespace: session.namespace })
    }

    async mergeSessions(oldSessionId: string, newSessionId: string, namespace: string): Promise<void> {
        if (oldSessionId === newSessionId) {
            return
        }

        const oldStored = this.store.sessions.getSessionByNamespace(oldSessionId, namespace)
        const newStored = this.store.sessions.getSessionByNamespace(newSessionId, namespace)
        if (!oldStored || !newStored) {
            throw new Error('Session not found for merge')
        }

        const mergedMetadata = this.mergeSessionMetadata(oldStored.metadata, newStored.metadata)
        if (mergedMetadata !== null && mergedMetadata !== newStored.metadata) {
            for (let attempt = 0; attempt < 2; attempt += 1) {
                const latest = this.store.sessions.getSessionByNamespace(newSessionId, namespace)
                if (!latest) break
                const result = this.store.sessions.updateSessionMetadata(
                    newSessionId,
                    mergedMetadata,
                    latest.metadataVersion,
                    namespace,
                    { touchUpdatedAt: false }
                )
                if (result.result === 'success') {
                    break
                }
                if (result.result === 'error') {
                    break
                }
            }
        }

        if (newStored.model === null && oldStored.model !== null) {
            const updated = this.store.sessions.setSessionModel(newSessionId, oldStored.model, namespace, {
                touchUpdatedAt: false
            })
            if (!updated) {
                throw new Error('Failed to preserve session model during merge')
            }
        }

        const deleted = this.store.sessions.deleteSession(oldSessionId, namespace)
        if (!deleted) {
            throw new Error('Failed to delete old session during merge')
        }

        const existed = this.sessions.delete(oldSessionId)
        if (existed) {
            this.publisher.emit({ type: 'session-removed', sessionId: oldSessionId, namespace })
        }
        this.lastBroadcastAtBySessionId.delete(oldSessionId)

        this.refreshSession(newSessionId)
    }

    private mergeSessionMetadata(oldMetadata: unknown | null, newMetadata: unknown | null): unknown | null {
        if (!oldMetadata || typeof oldMetadata !== 'object') {
            return newMetadata
        }
        if (!newMetadata || typeof newMetadata !== 'object') {
            return oldMetadata
        }

        const oldObj = oldMetadata as Record<string, unknown>
        const newObj = newMetadata as Record<string, unknown>
        const merged: Record<string, unknown> = { ...newObj }
        let changed = false

        if (typeof oldObj.name === 'string' && typeof newObj.name !== 'string') {
            merged.name = oldObj.name
            changed = true
        }

        const oldSummary = oldObj.summary as { text?: unknown; updatedAt?: unknown } | undefined
        const newSummary = newObj.summary as { text?: unknown; updatedAt?: unknown } | undefined
        const oldUpdatedAt = typeof oldSummary?.updatedAt === 'number' ? oldSummary.updatedAt : null
        const newUpdatedAt = typeof newSummary?.updatedAt === 'number' ? newSummary.updatedAt : null
        if (oldUpdatedAt !== null && (newUpdatedAt === null || oldUpdatedAt > newUpdatedAt)) {
            merged.summary = oldSummary
            changed = true
        }

        if (oldObj.worktree && !newObj.worktree) {
            merged.worktree = oldObj.worktree
            changed = true
        }

        if (typeof oldObj.path === 'string' && typeof newObj.path !== 'string') {
            merged.path = oldObj.path
            changed = true
        }
        if (typeof oldObj.host === 'string' && typeof newObj.host !== 'string') {
            merged.host = oldObj.host
            changed = true
        }

        return changed ? merged : newMetadata
    }
}
