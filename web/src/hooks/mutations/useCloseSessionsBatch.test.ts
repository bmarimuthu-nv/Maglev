import { describe, expect, it } from 'vitest'
import type { SessionSummary } from '@/types/api'
import { planSessionCleanup } from './useCloseSessionsBatch'

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

describe('planSessionCleanup', () => {
    it('deletes only stopped non-retained sessions in stopped mode', () => {
        const plan = planSessionCleanup([
            makeSession({ id: 'active', active: true }),
            makeSession({ id: 'stopped', active: false }),
            makeSession({ id: 'pinned', active: false, metadata: { path: '/tmp/project', pinned: true } }),
        ], 'stopped')

        expect(plan.archive).toHaveLength(0)
        expect(plan.delete.map((session) => session.id)).toEqual(['stopped'])
        expect(plan.skipped.map((session) => session.id).sort()).toEqual(['active', 'pinned'])
    })

    it('archives active sessions and deletes stopped sessions in group mode', () => {
        const plan = planSessionCleanup([
            makeSession({ id: 'active', active: true }),
            makeSession({ id: 'stopped', active: false }),
            makeSession({ id: 'auto-respawn', active: false, metadata: { path: '/tmp/project', autoRespawn: true, pinned: true } }),
        ], 'group')

        expect(plan.archive.map((session) => session.id)).toEqual(['active'])
        expect(plan.delete.map((session) => session.id)).toEqual(['stopped'])
        expect(plan.skipped.map((session) => session.id)).toEqual(['auto-respawn'])
    })
})
