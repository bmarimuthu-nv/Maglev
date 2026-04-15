export function getOrCreateTerminalId(scopeKey: string, sessionId: string): string {
    return `terminal:${scopeKey}:${sessionId}`
}
