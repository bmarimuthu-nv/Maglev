import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@/lib/i18n-context'
import TerminalPage from './terminal'

const writeMock = vi.fn()
const AUTO_SCROLL_KEY = 'maglev-auto-scroll'
const RECENT_OPEN_FILES_KEY = 'maglev:recent-open-files'
const useSessionFileSearchMock = vi.fn()

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
    useSessionFileSearch: (...args: unknown[]) => useSessionFileSearchMock(...args)
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

vi.mock('@/components/FilePreviewPanel', () => ({
    FilePreviewPanel: () => <div data-testid="file-preview-panel" />
}))

function renderWithProviders() {
    return render(
        <I18nProvider>
            <TerminalPage />
        </I18nProvider>
    )
}

function setDefaultFileSearchMock() {
    useSessionFileSearchMock.mockImplementation(() => ({
        files: [],
        isLoading: false,
        error: null
    }))
}

describe('TerminalPage paste behavior', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        setDefaultFileSearchMock()
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
        setDefaultFileSearchMock()
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

    it('normalizes line-mode wheel deltas before applying the activation threshold', () => {
        renderWithProviders()
        const container = getTerminalContainer()

        fireEvent.wheel(container, { deltaY: 6, deltaMode: 1 })
        fireEvent.wheel(container, { deltaY: 6, deltaMode: 1 })

        expect(writeMock).toHaveBeenCalledWith('\u0002')
        expect(writeMock).toHaveBeenCalledWith('[')
        expect(writeMock).toHaveBeenCalledWith('\u001b[6~')
    })
})

describe('TerminalPage open file dialog', () => {
    beforeEach(() => {
        cleanup()
        vi.clearAllMocks()
        localStorage.removeItem(RECENT_OPEN_FILES_KEY)
        setDefaultFileSearchMock()
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
        localStorage.removeItem(RECENT_OPEN_FILES_KEY)
        cleanup()
    })

    it('does not trigger backend file search until the user submits search', async () => {
        localStorage.setItem(RECENT_OPEN_FILES_KEY, JSON.stringify([
            {
                fileName: 'helper.ts',
                filePath: 'src/nested',
                fullPath: 'src/nested/helper.ts',
                fileType: 'file'
            },
            {
                fileName: 'index.ts',
                filePath: 'src',
                fullPath: 'src/index.ts',
                fileType: 'file'
            }
        ]))

        renderWithProviders()

        fireEvent.click(screen.getByRole('button', { name: 'Open file' }))
        const input = screen.getByPlaceholderText('Type to fuzzy search files')
        fireEvent.change(input, { target: { value: 'helper' } })

        expect(screen.getByText('Recent matches')).toBeInTheDocument()
        expect(screen.getByText('src/nested/helper.ts')).toBeInTheDocument()
        expect(screen.queryByText('src/index.ts')).not.toBeInTheDocument()

        expect(useSessionFileSearchMock).toHaveBeenLastCalledWith(
            null,
            'session-1',
            '',
            expect.objectContaining({
                enabled: false,
                mode: 'fuzzy'
            })
        )

        fireEvent.click(screen.getByRole('button', { name: 'Search' }))

        await waitFor(() => {
            expect(useSessionFileSearchMock).toHaveBeenLastCalledWith(
                null,
                'session-1',
                'helper',
                expect.objectContaining({
                    enabled: true,
                    mode: 'fuzzy'
                })
            )
        })
    })

    it('shows recently opened files before running a new search', async () => {
        useSessionFileSearchMock.mockImplementation((_api, _sessionId, query: string) => ({
            files: query === 'helper'
                ? [{
                    fileName: 'helper.ts',
                    filePath: 'src/nested',
                    fullPath: 'src/nested/helper.ts',
                    fileType: 'file'
                }]
                : [],
            isLoading: false,
            error: null
        }))

        renderWithProviders()

        fireEvent.click(screen.getByRole('button', { name: 'Open file' }))
        fireEvent.change(screen.getByPlaceholderText('Type to fuzzy search files'), {
            target: { value: 'helper' }
        })
        fireEvent.click(screen.getByRole('button', { name: 'Search' }))

        const resultButton = await screen.findByRole('button', { name: /helper\.ts/i })
        fireEvent.click(resultButton)

        fireEvent.click(screen.getByRole('button', { name: 'Open file' }))

        expect(screen.getByText('Recent files')).toBeInTheDocument()
        expect(screen.getByText('src/nested/helper.ts')).toBeInTheDocument()
    })
})
