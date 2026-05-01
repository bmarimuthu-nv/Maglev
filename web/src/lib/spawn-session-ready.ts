import type { QueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import { queryKeys } from '@/lib/query-keys'
import type { Session } from '@/types/api'

const SPAWN_SESSION_READY_TIMEOUT_MS = 4_000
const SPAWN_SESSION_READY_POLL_MS = 150

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
        window.setTimeout(resolve, ms)
    })
}

export function isSpawnedShellSessionReady(session: Session | null | undefined): boolean {
    if (!session?.active) {
        return false
    }

    if (session.metadata?.flavor !== 'shell') {
        return true
    }

    return session.metadata?.shellTerminalState === 'ready' || Boolean(session.metadata?.shellTerminalId)
}

export async function waitForSpawnedShellSessionReady(options: {
    api: ApiClient | null
    queryClient: QueryClient
    scopeKey: string
    sessionId: string
}): Promise<void> {
    const { api, queryClient, scopeKey, sessionId } = options

    await queryClient.invalidateQueries({ queryKey: queryKeys.sessions(scopeKey) })

    if (!api) {
        return
    }

    const deadline = Date.now() + SPAWN_SESSION_READY_TIMEOUT_MS
    while (Date.now() < deadline) {
        try {
            const response = await api.getSession(sessionId)
            queryClient.setQueryData(
                queryKeys.session(scopeKey, sessionId),
                response
            )
            if (isSpawnedShellSessionReady(response.session)) {
                return
            }
        } catch {
            // keep polling until the session becomes readable or we time out
        }
        await delay(SPAWN_SESSION_READY_POLL_MS)
    }
}
