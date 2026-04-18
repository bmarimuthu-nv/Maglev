import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@/lib/i18n-context'
import TerminalPage from './terminal'

const writeMock = vi.fn()
const AUTO_SCROLL_KEY = 'maglev-auto-scroll'

vi.mock('@tanstack/react-router', () => ({
    useParams: () => ({ sessionId: 'session-1' }),
    useNavigate: () => vi.fn()
}))

vi.mock('@/lib/app-context', () => ({
    useAppContext: () => ({
        api: null,
        token: 'test-token',
        baseUrl: 'http://localhost:3000'
    })
}))

vi.mock('@/hooks/useAppGoBack', () => ({
    useAppGoBack: () => vi.fn()
}))

vi.mock('@/hooks/queries/useSession', () => ({
    useSession: () => ({
        session: {
            id: 'session-1',
            active: true,
            metadata: { path: '/tmp/project' }
        }
    })
}))

vi.mock('@/hooks/queries/useSessions', () => ({
    useSessions: () => ({
        sessions: [],
        isLoading: false,
        error: null,
        refetch: vi.fn()
    })
}))

vi.mock('@/hooks/queries/useSessionFileSearch', () => ({
    useSessionFileSearch: () => ({
        files: [],
        isLoading: false,
        error: null
    })
}))

vi.mock('@/hooks/useTerminalSocket', () => ({
    useTerminalSocket: () => ({
        state: { status: 'connected' as const },
        connect: vi.fn(),
        write: writeMock,
        resize: vi.fn(),
        disconnect: vi.fn(),
        onOutput: vi.fn(),
        onExit: vi.fn()
    })
}))

vi.mock('@/hooks/useLongPress', () => ({
    useLongPress: ({ onClick }: { onClick: () => void }) => ({
        onClick
    })
}))

vi.mock('@/components/Terminal/TerminalView', () => ({
    TerminalView: () => <div data-testid="terminal-view" />
}))

function renderWithProviders() {
    return render(
        <I18nProvider>
            <TerminalPage />
        </I18nProvider>
    )
}

describe('TerminalPage paste behavior', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        Object.defineProperty(window, 'matchMedia', {
            configurable: true,
            writable: true,
            value: vi.fn().mockReturnValue({
                matches: false,
                media: '',
                onchange: null,
                addListener: vi.fn(),
                removeListener: vi.fn(),
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
                dispatchEvent: vi.fn()
            })
        })
    })

    it('does not open manual paste dialog when clipboard text is empty', async () => {
        const readText = vi.fn(async () => '')
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { readText }
        })

        renderWithProviders()
        fireEvent.click(screen.getByRole('button', { name: 'Keys' }))
        fireEvent.click(screen.getAllByRole('button', { name: 'Paste' }).at(-1)!)

        await waitFor(() => {
            expect(readText).toHaveBeenCalledTimes(1)
        })
        expect(writeMock).not.toHaveBeenCalled()
        expect(screen.queryByText('Paste input')).not.toBeInTheDocument()
    })

    it('opens manual paste dialog when clipboard read fails', async () => {
        const readText = vi.fn(async () => {
            throw new Error('blocked')
        })
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { readText }
        })

        renderWithProviders()
        fireEvent.click(screen.getByRole('button', { name: 'Keys' }))
        fireEvent.click(screen.getAllByRole('button', { name: 'Paste' }).at(-1)!)

        expect(await screen.findByText('Paste input')).toBeInTheDocument()
    })
})

describe('TerminalPage auto-scroll wheel detection', () => {
    beforeEach(() => {
        cleanup()
        vi.clearAllMocks()
        localStorage.removeItem(AUTO_SCROLL_KEY)
        Object.defineProperty(window, 'matchMedia', {
            configurable: true,
            writable: true,
            value: vi.fn().mockReturnValue({
                matches: false,
                media: '',
                onchange: null,
                addListener: vi.fn(),
                removeListener: vi.fn(),
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
                dispatchEvent: vi.fn()
            })
        })
    })

    afterEach(() => {
        localStorage.removeItem(AUTO_SCROLL_KEY)
        cleanup()
    })

    function getTerminalContainer() {
        const views = screen.getAllByTestId('terminal-view')
        // The wheel handler is on the parent div wrapping TerminalView
        return views[0].parentElement!
    }

    it('activates tmux copy-mode when wheel delta exceeds threshold', () => {
        renderWithProviders()
        const container = getTerminalContainer()

        // Fire multiple wheel events to exceed the 150px threshold
        fireEvent.wheel(container, { deltaY: 80 })
        fireEvent.wheel(container, { deltaY: 80 })

        // Should have sent: Ctrl+B (0x02), '[' (enter copy-mode), and a page scroll
        expect(writeMock).toHaveBeenCalledWith('\u0002')
        expect(writeMock).toHaveBeenCalledWith('[')
        expect(writeMock).toHaveBeenCalledWith('\u001b[6~')
    })

    it('does not activate copy-mode below the threshold', () => {
        renderWithProviders()
        const container = getTerminalContainer()

        fireEvent.wheel(container, { deltaY: 50 })

        expect(writeMock).not.toHaveBeenCalled()
    })

    it('does not activate copy-mode when auto-scroll is disabled', () => {
        localStorage.setItem(AUTO_SCROLL_KEY, 'false')
        renderWithProviders()
        const container = getTerminalContainer()

        fireEvent.wheel(container, { deltaY: 200 })

        expect(writeMock).not.toHaveBeenCalled()
    })

    it('scrolls up with negative deltaY', () => {
        renderWithProviders()
        const container = getTerminalContainer()

        fireEvent.wheel(container, { deltaY: -200 })

        expect(writeMock).toHaveBeenCalledWith('\u0002')
        expect(writeMock).toHaveBeenCalledWith('[')
        // Page Up for scroll up direction
        expect(writeMock).toHaveBeenCalledWith('\u001b[5~')
    })
})
