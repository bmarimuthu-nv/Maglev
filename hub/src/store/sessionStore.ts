import type { Database } from 'bun:sqlite'

import type { StoredSession, VersionedUpdateResult } from './types'
import {
    deleteSession,
    getOrCreateSession,
    getSession,
    getSessionByNamespace,
    getSessions,
    getSessionsByNamespace,
    setSessionActivity,
    setSessionModel,
    updateSessionAgentState,
    updateSessionMetadata
} from './sessions'

export class SessionStore {
    private readonly db: Database

    constructor(db: Database) {
        this.db = db
    }

    getOrCreateSession(tag: string, metadata: unknown, agentState: unknown, namespace: string, model?: string): StoredSession {
        return getOrCreateSession(this.db, tag, metadata, agentState, namespace, model)
    }

    updateSessionMetadata(
        id: string,
        metadata: unknown,
        expectedVersion: number,
        namespace: string,
        options?: { touchUpdatedAt?: boolean }
    ): VersionedUpdateResult<unknown | null> {
        return updateSessionMetadata(this.db, id, metadata, expectedVersion, namespace, options)
    }

    updateSessionAgentState(
        id: string,
        agentState: unknown,
        expectedVersion: number,
        namespace: string
    ): VersionedUpdateResult<unknown | null> {
        return updateSessionAgentState(this.db, id, agentState, expectedVersion, namespace)
    }

    setSessionModel(id: string, model: string | null, namespace: string, options?: { touchUpdatedAt?: boolean }): boolean {
        return setSessionModel(this.db, id, model, namespace, options)
    }

    getSession(id: string): StoredSession | null {
        return getSession(this.db, id)
    }

    getSessionByNamespace(id: string, namespace: string): StoredSession | null {
        return getSessionByNamespace(this.db, id, namespace)
    }

    getSessions(): StoredSession[] {
        return getSessions(this.db)
    }

    getSessionsByNamespace(namespace: string): StoredSession[] {
        return getSessionsByNamespace(this.db, namespace)
    }

    setSessionActivity(
        id: string,
        namespace: string,
        activity: {
            active: boolean
            activeAt?: number | null
            updatedAt: number
        }
    ): boolean {
        return setSessionActivity(this.db, id, namespace, activity)
    }

    deleteSession(id: string, namespace: string): boolean {
        return deleteSession(this.db, id, namespace)
    }
}
