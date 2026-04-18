import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { FileSearchItem } from '@/types/api'
import { useAppContext } from '@/lib/app-context'
import { queryKeys } from '@/lib/query-keys'

export function useSessionFileSearch(
    api: ApiClient | null,
    sessionId: string | null,
    query: string,
    options?: { limit?: number; enabled?: boolean }
): {
    files: FileSearchItem[]
    error: string | null
    isLoading: boolean
    refetch: () => Promise<unknown>
} {
    const { scopeKey } = useAppContext()
    const resolvedSessionId = sessionId ?? 'unknown'
    const limit = options?.limit ?? 200
    const enabled = options?.enabled ?? Boolean(api && sessionId)

    const result = useQuery({
        queryKey: queryKeys.sessionFiles(scopeKey, resolvedSessionId, query),
        queryFn: async () => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            const response = await api.searchSessionFiles(sessionId, query, limit)
            if (!response.success) {
                return { files: [], error: response.error ?? 'Failed to search files' }
            }
            return { files: response.files ?? [], error: null }
        },
        enabled,
        retry: false,
    })

    const queryError = result.error instanceof Error
        ? result.error.message
        : result.error
            ? 'Failed to search files'
            : null

    return {
        files: result.data?.files ?? [],
        error: queryError ?? result.data?.error ?? null,
        isLoading: result.isLoading,
        refetch: result.refetch
    }
}
