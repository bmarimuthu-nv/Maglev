import type { Database } from 'bun:sqlite'

const DEFAULT_SYNCHRONOUS_MODE = 'NORMAL'
const CRITICAL_WRITE_SYNCHRONOUS_MODE = 'FULL'

export function durableWrite<T>(db: Database, write: () => T): T {
    db.exec(`PRAGMA synchronous = ${CRITICAL_WRITE_SYNCHRONOUS_MODE}`)
    try {
        return write()
    } finally {
        db.exec(`PRAGMA synchronous = ${DEFAULT_SYNCHRONOUS_MODE}`)
    }
}

