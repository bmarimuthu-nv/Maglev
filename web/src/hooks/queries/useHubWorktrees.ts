import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { DetectedWorktree } from '@/types/api'
import { useAppContext } from '@/lib/app-context'
import { queryKeys } from '@/lib/query-keys'

export function useHubWorktrees(
    api: ApiClient | null,
    paths: string[],
    enabled = true
): {
    worktrees: DetectedWorktree[]
    isLoading: boolean
    error: string | null
    refetch: () => Promise<unknown>
} {
    const { scopeKey } = useAppContext()
    const normalizedPaths = useMemo(
        () => Array.from(new Set(paths.map((path) => path.trim()).filter(Boolean))).sort(),
        [paths]
    )
    const pathsKey = normalizedPaths.join('\n')

    const query = useQuery({
        queryKey: queryKeys.hubWorktrees(scopeKey, pathsKey),
        queryFn: async () => {
            if (!api) {
                throw new Error('API unavailable')
            }
            return await api.listHubWorktrees(normalizedPaths)
        },
        enabled: Boolean(api && enabled && normalizedPaths.length > 0)
    })

    return {
        worktrees: query.data?.worktrees ?? [],
        isLoading: query.isLoading || query.isFetching,
        error: query.data?.error
            ?? (query.error instanceof Error ? query.error.message : query.error ? 'Failed to load worktrees' : null),
        refetch: query.refetch
    }
}
