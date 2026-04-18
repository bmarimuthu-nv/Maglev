import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import { useAppContext } from '@/lib/app-context'
import { queryKeys } from '@/lib/query-keys'

export function useSessionActions(
    api: ApiClient | null,
    sessionId: string | null,
    _agentFlavor?: string | null
): {
    abortSession: () => Promise<void>
    archiveSession: () => Promise<void>
    switchSession: () => Promise<void>
    renameSession: (name: string) => Promise<void>
    setPinned: (pinned: boolean) => Promise<void>
    setShellOptions: (options: { startupCommand?: string | null; autoRespawn?: boolean; pinned?: boolean }) => Promise<void>
    deleteSession: () => Promise<void>
    attachTerminalSupervision: (workerSessionId: string) => Promise<void>
    setTerminalSupervisionPaused: (paused: boolean) => Promise<void>
    detachTerminalSupervision: () => Promise<void>
    restartTerminalPair: () => Promise<void>
    setTerminalPairPaused: (paused: boolean) => Promise<void>
    rebindTerminalPair: (replacementSessionId: string) => Promise<void>
    addTerminalPairSupervisor: (options: { name: string }) => Promise<void>
    isPending: boolean
} {
    const { scopeKey } = useAppContext()
    const queryClient = useQueryClient()

    const invalidateSession = async () => {
        if (!sessionId) return
        await queryClient.invalidateQueries({ queryKey: queryKeys.session(scopeKey, sessionId) })
        await queryClient.invalidateQueries({ queryKey: queryKeys.sessions(scopeKey) })
    }

    const abortMutation = useMutation({
        mutationFn: async () => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            await api.abortSession(sessionId)
        },
        onSuccess: () => void invalidateSession(),
    })

    const archiveMutation = useMutation({
        mutationFn: async () => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            await api.archiveSession(sessionId)
        },
        onSuccess: () => void invalidateSession(),
    })

    const switchMutation = useMutation({
        mutationFn: async () => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            await api.switchSession(sessionId)
        },
        onSuccess: () => void invalidateSession(),
    })

    const renameMutation = useMutation({
        mutationFn: async (name: string) => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            await api.renameSession(sessionId, name)
        },
        onSuccess: () => void invalidateSession(),
    })

    const deleteMutation = useMutation({
        mutationFn: async () => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            await api.deleteSession(sessionId)
        },
        onSuccess: async () => {
            if (!sessionId) return
            queryClient.removeQueries({ queryKey: queryKeys.session(scopeKey, sessionId) })
            await queryClient.invalidateQueries({ queryKey: queryKeys.sessions(scopeKey) })
        },
    })

    const pinMutation = useMutation({
        mutationFn: async (pinned: boolean) => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            await api.setSessionPinned(sessionId, pinned)
        },
        onSuccess: () => void invalidateSession(),
    })

    const shellOptionsMutation = useMutation({
        mutationFn: async (options: { startupCommand?: string | null; autoRespawn?: boolean; pinned?: boolean }) => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            await api.setShellSessionOptions(sessionId, options)
        },
        onSuccess: () => void invalidateSession(),
    })

    const attachTerminalSupervisionMutation = useMutation({
        mutationFn: async (workerSessionId: string) => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            await api.attachTerminalSupervision(sessionId, workerSessionId)
        },
        onSuccess: () => void invalidateSession(),
    })

    const setTerminalSupervisionPausedMutation = useMutation({
        mutationFn: async (paused: boolean) => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            await api.setTerminalSupervisionPaused(sessionId, paused)
        },
        onSuccess: () => void invalidateSession(),
    })

    const detachTerminalSupervisionMutation = useMutation({
        mutationFn: async () => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            await api.detachTerminalSupervision(sessionId)
        },
        onSuccess: () => void invalidateSession(),
    })

    const restartTerminalPairMutation = useMutation({
        mutationFn: async () => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            const result = await api.restartTerminalPair(sessionId)
            if (result.type === 'error') {
                throw new Error(result.message)
            }
        },
        onSuccess: () => void invalidateSession(),
    })

    const setTerminalPairPausedMutation = useMutation({
        mutationFn: async (paused: boolean) => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            await api.setTerminalPairPaused(sessionId, paused)
        },
        onSuccess: () => void invalidateSession(),
    })

    const rebindTerminalPairMutation = useMutation({
        mutationFn: async (replacementSessionId: string) => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            await api.rebindTerminalPair(sessionId, replacementSessionId)
        },
        onSuccess: () => void invalidateSession(),
    })

    const addTerminalPairSupervisorMutation = useMutation({
        mutationFn: async (options: { name: string }) => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            const result = await api.addTerminalPairSupervisor(sessionId, options)
            if (result.type === 'error') {
                throw new Error(result.message)
            }
        },
        onSuccess: () => void invalidateSession(),
    })

    return {
        abortSession: abortMutation.mutateAsync,
        archiveSession: archiveMutation.mutateAsync,
        switchSession: switchMutation.mutateAsync,
        renameSession: renameMutation.mutateAsync,
        setPinned: pinMutation.mutateAsync,
        setShellOptions: shellOptionsMutation.mutateAsync,
        deleteSession: deleteMutation.mutateAsync,
        attachTerminalSupervision: attachTerminalSupervisionMutation.mutateAsync,
        setTerminalSupervisionPaused: setTerminalSupervisionPausedMutation.mutateAsync,
        detachTerminalSupervision: detachTerminalSupervisionMutation.mutateAsync,
        restartTerminalPair: restartTerminalPairMutation.mutateAsync,
        setTerminalPairPaused: setTerminalPairPausedMutation.mutateAsync,
        rebindTerminalPair: rebindTerminalPairMutation.mutateAsync,
        addTerminalPairSupervisor: addTerminalPairSupervisorMutation.mutateAsync,
        isPending: abortMutation.isPending
            || archiveMutation.isPending
            || switchMutation.isPending
            || renameMutation.isPending
            || pinMutation.isPending
            || shellOptionsMutation.isPending
            || deleteMutation.isPending
            || attachTerminalSupervisionMutation.isPending
            || setTerminalSupervisionPausedMutation.isPending
            || detachTerminalSupervisionMutation.isPending
            || restartTerminalPairMutation.isPending
            || setTerminalPairPausedMutation.isPending
            || rebindTerminalPairMutation.isPending
            || addTerminalPairSupervisorMutation.isPending,
    }
}
