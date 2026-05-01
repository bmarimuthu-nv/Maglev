import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
    clearPendingTerminalFocus,
    hasPendingTerminalFocus,
    markPendingTerminalFocus
} from './pending-terminal-focus'

const PENDING_TERMINAL_FOCUS_KEY = 'maglev:pending-terminal-focus-session-id'

describe('pending terminal focus', () => {
    beforeEach(() => {
        sessionStorage.removeItem(PENDING_TERMINAL_FOCUS_KEY)
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-04-27T00:00:00Z'))
    })

    afterEach(() => {
        sessionStorage.removeItem(PENDING_TERMINAL_FOCUS_KEY)
        vi.useRealTimers()
    })

    it('marks and clears focus intent for a session', () => {
        markPendingTerminalFocus('session-1')
        expect(hasPendingTerminalFocus('session-1')).toBe(true)

        clearPendingTerminalFocus('session-1')
        expect(hasPendingTerminalFocus('session-1')).toBe(false)
    })

    it('expires stale focus intent after the ttl', () => {
        markPendingTerminalFocus('session-1')

        vi.advanceTimersByTime(30_001)

        expect(hasPendingTerminalFocus('session-1')).toBe(false)
        expect(sessionStorage.getItem(PENDING_TERMINAL_FOCUS_KEY)).toBeNull()
    })

    it('accepts the older plain string storage format', () => {
        sessionStorage.setItem(PENDING_TERMINAL_FOCUS_KEY, 'session-1')

        expect(hasPendingTerminalFocus('session-1')).toBe(true)
    })
})
