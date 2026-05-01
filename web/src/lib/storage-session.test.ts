import { beforeEach, describe, expect, it } from 'vitest'
import {
    LEGACY_SESSION_ORDER_KEY,
    cleanupSessionScopedStorage,
    getLegacyStickyFilePreviewStorageKey,
    getSessionListOrderStorageKey,
    getStickyFilePreviewStorageKey,
    migrateStorageFoundation,
    parseSessionScopedStorageKey,
    sweepOrphanedSessionStorage,
} from './storage-session'

describe('storage-session foundation', () => {
    beforeEach(() => {
        window.localStorage.clear()
    })

    it('parses scoped session keys with encoded scope segments', () => {
        const key = getStickyFilePreviewStorageKey('http://localhost:3000', 'session:1')
        expect(parseSessionScopedStorageKey(key)).toEqual({
            scopeKey: 'http://localhost:3000',
            sessionId: 'session:1',
            slot: 'sticky-file-preview',
        })
    })

    it('migrates sticky preview and session order keys into scoped storage', () => {
        window.localStorage.setItem(LEGACY_SESSION_ORDER_KEY, '{"groups":["/repo"],"subgroups":{},"rows":{}}')
        window.localStorage.setItem(getLegacyStickyFilePreviewStorageKey('http://localhost:3000', 'session-1'), 'src/app.ts')

        migrateStorageFoundation({
            scopeKey: 'http://localhost:3000',
            baseUrl: 'http://localhost:3000',
            sessionIds: ['session-1'],
        })

        expect(window.localStorage.getItem(getSessionListOrderStorageKey('http://localhost:3000'))).toBe('{"groups":["/repo"],"subgroups":{},"rows":{}}')
        expect(window.localStorage.getItem(getStickyFilePreviewStorageKey('http://localhost:3000', 'session-1'))).toBe('src/app.ts')
        expect(window.localStorage.getItem(getLegacyStickyFilePreviewStorageKey('http://localhost:3000', 'session-1'))).toBeNull()
        expect(window.localStorage.getItem(LEGACY_SESSION_ORDER_KEY)).toBe('{"groups":["/repo"],"subgroups":{},"rows":{}}')
    })

    it('cleans up scoped and legacy session-owned keys for a specific session', () => {
        window.localStorage.setItem(getStickyFilePreviewStorageKey('scope-a', 'session-a'), 'src/a.ts')
        window.localStorage.setItem(getStickyFilePreviewStorageKey('scope-a', 'session-b'), 'src/b.ts')
        window.localStorage.setItem(getLegacyStickyFilePreviewStorageKey('scope-a', 'session-a'), 'src/a.ts')

        cleanupSessionScopedStorage({
            scopeKey: 'scope-a',
            baseUrl: 'scope-a',
            sessionId: 'session-a',
        })

        expect(window.localStorage.getItem(getStickyFilePreviewStorageKey('scope-a', 'session-a'))).toBeNull()
        expect(window.localStorage.getItem(getLegacyStickyFilePreviewStorageKey('scope-a', 'session-a'))).toBeNull()
        expect(window.localStorage.getItem(getStickyFilePreviewStorageKey('scope-a', 'session-b'))).toBe('src/b.ts')
    })

    it('sweeps orphaned keys only within the active scope', () => {
        window.localStorage.setItem(getStickyFilePreviewStorageKey('scope-a', 'session-a'), 'src/a.ts')
        window.localStorage.setItem(getStickyFilePreviewStorageKey('scope-a', 'session-b'), 'src/b.ts')
        window.localStorage.setItem(getStickyFilePreviewStorageKey('scope-b', 'session-x'), 'src/x.ts')
        window.localStorage.setItem(getLegacyStickyFilePreviewStorageKey('scope-a', 'session-a'), 'src/a.ts')
        window.localStorage.setItem(getLegacyStickyFilePreviewStorageKey('scope-a', 'session-b'), 'src/b.ts')

        sweepOrphanedSessionStorage({
            scopeKey: 'scope-a',
            baseUrl: 'scope-a',
            activeSessionIds: ['session-a'],
        })

        expect(window.localStorage.getItem(getStickyFilePreviewStorageKey('scope-a', 'session-a'))).toBe('src/a.ts')
        expect(window.localStorage.getItem(getStickyFilePreviewStorageKey('scope-a', 'session-b'))).toBeNull()
        expect(window.localStorage.getItem(getStickyFilePreviewStorageKey('scope-b', 'session-x'))).toBe('src/x.ts')
        expect(window.localStorage.getItem(getLegacyStickyFilePreviewStorageKey('scope-a', 'session-a'))).toBe('src/a.ts')
        expect(window.localStorage.getItem(getLegacyStickyFilePreviewStorageKey('scope-a', 'session-b'))).toBeNull()
    })
})
