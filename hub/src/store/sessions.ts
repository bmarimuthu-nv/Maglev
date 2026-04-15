import type { Database } from 'bun:sqlite'
import { randomUUID } from 'node:crypto'

import type { StoredSession, VersionedUpdateResult } from './types'
import { safeJsonParse } from './json'
import { updateVersionedField } from './versionedUpdates'

type DbSessionRow = {
    id: string
    tag: string | null
    namespace: string
    machine_id: string | null
    created_at: number
    updated_at: number
    metadata: string | null
    metadata_version: number
    agent_state: string | null
    agent_state_version: number
    model: string | null
    active: number
    active_at: number | null
    seq: number
}

function toStoredSession(row: DbSessionRow): StoredSession {
    return {
        id: row.id,
        tag: row.tag,
        namespace: row.namespace,
        machineId: row.machine_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        metadata: safeJsonParse(row.metadata),
        metadataVersion: row.metadata_version,
        agentState: safeJsonParse(row.agent_state),
        agentStateVersion: row.agent_state_version,
        model: row.model,
        active: row.active === 1,
        activeAt: row.active_at,
        seq: row.seq
    }
}

export function getOrCreateSession(
    db: Database,
    tag: string,
    metadata: unknown,
    agentState: unknown,
    namespace: string,
    model?: string
): StoredSession {
    const existing = db.prepare(
        'SELECT * FROM sessions WHERE tag = ? AND namespace = ? ORDER BY created_at DESC LIMIT 1'
    ).get(tag, namespace) as DbSessionRow | undefined

    if (existing) {
        return toStoredSession(existing)
    }

    const now = Date.now()
    const id = randomUUID()

    const metadataJson = JSON.stringify(metadata)
    const agentStateJson = agentState === null || agentState === undefined ? null : JSON.stringify(agentState)

    db.prepare(`
        INSERT INTO sessions (
            id, tag, namespace, machine_id, created_at, updated_at,
            metadata, metadata_version,
            agent_state, agent_state_version,
            model,
            active, active_at, seq
        ) VALUES (
            @id, @tag, @namespace, NULL, @created_at, @updated_at,
            @metadata, 1,
            @agent_state, 1,
            @model,
            0, NULL, 0
        )
    `).run({
        id,
        tag,
        namespace,
        created_at: now,
        updated_at: now,
        metadata: metadataJson,
        agent_state: agentStateJson,
        model: model ?? null
    })

    const row = getSession(db, id)
    if (!row) {
        throw new Error('Failed to create session')
    }
    return row
}

export function updateSessionMetadata(
    db: Database,
    id: string,
    metadata: unknown,
    expectedVersion: number,
    namespace: string,
    options?: { touchUpdatedAt?: boolean }
): VersionedUpdateResult<unknown | null> {
    const now = Date.now()
    const touchUpdatedAt = options?.touchUpdatedAt !== false

    return updateVersionedField({
        db,
        table: 'sessions',
        id,
        namespace,
        field: 'metadata',
        versionField: 'metadata_version',
        expectedVersion,
        value: metadata,
        encode: (value) => {
            const json = JSON.stringify(value)
            return json === undefined ? null : json
        },
        decode: safeJsonParse,
        setClauses: [
            'updated_at = CASE WHEN @touch_updated_at = 1 THEN @updated_at ELSE updated_at END',
            'seq = seq + 1'
        ],
        params: {
            updated_at: now,
            touch_updated_at: touchUpdatedAt ? 1 : 0
        }
    })
}

export function updateSessionAgentState(
    db: Database,
    id: string,
    agentState: unknown,
    expectedVersion: number,
    namespace: string
): VersionedUpdateResult<unknown | null> {
    const now = Date.now()
    const normalized = agentState ?? null

    return updateVersionedField({
        db,
        table: 'sessions',
        id,
        namespace,
        field: 'agent_state',
        versionField: 'agent_state_version',
        expectedVersion,
        value: normalized,
        encode: (value) => (value === null ? null : JSON.stringify(value)),
        decode: safeJsonParse,
        setClauses: ['updated_at = @updated_at', 'seq = seq + 1'],
        params: { updated_at: now }
    })
}

export function setSessionModel(
    db: Database,
    id: string,
    model: string | null,
    namespace: string,
    options?: { touchUpdatedAt?: boolean }
): boolean {
    const now = Date.now()
    const touchUpdatedAt = options?.touchUpdatedAt === true

    try {
        const result = db.prepare(`
            UPDATE sessions
            SET model = @model,
                updated_at = CASE WHEN @touch_updated_at = 1 THEN @updated_at ELSE updated_at END,
                seq = seq + 1
            WHERE id = @id
              AND namespace = @namespace
              AND model IS NOT @model
        `).run({
            id,
            namespace,
            model,
            updated_at: now,
            touch_updated_at: touchUpdatedAt ? 1 : 0
        })

        return result.changes === 1
    } catch {
        return false
    }
}

export function getSession(db: Database, id: string): StoredSession | null {
    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as DbSessionRow | undefined
    return row ? toStoredSession(row) : null
}

export function getSessionByNamespace(db: Database, id: string, namespace: string): StoredSession | null {
    const row = db.prepare(
        'SELECT * FROM sessions WHERE id = ? AND namespace = ?'
    ).get(id, namespace) as DbSessionRow | undefined
    return row ? toStoredSession(row) : null
}

export function getSessions(db: Database): StoredSession[] {
    const rows = db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC').all() as DbSessionRow[]
    return rows.map(toStoredSession)
}

export function getSessionsByNamespace(db: Database, namespace: string): StoredSession[] {
    const rows = db.prepare(
        'SELECT * FROM sessions WHERE namespace = ? ORDER BY updated_at DESC'
    ).all(namespace) as DbSessionRow[]
    return rows.map(toStoredSession)
}

export function setSessionActivity(
    db: Database,
    id: string,
    namespace: string,
    activity: {
        active: boolean
        activeAt?: number | null
        updatedAt: number
    }
): boolean {
    const nextActiveAt = activity.activeAt ?? null
    const result = db.prepare(`
        UPDATE sessions
        SET active = @active,
            active_at = CASE
                WHEN @active_at IS NULL THEN active_at
                WHEN active_at IS NULL OR active_at < @active_at THEN @active_at
                ELSE active_at
            END,
            updated_at = CASE
                WHEN updated_at > @updated_at THEN updated_at
                ELSE @updated_at
            END
        WHERE id = @id
          AND namespace = @namespace
    `).run({
        id,
        namespace,
        active: activity.active ? 1 : 0,
        active_at: nextActiveAt,
        updated_at: activity.updatedAt
    })

    return result.changes > 0
}

export function deleteSession(db: Database, id: string, namespace: string): boolean {
    const result = db.prepare(
        'DELETE FROM sessions WHERE id = ? AND namespace = ?'
    ).run(id, namespace)
    return result.changes > 0
}
