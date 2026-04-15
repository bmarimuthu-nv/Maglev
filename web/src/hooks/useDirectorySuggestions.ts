import { useMemo } from 'react'
import type { SessionSummary } from '@/types/api'

export function useDirectorySuggestions(
    sessions: SessionSummary[],
    recentPaths: string[]
): string[] {
    return useMemo(() => {
        const sessionPaths = sessions
            .map((session) => session.metadata?.path)
            .filter((path): path is string => Boolean(path))

        const worktreePaths = sessions
            .map((session) => session.metadata?.worktree?.basePath)
            .filter((path): path is string => Boolean(path))

        const dedupedRecent = [...new Set(recentPaths)]
        const recentSet = new Set(dedupedRecent)

        const otherPaths = [...new Set([...sessionPaths, ...worktreePaths])]
            .filter((path) => !recentSet.has(path))
            .sort((a, b) => a.localeCompare(b))

        return [...dedupedRecent, ...otherPaths]
    }, [sessions, recentPaths])
}
