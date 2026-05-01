const PENDING_TERMINAL_FOCUS_KEY = 'maglev:pending-terminal-focus-session-id'
const PENDING_TERMINAL_FOCUS_TTL_MS = 30_000

type PendingTerminalFocusEntry = {
    sessionId: string
    createdAt: number
}

function readPendingEntry(): PendingTerminalFocusEntry | null {
    if (typeof window === 'undefined') {
        return null
    }
    try {
        const raw = window.sessionStorage.getItem(PENDING_TERMINAL_FOCUS_KEY)
        if (!raw) {
            return null
        }

        // Backward-compatible with the older plain-string storage.
        if (!raw.trim().startsWith('{')) {
            return {
                sessionId: raw,
                createdAt: Date.now()
            }
        }

        const parsed = JSON.parse(raw) as Partial<PendingTerminalFocusEntry>
        if (typeof parsed.sessionId !== 'string' || typeof parsed.createdAt !== 'number') {
            return null
        }
        return {
            sessionId: parsed.sessionId,
            createdAt: parsed.createdAt
        }
    } catch {
        return null
    }
}

export function markPendingTerminalFocus(sessionId: string): void {
    if (typeof window === 'undefined') {
        return
    }
    try {
        window.sessionStorage.setItem(PENDING_TERMINAL_FOCUS_KEY, JSON.stringify({
            sessionId,
            createdAt: Date.now()
        }))
    } catch {
        // Best-effort only.
    }
}

export function hasPendingTerminalFocus(sessionId: string): boolean {
    const entry = readPendingEntry()
    if (!entry) {
        return false
    }
    if (entry.sessionId !== sessionId) {
        return false
    }
    if ((Date.now() - entry.createdAt) > PENDING_TERMINAL_FOCUS_TTL_MS) {
        clearPendingTerminalFocus(sessionId)
        return false
    }
    return true
}

export function clearPendingTerminalFocus(sessionId: string): void {
    if (typeof window === 'undefined') {
        return
    }
    try {
        const entry = readPendingEntry()
        if (entry?.sessionId === sessionId) {
            window.sessionStorage.removeItem(PENDING_TERMINAL_FOCUS_KEY)
        }
    } catch {
        // Best-effort only.
    }
}
