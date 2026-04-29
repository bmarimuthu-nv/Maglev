import type { SessionSummary } from '@/types/api'

export function findRespawnedSession(sessions: SessionSummary[], staleSessionId: string): SessionSummary | null {
    return sessions.find((candidate) => {
        if (!candidate.active) {
            return false
        }

        const metadata = candidate.metadata
        if (!metadata) {
            return false
        }

        return metadata.respawnedFromSessionId === staleSessionId
            || metadata.respawnedFromSessionIds?.includes(staleSessionId) === true
    }) ?? null
}
