import { describe, expect, it } from 'bun:test'

import { Store } from './index'
import type { StoredTerminalPair } from './types'

function capturePragmas<T>(store: Store, work: () => T): { result: T; pragmas: string[] } {
    const db = (store as unknown as { db: { exec: (sql: string) => void } }).db
    const originalExec = db.exec.bind(db)
    const pragmas: string[] = []

    db.exec = (sql: string) => {
        pragmas.push(sql)
        return originalExec(sql)
    }

    try {
        return {
            result: work(),
            pragmas
        }
    } finally {
        db.exec = originalExec
    }
}

function createPair(id: string): StoredTerminalPair {
    return {
        id,
        namespace: 'default',
        name: `pair-${id}`,
        createdAt: 1,
        updatedAt: 1,
        state: 'active',
        workerSessionId: null,
        supervisorSessionId: null,
        worker: { sessionId: null },
        supervisor: { sessionId: null }
    }
}

describe('Store durability strategy', () => {
    it('uses FULL then restores NORMAL for critical push, user, and terminal pair writes', () => {
        const store = new Store(':memory:')

        const first = capturePragmas(store, () => {
            store.push.addPushSubscription('default', {
                endpoint: 'https://push.example/subscription',
                p256dh: 'p256dh',
                auth: 'auth'
            })
        })
        expect(first.pragmas).toEqual([
            'PRAGMA synchronous = FULL',
            'PRAGMA synchronous = NORMAL'
        ])

        const second = capturePragmas(store, () => store.users.addUser('telegram', 'user-1', 'default'))
        expect(second.pragmas).toEqual([
            'PRAGMA synchronous = FULL',
            'PRAGMA synchronous = NORMAL'
        ])

        const pair = createPair('pair-1')
        const third = capturePragmas(store, () => store.terminalPairs.create(pair))
        expect(third.pragmas).toEqual([
            'PRAGMA synchronous = FULL',
            'PRAGMA synchronous = NORMAL'
        ])
    })

    it('restores NORMAL even when a critical write throws', () => {
        const store = new Store(':memory:')
        const pair = createPair('pair-throw')
        store.terminalPairs.create(pair)

        const captured = capturePragmas(store, () => {
            expect(() => store.terminalPairs.create(pair)).toThrow()
        })

        expect(captured.pragmas).toEqual([
            'PRAGMA synchronous = FULL',
            'PRAGMA synchronous = NORMAL'
        ])
    })

    it('does not add durability pragma flips for non-critical session and machine writes', () => {
        const store = new Store(':memory:')

        const sessionCapture = capturePragmas(store, () => {
            store.sessions.getOrCreateSession('tag', { path: '/project' }, null, 'default')
        })
        expect(sessionCapture.pragmas).toEqual([])

        const machineCapture = capturePragmas(store, () => {
            store.machines.getOrCreateMachine('machine-1', { host: 'alpha' }, null, 'default')
        })
        expect(machineCapture.pragmas).toEqual([])
    })
})
