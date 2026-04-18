import { Database } from 'bun:sqlite'
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, renameSync } from 'node:fs'
import { dirname } from 'node:path'

import { MachineStore } from './machineStore'
import { PushStore } from './pushStore'
import { SessionStore } from './sessionStore'
import { TerminalPairStore } from './terminalPairStore'
import { UserStore } from './userStore'

export type {
    StoredMachine,
    StoredPushSubscription,
    StoredSession,
    StoredTerminalPair,
    StoredUser,
    VersionedUpdateResult
} from './types'
export { MachineStore } from './machineStore'
export { PushStore } from './pushStore'
export { SessionStore } from './sessionStore'
export { TerminalPairStore } from './terminalPairStore'
export { UserStore } from './userStore'

const SCHEMA_VERSION: number = 7
const REQUIRED_TABLES = [
    'sessions',
    'terminal_pairs',
    'machines',
    'users',
    'push_subscriptions'
] as const

export class Store {
    private db: Database
    private readonly dbPath: string

    readonly sessions: SessionStore
    readonly machines: MachineStore
    readonly users: UserStore
    readonly push: PushStore
    readonly terminalPairs: TerminalPairStore

    constructor(dbPath: string) {
        this.dbPath = dbPath
        this.ensureDbPathReady()
        this.db = this.openDatabaseWithRecovery()

        this.sessions = new SessionStore(this.db)
        this.machines = new MachineStore(this.db)
        this.users = new UserStore(this.db)
        this.push = new PushStore(this.db)
        this.terminalPairs = new TerminalPairStore(this.db)
    }

    private ensureDbPathReady(): void {
        if (!this.isFileBackedDatabase()) {
            return
        }

        const dir = dirname(this.dbPath)
        mkdirSync(dir, { recursive: true, mode: 0o700 })
        try {
            chmodSync(dir, 0o700)
        } catch {
        }

        if (!existsSync(this.dbPath)) {
            try {
                const fd = openSync(this.dbPath, 'a', 0o600)
                closeSync(fd)
            } catch {
            }
        }
    }

    private openDatabaseWithRecovery(): Database {
        try {
            return this.initializeDatabase()
        } catch (error) {
            this.closeDatabaseQuietly()
            if (!this.shouldRecoverFromDatabaseError(error)) {
                throw error
            }

            const quarantinedPath = this.quarantineDatabaseFiles()
            console.error(
                `[Hub] SQLite database at ${this.dbPath} was unreadable. Moved it to ${quarantinedPath} and created a fresh database.`
            )

            try {
                return this.initializeDatabase()
            } catch (recoveryError) {
                this.closeDatabaseQuietly()
                throw recoveryError
            }
        }
    }

    private initializeDatabase(): Database {
        const db = new Database(this.dbPath, { create: true, readwrite: true, strict: true })
        this.db = db
        this.db.exec('PRAGMA journal_mode = WAL')
        this.db.exec('PRAGMA synchronous = NORMAL')
        this.db.exec('PRAGMA foreign_keys = ON')
        this.db.exec('PRAGMA busy_timeout = 5000')
        this.initSchema()
        this.assertDatabaseHealthy()
        this.ensureDbFilePermissions()
        return db
    }

    private assertDatabaseHealthy(): void {
        const rows = this.db.prepare('PRAGMA quick_check(1)').all() as Array<Record<string, unknown>>
        const firstRow = rows[0]
        const result = firstRow ? Object.values(firstRow)[0] : 'ok'
        if (result !== 'ok') {
            throw new Error(`SQLite quick_check failed: ${String(result)}`)
        }
    }

    private shouldRecoverFromDatabaseError(error: unknown): boolean {
        if (!this.isFileBackedDatabase()) {
            return false
        }

        const code = typeof error === 'object' && error !== null && 'code' in error
            ? String(error.code)
            : ''
        const message = error instanceof Error ? error.message : String(error)

        return code === 'SQLITE_CORRUPT'
            || code === 'SQLITE_NOTADB'
            || /database disk image is malformed/i.test(message)
            || /file is not a database/i.test(message)
            || /sqlite quick_check failed/i.test(message)
    }

    private quarantineDatabaseFiles(): string {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
        const backupBasePath = `${this.dbPath}.corrupt-${timestamp}`
        const files = [
            [this.dbPath, backupBasePath],
            [`${this.dbPath}-wal`, `${backupBasePath}-wal`],
            [`${this.dbPath}-shm`, `${backupBasePath}-shm`]
        ] as const

        for (const [source, target] of files) {
            if (!existsSync(source)) {
                continue
            }
            renameSync(source, target)
        }

        return backupBasePath
    }

    private ensureDbFilePermissions(): void {
        if (!this.isFileBackedDatabase()) {
            return
        }

        for (const path of [this.dbPath, `${this.dbPath}-wal`, `${this.dbPath}-shm`]) {
            try {
                chmodSync(path, 0o600)
            } catch {
            }
        }
    }

    close(): void {
        this.closeDatabaseQuietly()
    }

    private closeDatabaseQuietly(): void {
        try {
            this.db.close()
        } catch {
        }
    }

    private isFileBackedDatabase(): boolean {
        return this.dbPath !== ':memory:' && !this.dbPath.startsWith('file::memory:')
    }

    private initSchema(): void {
        const currentVersion = this.getUserVersion()
        if (currentVersion === 0) {
            if (this.hasAnyUserTables()) {
                throw this.buildSchemaMismatchError(currentVersion)
            }

            this.createSchema()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion !== SCHEMA_VERSION) {
            throw this.buildSchemaMismatchError(currentVersion)
        }

        this.assertRequiredTablesPresent()
    }

    private createSchema(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                tag TEXT,
                namespace TEXT NOT NULL DEFAULT 'default',
                machine_id TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                metadata TEXT,
                metadata_version INTEGER DEFAULT 1,
                agent_state TEXT,
                agent_state_version INTEGER DEFAULT 1,
                model TEXT,
                active INTEGER DEFAULT 0,
                active_at INTEGER,
                seq INTEGER DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_sessions_tag ON sessions(tag);
            CREATE INDEX IF NOT EXISTS idx_sessions_tag_namespace ON sessions(tag, namespace);

            CREATE TABLE IF NOT EXISTS terminal_pairs (
                id TEXT PRIMARY KEY,
                namespace TEXT NOT NULL DEFAULT 'default',
                name TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                state TEXT NOT NULL,
                worker_session_id TEXT,
                orchestrator_session_id TEXT,
                worker TEXT NOT NULL,
                orchestrator TEXT NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_terminal_pairs_name_namespace ON terminal_pairs(name, namespace);
            CREATE INDEX IF NOT EXISTS idx_terminal_pairs_namespace ON terminal_pairs(namespace);

            CREATE TABLE IF NOT EXISTS machines (
                id TEXT PRIMARY KEY,
                namespace TEXT NOT NULL DEFAULT 'default',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                metadata TEXT,
                metadata_version INTEGER DEFAULT 1,
                runner_state TEXT,
                runner_state_version INTEGER DEFAULT 1,
                active INTEGER DEFAULT 0,
                active_at INTEGER,
                seq INTEGER DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_machines_namespace ON machines(namespace);

            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                platform TEXT NOT NULL,
                platform_user_id TEXT NOT NULL,
                namespace TEXT NOT NULL DEFAULT 'default',
                created_at INTEGER NOT NULL,
                UNIQUE(platform, platform_user_id)
            );
            CREATE INDEX IF NOT EXISTS idx_users_platform ON users(platform);
            CREATE INDEX IF NOT EXISTS idx_users_platform_namespace ON users(platform, namespace);

            CREATE TABLE IF NOT EXISTS push_subscriptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                namespace TEXT NOT NULL,
                endpoint TEXT NOT NULL,
                p256dh TEXT NOT NULL,
                auth TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                UNIQUE(namespace, endpoint)
            );
            CREATE INDEX IF NOT EXISTS idx_push_subscriptions_namespace ON push_subscriptions(namespace);
        `)
    }

    private getUserVersion(): number {
        const row = this.db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined
        return row?.user_version ?? 0
    }

    private setUserVersion(version: number): void {
        this.db.exec(`PRAGMA user_version = ${version}`)
    }

    private hasAnyUserTables(): boolean {
        const row = this.db.prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' LIMIT 1"
        ).get() as { name?: string } | undefined
        return Boolean(row?.name)
    }

    private assertRequiredTablesPresent(): void {
        const placeholders = REQUIRED_TABLES.map(() => '?').join(', ')
        const rows = this.db.prepare(
            `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders})`
        ).all(...REQUIRED_TABLES) as Array<{ name: string }>
        const existing = new Set(rows.map((row) => row.name))
        const missing = REQUIRED_TABLES.filter((table) => !existing.has(table))

        if (missing.length > 0) {
            throw new Error(
                `SQLite schema is missing required tables (${missing.join(', ')}). ` +
                'Back up and rebuild the database, or run an offline migration to the expected schema version.'
            )
        }
    }

    private buildSchemaMismatchError(currentVersion: number): Error {
        const location = (this.dbPath === ':memory:' || this.dbPath.startsWith('file::memory:'))
            ? 'in-memory database'
            : this.dbPath
        return new Error(
            `SQLite schema version mismatch for ${location}. ` +
            `Expected ${SCHEMA_VERSION}, found ${currentVersion}. ` +
            'This build does not run compatibility migrations. ' +
            'Back up and rebuild the database, or run an offline migration to the expected schema version.'
        )
    }
}
