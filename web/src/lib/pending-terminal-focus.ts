const PENDING_TERMINAL_FOCUS_KEY = 'maglev:pending-terminal-focus-session-id'

export function markPendingTerminalFocus(sessionId: string): void {
    if (typeof window === 'undefined') {
        return
    }
    try {
        window.sessionStorage.setItem(PENDING_TERMINAL_FOCUS_KEY, sessionId)
    } catch {
        // Best-effort only.
    }
}

export function hasPendingTerminalFocus(sessionId: string): boolean {
    if (typeof window === 'undefined') {
        return false
    }
    try {
        return window.sessionStorage.getItem(PENDING_TERMINAL_FOCUS_KEY) === sessionId
    } catch {
        return false
    }
}

export function clearPendingTerminalFocus(sessionId: string): void {
    if (typeof window === 'undefined') {
        return
    }
    try {
        if (window.sessionStorage.getItem(PENDING_TERMINAL_FOCUS_KEY) === sessionId) {
            window.sessionStorage.removeItem(PENDING_TERMINAL_FOCUS_KEY)
        }
    } catch {
        // Best-effort only.
    }
}
