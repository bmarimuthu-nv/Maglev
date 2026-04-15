import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { Store } from './index'

const tempDirs: string[] = []

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true })
    }
})

describe('Store corruption recovery', () => {
    it('quarantines an unreadable on-disk database and recreates the schema', () => {
        const dir = mkdtempSync(join(tmpdir(), 'maglev-store-corrupt-'))
        tempDirs.push(dir)

        const dbPath = join(dir, 'maglev.db')
        writeFileSync(dbPath, 'not a sqlite database')

        const store = new Store(dbPath)
        const session = store.sessions.getOrCreateSession(
            'recovered-session',
            { path: '/tmp/project', host: 'localhost', flavor: 'shell' },
            null,
            'default'
        )

        expect(store.sessions.getSession(session.id)?.id).toBe(session.id)

        const quarantinedNames = readdirSync(dir).filter((name) => name.startsWith('maglev.db.corrupt-'))
        expect(quarantinedNames.length).toBe(1)

        const quarantinedPath = join(dir, quarantinedNames[0])
        expect(existsSync(quarantinedPath)).toBeTrue()
        expect(readFileSync(quarantinedPath, 'utf8')).toBe('not a sqlite database')
    })
})
