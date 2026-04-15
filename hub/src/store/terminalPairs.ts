import type { Database } from 'bun:sqlite'
import type { StoredTerminalPair } from './types'
import { safeJsonParse } from './json'

type DbTerminalPairRow = {
    id: string
    namespace: string
    name: string
    created_at: number
    updated_at: number
    state: string
    worker_session_id: string | null
    orchestrator_session_id: string | null
    worker: string
    orchestrator: string
}

function toStoredTerminalPair(row: DbTerminalPairRow): StoredTerminalPair {
    return {
        id: row.id,
        namespace: row.namespace,
        name: row.name,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        state: row.state,
        workerSessionId: row.worker_session_id,
        supervisorSessionId: row.orchestrator_session_id,
        worker: safeJsonParse(row.worker),
        supervisor: safeJsonParse(row.orchestrator)
    }
}

export function getTerminalPairsByNamespace(db: Database, namespace: string): StoredTerminalPair[] {
    const rows = db.prepare(
        'SELECT * FROM terminal_pairs WHERE namespace = ? ORDER BY updated_at DESC'
    ).all(namespace) as DbTerminalPairRow[]
    return rows.map(toStoredTerminalPair)
}

export function getTerminalPairById(db: Database, id: string, namespace: string): StoredTerminalPair | null {
    const row = db.prepare(
        'SELECT * FROM terminal_pairs WHERE id = ? AND namespace = ? LIMIT 1'
    ).get(id, namespace) as DbTerminalPairRow | undefined
    return row ? toStoredTerminalPair(row) : null
}

export function getTerminalPairByName(db: Database, name: string, namespace: string): StoredTerminalPair | null {
    const row = db.prepare(
        'SELECT * FROM terminal_pairs WHERE name = ? AND namespace = ? LIMIT 1'
    ).get(name, namespace) as DbTerminalPairRow | undefined
    return row ? toStoredTerminalPair(row) : null
}

export function createTerminalPair(
    db: Database,
    pair: StoredTerminalPair
): StoredTerminalPair {
    db.prepare(`
        INSERT INTO terminal_pairs (
            id, namespace, name, created_at, updated_at, state,
            worker_session_id, orchestrator_session_id, worker, orchestrator
        ) VALUES (
            @id, @namespace, @name, @created_at, @updated_at, @state,
            @worker_session_id, @orchestrator_session_id, @worker, @orchestrator
        )
    `).run({
        id: pair.id,
        namespace: pair.namespace,
        name: pair.name,
        created_at: pair.createdAt,
        updated_at: pair.updatedAt,
        state: pair.state,
        worker_session_id: pair.workerSessionId,
        orchestrator_session_id: pair.supervisorSessionId,
        worker: JSON.stringify(pair.worker),
        orchestrator: JSON.stringify(pair.supervisor)
    })
    return getTerminalPairById(db, pair.id, pair.namespace) ?? pair
}

export function updateTerminalPair(
    db: Database,
    pair: StoredTerminalPair
): StoredTerminalPair | null {
    const result = db.prepare(`
        UPDATE terminal_pairs
        SET updated_at = @updated_at,
            state = @state,
            worker_session_id = @worker_session_id,
            orchestrator_session_id = @orchestrator_session_id,
            worker = @worker,
            orchestrator = @orchestrator
        WHERE id = @id
          AND namespace = @namespace
    `).run({
        id: pair.id,
        namespace: pair.namespace,
        updated_at: pair.updatedAt,
        state: pair.state,
        worker_session_id: pair.workerSessionId,
        orchestrator_session_id: pair.supervisorSessionId,
        worker: JSON.stringify(pair.worker),
        orchestrator: JSON.stringify(pair.supervisor)
    })
    if (result.changes !== 1) {
        return null
    }
    return getTerminalPairById(db, pair.id, pair.namespace)
}
