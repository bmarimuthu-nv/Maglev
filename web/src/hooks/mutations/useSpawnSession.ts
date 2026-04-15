import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { SpawnResponse, SpawnTerminalPairResponse } from '@/types/api'
import { useAppContext } from '@/lib/app-context'
import { queryKeys } from '@/lib/query-keys'

type SpawnInput = {
    directory: string
    name?: string
    notesPath?: string
    createNotesFile?: boolean
    pinned?: boolean
    autoRespawn?: boolean
    startupCommand?: string
    sessionType?: 'simple' | 'worktree'
    worktreeName?: string
}

export function useSpawnSession(api: ApiClient | null): {
    spawnSession: (input: SpawnInput) => Promise<SpawnResponse>
    spawnTerminalPair: (input: {
        directory: string
        name: string
    }) => Promise<SpawnTerminalPairResponse>
    isPending: boolean
    error: string | null
} {
    const { scopeKey } = useAppContext()
    const queryClient = useQueryClient()

    const mutation = useMutation({
        mutationFn: async (input: SpawnInput) => {
            if (!api) {
                throw new Error('API unavailable')
            }
            return await api.spawnHubSession(
                input.directory,
                input.name,
                input.notesPath,
                input.createNotesFile,
                input.pinned,
                input.autoRespawn,
                input.startupCommand,
                input.sessionType,
                input.worktreeName
            )
        },
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.sessions(scopeKey) })
        },
    })

    const pairMutation = useMutation({
        mutationFn: async (input: {
            directory: string
            name: string
        }) => {
            if (!api) {
                throw new Error('API unavailable')
            }
            return await api.spawnTerminalPair(
                input.directory,
                input.name
            )
        },
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.sessions(scopeKey) })
        },
    })

    return {
        spawnSession: mutation.mutateAsync,
        spawnTerminalPair: pairMutation.mutateAsync,
        isPending: mutation.isPending || pairMutation.isPending,
        error: mutation.error instanceof Error
            ? mutation.error.message
            : pairMutation.error instanceof Error
                ? pairMutation.error.message
                : mutation.error || pairMutation.error
                    ? 'Failed to spawn session'
                    : null,
    }
}
