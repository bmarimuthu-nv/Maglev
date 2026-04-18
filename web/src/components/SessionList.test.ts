import { describe, expect, it } from 'vitest'
import type { SessionSummary } from '@/types/api'
import { getSessionRows } from './SessionList'

function makeSession(overrides: Partial<SessionSummary> & { id: string }): SessionSummary {
    return {
        active: true,
        thinking: false,
        activeAt: Date.now(),
        updatedAt: Date.now(),
        metadata: { path: '/tmp/project' },
        ...overrides
    }
}

describe('getSessionRows', () => {
    it('groups simple sessions as unpaired rows', () => {
        const sessions = [
            makeSession({ id: 'a' }),
            makeSession({ id: 'b' }),
        ]
        const rows = getSessionRows(sessions)
        expect(rows.length).toBe(2)
        expect(rows[0].paired).toBe(false)
        expect(rows[1].paired).toBe(false)
    })

    it('groups terminal pair sessions into paired rows', () => {
        const sessions = [
            makeSession({
                id: 'worker',
                metadata: { path: '/tmp', terminalPair: { pairId: 'p1', pairName: 'test', role: 'worker', state: 'active' } }
            }),
            makeSession({
                id: 'supervisor',
                metadata: { path: '/tmp', terminalPair: { pairId: 'p1', pairName: 'test', role: 'supervisor', state: 'active' } }
            }),
        ]
        const rows = getSessionRows(sessions)
        expect(rows.length).toBe(1)
        expect(rows[0].paired).toBe(true)
        expect(rows[0].sessions.length).toBe(2)
        // Worker should come first
        expect(rows[0].sessions[0].id).toBe('worker')
    })

    it('groups supervision sessions into paired rows', () => {
        const sessions = [
            makeSession({
                id: 'orch',
                metadata: { path: '/tmp', terminalSupervision: { role: 'orchestrator', peerSessionId: 'work', state: 'active' } }
            }),
            makeSession({
                id: 'work',
                metadata: { path: '/tmp', terminalSupervision: { role: 'worker', peerSessionId: 'orch', state: 'active' } }
            }),
        ]
        const rows = getSessionRows(sessions)
        expect(rows.length).toBe(1)
        expect(rows[0].paired).toBe(true)
    })

    it('nests child sessions under their parent', () => {
        const sessions = [
            makeSession({ id: 'parent' }),
            makeSession({ id: 'child', metadata: { path: '/tmp', parentSessionId: 'parent' } }),
        ]
        const rows = getSessionRows(sessions)
        expect(rows.length).toBe(2)
        expect(rows[0].sessions[0].id).toBe('parent')
        expect(rows[0].isChild).toBeFalsy()
        expect(rows[1].sessions[0].id).toBe('child')
        expect(rows[1].isChild).toBe(true)
    })

    it('places child rows immediately after parent', () => {
        const sessions = [
            makeSession({ id: 'a' }),
            makeSession({ id: 'parent' }),
            makeSession({ id: 'child1', metadata: { path: '/tmp', parentSessionId: 'parent' } }),
            makeSession({ id: 'child2', metadata: { path: '/tmp', parentSessionId: 'parent' } }),
            makeSession({ id: 'b' }),
        ]
        const rows = getSessionRows(sessions)
        const ids = rows.map((r) => r.sessions[0].id)
        const parentIdx = ids.indexOf('parent')
        expect(ids[parentIdx + 1]).toBe('child1')
        expect(ids[parentIdx + 2]).toBe('child2')
    })

    it('pair grouping takes priority over parent-child nesting', () => {
        // A child session that is also part of a supervision pair
        // should appear in the pair, NOT as an indented child
        const sessions = [
            makeSession({ id: 'parent' }),
            makeSession({
                id: 'child',
                metadata: {
                    path: '/tmp',
                    parentSessionId: 'parent',
                    terminalSupervision: { role: 'worker', peerSessionId: 'supervisor', state: 'active' }
                }
            }),
            makeSession({
                id: 'supervisor',
                metadata: {
                    path: '/tmp',
                    terminalSupervision: { role: 'orchestrator', peerSessionId: 'child', state: 'active' }
                }
            }),
        ]
        const rows = getSessionRows(sessions)
        // Should have 2 rows: parent (unpaired) + child-supervisor pair
        expect(rows.length).toBe(2)
        const pairRow = rows.find((r) => r.paired)
        expect(pairRow).toBeDefined()
        expect(pairRow!.sessions.map((s) => s.id).sort()).toEqual(['child', 'supervisor'])
        // The child should NOT appear as isChild since it's in a pair
        expect(rows.every((r) => !r.isChild)).toBe(true)
    })

    it('handles orphaned child sessions (parent not in list)', () => {
        const sessions = [
            makeSession({ id: 'orphan', metadata: { path: '/tmp', parentSessionId: 'missing-parent' } }),
        ]
        const rows = getSessionRows(sessions)
        expect(rows.length).toBe(1)
        expect(rows[0].sessions[0].id).toBe('orphan')
        // Should appear as top-level since parent is missing
        expect(rows[0].isChild).toBeFalsy()
    })
})
