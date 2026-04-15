export const queryKeys = {
    sessions: (scopeKey: string) => ['sessions', scopeKey] as const,
    hubConfig: (scopeKey: string) => ['hub-config', scopeKey] as const,
    session: (scopeKey: string, sessionId: string) => ['session', scopeKey, sessionId] as const,
    gitStatus: (scopeKey: string, sessionId: string) => ['git-status', scopeKey, sessionId] as const,
    sessionFiles: (scopeKey: string, sessionId: string, query: string) => ['session-files', scopeKey, sessionId, query] as const,
    sessionDirectory: (scopeKey: string, sessionId: string, path: string) => ['session-directory', scopeKey, sessionId, path] as const,
    sessionFile: (scopeKey: string, sessionId: string, path: string) => ['session-file', scopeKey, sessionId, path] as const,
    gitFileDiff: (sessionId: string, path: string, staged?: boolean) => [
        'git-file-diff',
        sessionId,
        path,
        staged ? 'staged' : 'unstaged'
    ] as const,
    gitFileDiffScoped: (scopeKey: string, sessionId: string, path: string, staged?: boolean) => [
        'git-file-diff',
        scopeKey,
        sessionId,
        path,
        staged ? 'staged' : 'unstaged'
    ] as const,
}
