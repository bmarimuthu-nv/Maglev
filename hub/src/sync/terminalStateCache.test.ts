import { describe, expect, it } from 'bun:test'
import { TerminalStateCache } from './terminalStateCache'

describe('TerminalStateCache', () => {
    it('stores and retrieves snapshots', () => {
        const cache = new TerminalStateCache()
        cache.noteReady('s1', 't1')
        cache.noteOutput('s1', 't1', 'hello')
        const snap = cache.getSnapshot('s1', 't1')
        expect(snap).not.toBeNull()
        expect(snap!.outputBuffer).toBe('hello')
        expect(snap!.status).toBe('ready')
    })

    it('returns null for unknown session/terminal', () => {
        const cache = new TerminalStateCache()
        expect(cache.getSnapshot('s1', 't1')).toBeNull()
    })

    it('removeSession clears all terminals for a session', () => {
        const cache = new TerminalStateCache()
        cache.noteReady('s1', 't1')
        cache.noteReady('s1', 't2')
        cache.noteReady('s2', 't1')
        expect(cache.size).toBe(3)

        cache.removeSession('s1')
        expect(cache.size).toBe(1)
        expect(cache.getSnapshot('s1', 't1')).toBeNull()
        expect(cache.getSnapshot('s1', 't2')).toBeNull()
        expect(cache.getSnapshot('s2', 't1')).not.toBeNull()
    })

    it('evictStale removes exited entries older than TTL', () => {
        const cache = new TerminalStateCache()
        cache.noteReady('s1', 't1')
        cache.noteExit('s1', 't1', 0, null)

        // Manually backdate the entry
        const key = 's1:t1'
        const entry = (cache as any).entries.get(key)
        entry.updatedAt = Date.now() - 6 * 60 * 1000 // 6 minutes ago

        cache.evictStale()
        expect(cache.getSnapshot('s1', 't1')).toBeNull()
        expect(cache.size).toBe(0)
    })

    it('evictStale keeps ready entries', () => {
        const cache = new TerminalStateCache()
        cache.noteReady('s1', 't1')

        // Backdate
        const key = 's1:t1'
        const entry = (cache as any).entries.get(key)
        entry.updatedAt = Date.now() - 10 * 60 * 1000

        cache.evictStale()
        expect(cache.getSnapshot('s1', 't1')).not.toBeNull()
    })

    it('evictStale keeps recently exited entries', () => {
        const cache = new TerminalStateCache()
        cache.noteReady('s1', 't1')
        cache.noteExit('s1', 't1', 0, null)

        cache.evictStale()
        expect(cache.getSnapshot('s1', 't1')).not.toBeNull()
    })
})
