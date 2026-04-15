import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { HubLaunchFolder, Machine } from '@/types/api'
import { useAppContext } from '@/lib/app-context'
import { queryKeys } from '@/lib/query-keys'

export function useHubConfig(api: ApiClient | null): {
    name: string | null
    machineId: string | null
    machine: Machine | null
    folders: HubLaunchFolder[]
    isLoading: boolean
    error: string | null
} {
    const { scopeKey } = useAppContext()
    const query = useQuery({
        queryKey: queryKeys.hubConfig(scopeKey),
        queryFn: async () => {
            if (!api) {
                throw new Error('API unavailable')
            }
            return await api.getHubConfig()
        },
        enabled: Boolean(api),
    })

    return {
        name: query.data?.name ?? null,
        machineId: query.data?.machineId ?? null,
        machine: query.data?.machine ?? null,
        folders: query.data?.folders ?? [],
        isLoading: query.isLoading,
        error: query.data?.error
            ?? (query.error instanceof Error ? query.error.message : query.error ? 'Failed to load hub config' : null)
    }
}
