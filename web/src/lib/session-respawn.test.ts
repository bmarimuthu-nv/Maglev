import { describe, expect, it } from 'vitest'
import type { SessionSummary } from '@/types/api'
import { findRespawnedSession } from './session-respawn'

function makeSession(id: string, metadata: SessionSummary['metadata'], active = true): SessionSummary {
    return {
        id,
        active,
        thinking: false,
        activeAt: 1,
        updatedAt: 1,
        metadata
    }
}

describe('findRespawnedSession', () => {
    it('finds an active direct respawn replacement', () => {
        const replacement = makeSession('new-session', {
            path: '/repo',
            respawnedFromSessionId: 'old-session'
        })

        expect(findRespawnedSession([replacement], 'old-session')?.id).toBe('new-session')
    })

    it('follows respawn lineage across multiple restarts', () => {
        const replacement = makeSession('newest-session', {
            path: '/repo',
            respawnedFromSessionId: 'middle-session',
            respawnedFromSessionIds: ['old-session', 'middle-session']
        })

        expect(findRespawnedSession([replacement], 'old-session')?.id).toBe('newest-session')
    })

    it('ignores inactive replacements', () => {
        const inactiveReplacement = makeSession('new-session', {
            path: '/repo',
            respawnedFromSessionId: 'old-session'
        }, false)

        expect(findRespawnedSession([inactiveReplacement], 'old-session')).toBeNull()
    })
})
