import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { SessionSummary } from '@/types/api'
import type { ApiClient } from '@/api/client'
import { useAppContext } from '@/lib/app-context'
import { queryKeys } from '@/lib/query-keys'
import { cleanupSessionScopedStorage } from '@/lib/storage-session'
import { useToastActions } from '@/lib/toast-context'

export type SessionCleanupPlan = {
    archive: SessionSummary[]
    delete: SessionSummary[]
    skipped: SessionSummary[]
}

export type SessionCleanupMode = 'stopped' | 'group'

type SessionCleanupTarget = {
    mode: SessionCleanupMode
    name: string
    plan: SessionCleanupPlan
}

type SessionCleanupResult = {
    archivedSessionIds: string[]
    deletedSessionIds: string[]
    failed: Array<{ session: SessionSummary; message: string }>
    skippedCount: number
}

function isRetainedSession(session: SessionSummary): boolean {
    return session.metadata?.pinned === true || session.metadata?.autoRespawn === true
}

export function planSessionCleanup(
    sessions: SessionSummary[],
    mode: SessionCleanupMode
): SessionCleanupPlan {
    const archive: SessionSummary[] = []
    const deleteSessions: SessionSummary[] = []
    const skipped: SessionSummary[] = []

    for (const session of sessions) {
        if (isRetainedSession(session)) {
            skipped.push(session)
            continue
        }

        if (session.active) {
            if (mode === 'group') {
                archive.push(session)
            } else {
                skipped.push(session)
            }
            continue
        }

        deleteSessions.push(session)
    }

    return {
        archive,
        delete: deleteSessions,
        skipped
    }
}

export function useCloseSessionsBatch(api: ApiClient | null): {
    runBatchCleanup: (target: SessionCleanupTarget) => Promise<SessionCleanupResult>
    isPending: boolean
} {
    const { scopeKey, baseUrl } = useAppContext()
    const queryClient = useQueryClient()
    const { addToast } = useToastActions()

    const mutation = useMutation({
        mutationFn: async (target: SessionCleanupTarget): Promise<SessionCleanupResult> => {
            if (!api) {
                throw new Error('Session unavailable')
            }

            const requests = [
                ...target.plan.archive.map(async (session) => {
                    try {
                        await api.archiveSession(session.id)
                        return { kind: 'archive' as const, session }
                    } catch (error) {
                        return {
                            kind: 'failed' as const,
                            session,
                            message: error instanceof Error ? error.message : 'Failed to archive session'
                        }
                    }
                }),
                ...target.plan.delete.map(async (session) => {
                    try {
                        await api.deleteSession(session.id)
                        return { kind: 'delete' as const, session }
                    } catch (error) {
                        return {
                            kind: 'failed' as const,
                            session,
                            message: error instanceof Error ? error.message : 'Failed to delete session'
                        }
                    }
                })
            ]

            const settled = await Promise.all(requests)
            return {
                archivedSessionIds: settled
                    .filter((entry): entry is { kind: 'archive'; session: SessionSummary } => entry.kind === 'archive')
                    .map((entry) => entry.session.id),
                deletedSessionIds: settled
                    .filter((entry): entry is { kind: 'delete'; session: SessionSummary } => entry.kind === 'delete')
                    .map((entry) => entry.session.id),
                failed: settled
                    .filter((entry): entry is { kind: 'failed'; session: SessionSummary; message: string } => entry.kind === 'failed')
                    .map((entry) => ({ session: entry.session, message: entry.message })),
                skippedCount: target.plan.skipped.length
            }
        },
        onSuccess: async (result) => {
            for (const sessionId of result.archivedSessionIds) {
                await queryClient.invalidateQueries({ queryKey: queryKeys.session(scopeKey, sessionId) })
            }

            for (const sessionId of result.deletedSessionIds) {
                cleanupSessionScopedStorage({
                    scopeKey,
                    baseUrl,
                    sessionId,
                })
                queryClient.removeQueries({ queryKey: queryKeys.session(scopeKey, sessionId) })
            }

            await queryClient.invalidateQueries({ queryKey: queryKeys.sessions(scopeKey) })

            const successParts: string[] = []
            if (result.archivedSessionIds.length > 0) {
                successParts.push(`archived ${result.archivedSessionIds.length}`)
            }
            if (result.deletedSessionIds.length > 0) {
                successParts.push(`deleted ${result.deletedSessionIds.length}`)
            }
            if (result.skippedCount > 0) {
                successParts.push(`skipped ${result.skippedCount}`)
            }

            addToast({
                title: result.failed.length > 0 ? 'Cleanup partially completed' : 'Cleanup completed',
                body: result.failed.length > 0
                    ? `${successParts.join(', ') || 'No cleanup applied'}, failed ${result.failed.length}`
                    : (successParts.length > 0 ? successParts.join(', ') : 'No sessions needed cleanup.'),
                sessionId: '',
                url: '/sessions'
            })
        }
    })

    return {
        runBatchCleanup: mutation.mutateAsync,
        isPending: mutation.isPending
    }
}
