import { useQuery } from '@tanstack/react-query'
import { ApiClient } from '@/api/client'
import type { HubIdentityResponse } from '@/types/api'

export function useHubIdentity(baseUrl: string): {
    identity: HubIdentityResponse | null
    isLoading: boolean
    error: string | null
} {
    const query = useQuery({
        queryKey: ['hub-identity', baseUrl],
        queryFn: async () => {
            return await new ApiClient('', { baseUrl }).getHubIdentity()
        },
        enabled: baseUrl.trim().length > 0,
        retry: 1,
        staleTime: 60_000,
    })

    return {
        identity: query.data ?? null,
        isLoading: query.isLoading,
        error: query.error instanceof Error ? query.error.message : query.error ? 'Failed to load hub identity' : null
    }
}
