import { describe, expect, it } from 'vitest'
import type { SessionSummary } from '@/types/api'
import { buildCloneRequest, getGroupBranchHint, getSessionRows, getSessionSubgroups, isVisibleInSessionList, reconcileOrder } from './SessionList'

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
                metadata: { path: '/tmp', terminalSupervision: { role: 'supervisor', peerSessionId: 'work', state: 'active' } }
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
                    terminalSupervision: { role: 'supervisor', peerSessionId: 'child', state: 'active' }
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

    it('keeps review-terminal children as indented child rows under their parent', () => {
        const sessions = [
            makeSession({ id: 'review-parent', metadata: { path: '/repo' } }),
            makeSession({
                id: 'review-shell',
                metadata: {
                    path: '/repo',
                    parentSessionId: 'review-parent',
                    childRole: 'review-terminal',
                    name: 'Some other shell name'
                }
            }),
        ]

        const rows = getSessionRows(sessions)

        expect(rows).toHaveLength(2)
        expect(rows[1]?.isChild).toBe(true)
        expect(rows[1]?.sessions[0].metadata?.childRole).toBe('review-terminal')
    })
})

describe('isVisibleInSessionList', () => {
    it('hides split-terminal child sessions from the default session list', () => {
        expect(isVisibleInSessionList(makeSession({
            id: 'split-child',
            metadata: {
                path: '/repo',
                parentSessionId: 'parent',
                childRole: 'split-terminal'
            }
        }))).toBe(false)
    })

    it('keeps review-terminal child sessions visible in the session list', () => {
        expect(isVisibleInSessionList(makeSession({
            id: 'review-child',
            metadata: {
                path: '/repo',
                parentSessionId: 'parent',
                childRole: 'review-terminal'
            }
        }))).toBe(true)
    })
})

describe('getSessionSubgroups', () => {
    it('creates separate folder and worktree subgroups within the same base directory', () => {
        const rows = getSessionRows([
            makeSession({
                id: 'folder-session',
                metadata: { path: '/repo' }
            }),
            makeSession({
                id: 'worktree-a',
                metadata: {
                    path: '/repo/.worktrees/feature-a',
                    worktree: {
                        basePath: '/repo',
                        branch: 'feature/a',
                        name: 'feature-a',
                        worktreePath: '/repo/.worktrees/feature-a'
                    }
                }
            }),
            makeSession({
                id: 'worktree-b',
                metadata: {
                    path: '/repo/.worktrees/feature-b',
                    worktree: {
                        basePath: '/repo',
                        branch: 'feature/b',
                        name: 'feature-b',
                        worktreePath: '/repo/.worktrees/feature-b'
                    }
                }
            }),
        ])

        const subgroups = getSessionSubgroups('/repo', rows)

        expect(subgroups.map((subgroup) => subgroup.label)).toEqual(['Folder', 'feature-a', 'feature-b'])
        expect(subgroups[0]?.rows.map((row) => row.sessions[0].id)).toEqual(['folder-session'])
        expect(subgroups[1]?.hint).toBe('feature/a')
        expect(subgroups[2]?.hint).toBe('feature/b')
    })

    it('keeps a single folder subgroup for plain sessions without worktrees', () => {
        const rows = getSessionRows([
            makeSession({ id: 'a', metadata: { path: '/repo' } }),
            makeSession({ id: 'b', metadata: { path: '/repo' } }),
        ])

        const subgroups = getSessionSubgroups('/repo', rows)

        expect(subgroups).toHaveLength(1)
        expect(subgroups[0]?.label).toBe('Folder')
        expect(subgroups[0]?.rows.map((row) => row.sessions[0].id)).toEqual(['a', 'b'])
    })

    it('shows the plain git branch as subgroup hint when no worktree metadata exists', () => {
        const rows = getSessionRows([
            makeSession({ id: 'a', metadata: { path: '/repo', branch: 'feature/plain-repo' } }),
        ])

        const subgroups = getSessionSubgroups('/repo', rows)

        expect(subgroups).toHaveLength(1)
        expect(subgroups[0]?.label).toBe('Folder')
        expect(subgroups[0]?.hint).toBe('feature/plain-repo')
    })
})

describe('getGroupBranchHint', () => {
    it('returns the plain repo branch when the group has a single shared branch', () => {
        const sessions = [
            makeSession({ id: 'a', metadata: { path: '/repo', branch: 'feature/plain-repo' } }),
            makeSession({ id: 'b', metadata: { path: '/repo', branch: 'feature/plain-repo' } }),
        ]

        expect(getGroupBranchHint(sessions)).toBe('feature/plain-repo')
    })

    it('prefers worktree branch metadata when present', () => {
        const sessions = [
            makeSession({
                id: 'wt',
                metadata: {
                    path: '/repo/.worktrees/feature-a',
                    worktree: {
                        basePath: '/repo',
                        branch: 'feature/a',
                        name: 'feature-a',
                        worktreePath: '/repo/.worktrees/feature-a'
                    }
                }
            }),
        ]

        expect(getGroupBranchHint(sessions)).toBe('feature/a')
    })

    it('returns nothing when the group mixes multiple branches', () => {
        const sessions = [
            makeSession({ id: 'a', metadata: { path: '/repo', branch: 'feature/a' } }),
            makeSession({ id: 'b', metadata: { path: '/repo', branch: 'feature/b' } }),
        ]

        expect(getGroupBranchHint(sessions)).toBeUndefined()
    })
})

describe('reconcileOrder', () => {
    it('keeps saved positions for known keys and appends new keys', () => {
        const items = [{ key: 'a' }, { key: 'b' }, { key: 'c' }]
        const order = reconcileOrder(items, ['b', 'a'], (item) => item.key)
        expect(order).toEqual(['b', 'a', 'c'])
    })

    it('drops removed keys from the saved order', () => {
        const items = [{ key: 'b' }, { key: 'c' }]
        const order = reconcileOrder(items, ['b', 'a', 'c'], (item) => item.key)
        expect(order).toEqual(['b', 'c'])
    })
})

describe('buildCloneRequest', () => {
    it('does not inherit the source session startup command for the default clone action', () => {
        const session = makeSession({
            id: 'shell-1',
            metadata: {
                path: '/repo',
                name: 'Worker shell',
                startupCommand: 'codex',
                pinned: true,
                autoRespawn: true
            }
        })

        expect(buildCloneRequest(session)).toEqual({
            directory: '/repo',
            name: 'Worker shell (clone)',
            pinned: true,
            autoRespawn: true,
            startupCommand: undefined
        })
    })

    it('uses an explicit startup command for clone-with-agent shortcuts', () => {
        const session = makeSession({
            id: 'shell-2',
            metadata: {
                path: '/repo',
                startupCommand: 'codex'
            }
        })

        expect(buildCloneRequest(session, 'claude')).toEqual({
            directory: '/repo',
            name: 'repo (clone)',
            pinned: undefined,
            autoRespawn: undefined,
            startupCommand: 'claude'
        })
    })
})
