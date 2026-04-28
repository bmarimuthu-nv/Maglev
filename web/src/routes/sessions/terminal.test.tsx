import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { I18nProvider } from '@/lib/i18n-context'
import { getStickyFilePreviewStorageKey } from '@/lib/storage-session'
import TerminalPage from './terminal'

const writeMock = vi.fn()
const closeSessionMock = vi.fn()
const updateSessionMock = vi.fn()
const getTerminalSupervisionTargetMock = vi.fn()
const replayMock = vi.fn()
const takeOverMock = vi.fn()
let mockTerminalSocketState: { status: 'idle' | 'connecting' | 'connected' | 'error'; error?: string } = { status: 'connected' }
let mockTerminalAttachment: { owner: 'self' | 'other'; attachedAt: number | null; canTakeOver: boolean } | null = null
const AUTO_SCROLL_KEY = 'maglev-auto-scroll'
const RECENT_OPEN_FILES_KEY = 'maglev:recent-open-files'
const PENDING_TERMINAL_FOCUS_KEY = 'maglev:pending-terminal-focus-session-id'
const useSessionFileSearchMock = vi.fn()
let mockSessions: Array<{ id: string; active: boolean; metadata?: Record<string, unknown> }> = []
let mockSessionMetadata: Record<string, unknown> = { path: '/tmp/project' }
let allowMockTerminalTextareaFocus = true
let mockTerminalTextarea: HTMLTextAreaElement | null = null
const originalRequestAnimationFrame = globalThis.requestAnimationFrame
const originalCancelAnimationFrame = globalThis.cancelAnimationFrame
const originalWindowInnerWidth = window.innerWidth

vi.mock('@tanstack/react-router', () => ({
    useParams: () => ({ sessionId: 'session-1' }),
    useNavigate: () => vi.fn()
}))

vi.mock('@/lib/app-context', () => ({
    useAppContext: () => ({
        api: {
            closeSession: closeSessionMock,
            updateSession: updateSessionMock,
            getTerminalSupervisionTarget: getTerminalSupervisionTargetMock
        },
        token: 'test-token',
        baseUrl: 'http://localhost:3000',
        scopeKey: 'test-scope'
    })
}))

vi.mock('@/hooks/useAppGoBack', () => ({
    useAppGoBack: () => vi.fn()
}))

vi.mock('@/hooks/queries/useSession', () => ({
    useSession: (_api: unknown, sessionId: string) => ({
        session: {
            id: sessionId,
            active: true,
            metadata: mockSessionMetadata
        }
    })
}))

vi.mock('@/hooks/queries/useSessions', () => ({
    useSessions: () => ({
        sessions: mockSessions,
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
        state: mockTerminalSocketState.status === 'error'
            ? { status: 'error' as const, error: mockTerminalSocketState.error ?? 'error' }
            : { status: mockTerminalSocketState.status },
        attachment: mockTerminalAttachment,
        connect: vi.fn(),
        write: writeMock,
        resize: vi.fn(),
        disconnect: vi.fn(),
        onOutput: vi.fn(),
        onExit: vi.fn(),
        replay: replayMock,
        reconnectView: vi.fn(),
        takeOver: takeOverMock
    })
}))

vi.mock('@/hooks/useLongPress', () => ({
    useLongPress: ({ onClick }: { onClick: () => void }) => ({
        onClick
    })
}))

vi.mock('@/components/Terminal/TerminalView', () => ({
    TerminalView: (props: { onMount?: (terminal: {
        focus: () => void
        blur: () => void
        onData: () => { dispose: () => void }
        textarea?: HTMLTextAreaElement | null
    }) => void }) => {
        useEffect(() => {
            const textarea = document.createElement('textarea')
            document.body.appendChild(textarea)
            mockTerminalTextarea = textarea
            const realFocus = textarea.focus.bind(textarea)
            const focusSpy = vi.fn(() => {
                if (allowMockTerminalTextareaFocus) {
                    realFocus()
                }
            })
            textarea.focus = focusSpy as typeof textarea.focus

            props.onMount?.({
                focus: vi.fn(),
                blur: vi.fn(),
                onData: () => ({ dispose: vi.fn() }),
                textarea
            })

            return () => {
                textarea.remove()
                if (mockTerminalTextarea === textarea) {
                    mockTerminalTextarea = null
                }
            }
        }, [props])

        return <div data-testid="terminal-view" />
    }
}))

vi.mock('@/components/FilePreviewPanel', () => ({
    FilePreviewPanel: (props: { filePath: string; onClose: () => void; presentation?: 'sidebar' | 'overlay' }) => (
        <div data-testid="file-preview-panel" data-presentation={props.presentation ?? 'sidebar'}>
            <span>{props.filePath}</span>
            <button type="button" onClick={props.onClose}>Close preview</button>
        </div>
    )
}))

vi.mock('@/components/SplitTerminalPanel', () => ({
    SplitTerminalPanel: (props: { sessionId: string; onUnsplit?: (sessionId: string) => void }) => (
        <div data-testid="split-terminal-panel">
            <span>{props.sessionId}</span>
            {props.onUnsplit ? (
                <button type="button" onClick={() => props.onUnsplit?.(props.sessionId)}>
                    Unsplit
                </button>
            ) : null}
        </div>
    )
}))

function renderWithProviders() {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
                gcTime: 0
            }
        }
    })

    return render(
        <QueryClientProvider client={queryClient}>
            <I18nProvider>
                <TerminalPage />
            </I18nProvider>
        </QueryClientProvider>
    )
}

function setDefaultFileSearchMock() {
    useSessionFileSearchMock.mockImplementation(() => ({
        files: [],
        isLoading: false,
        error: null
    }))
}

function setDefaultSupervisionTargetMock() {
    getTerminalSupervisionTargetMock.mockResolvedValue({
        worker: {
            id: 'worker-1',
            active: true,
            metadata: { path: '/tmp/worker' }
        },
        supervisor: {
            id: 'session-1',
            active: true,
            metadata: { path: '/tmp/project' }
        },
        bridge: null,
        snapshot: null,
        events: []
    })
}

function setMatchMediaMock() {
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
}

afterEach(() => {
    Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        writable: true,
        value: originalWindowInnerWidth
    })
})

describe('TerminalPage paste behavior', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockTerminalSocketState = { status: 'connected' }
        mockTerminalAttachment = null
        mockSessions = []
        mockSessionMetadata = { path: '/tmp/project' }
        allowMockTerminalTextareaFocus = true
        mockTerminalTextarea = null
        replayMock.mockReset()
        closeSessionMock.mockResolvedValue(undefined)
        setDefaultFileSearchMock()
        setDefaultSupervisionTargetMock()
        setMatchMediaMock()
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

    it('replays buffered terminal output when the terminal mounts', async () => {
        renderWithProviders()

        await waitFor(() => {
            expect(replayMock).toHaveBeenCalled()
        })
    })
})

describe('TerminalPage auto-scroll wheel detection', () => {
    beforeEach(() => {
        cleanup()
        vi.clearAllMocks()
        mockTerminalSocketState = { status: 'connected' }
        mockTerminalAttachment = null
        mockSessions = []
        mockSessionMetadata = { path: '/tmp/project' }
        allowMockTerminalTextareaFocus = true
        mockTerminalTextarea = null
        closeSessionMock.mockResolvedValue(undefined)
        setDefaultFileSearchMock()
        localStorage.removeItem(AUTO_SCROLL_KEY)
        setDefaultSupervisionTargetMock()
        setMatchMediaMock()
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

describe('TerminalPage terminal takeover status', () => {
    beforeEach(() => {
        cleanup()
        vi.clearAllMocks()
        mockTerminalSocketState = { status: 'connected' }
        mockTerminalAttachment = null
        mockSessions = []
        mockSessionMetadata = { path: '/tmp/project' }
        allowMockTerminalTextareaFocus = true
        mockTerminalTextarea = null
        closeSessionMock.mockResolvedValue(undefined)
        setDefaultFileSearchMock()
        setDefaultSupervisionTargetMock()
        setMatchMediaMock()
    })

    afterEach(() => {
        cleanup()
    })

    it('shows when this browser owns the terminal and since when', () => {
        mockTerminalAttachment = {
            owner: 'self',
            attachedAt: Date.UTC(2026, 3, 28, 20, 30, 0),
            canTakeOver: false
        }

        renderWithProviders()

        expect(screen.getByText(/Attached here since/i)).toBeInTheDocument()
    })

    it('shows reclaim UI when another browser owns the terminal', () => {
        mockTerminalSocketState = {
            status: 'error',
            error: 'Terminal moved to another browser.'
        }
        mockTerminalAttachment = {
            owner: 'other',
            attachedAt: Date.UTC(2026, 3, 28, 20, 31, 0),
            canTakeOver: true
        }

        renderWithProviders()
        fireEvent.click(screen.getByRole('button', { name: 'Reclaim terminal' }))

        expect(screen.getByText(/Another browser has this terminal since/i)).toBeInTheDocument()
        expect(takeOverMock).toHaveBeenCalledTimes(1)
    })
})

describe('TerminalPage split child restore', () => {
    beforeEach(() => {
        cleanup()
        vi.clearAllMocks()
        mockTerminalSocketState = { status: 'connected' }
        mockTerminalAttachment = null
        allowMockTerminalTextareaFocus = true
        mockTerminalTextarea = null
        closeSessionMock.mockResolvedValue(undefined)
        setDefaultFileSearchMock()
        setDefaultSupervisionTargetMock()
        setMatchMediaMock()
        mockSessionMetadata = { path: '/tmp/project' }
    })

    afterEach(() => {
        localStorage.removeItem('maglev:splitTerminalWidth')
        cleanup()
    })

    it('does not restore a review-terminal child into the main terminal split pane', () => {
        mockSessions = [
            {
                id: 'review-child',
                active: true,
                metadata: {
                    path: '/tmp/project',
                    parentSessionId: 'session-1',
                    childRole: 'review-terminal'
                }
            }
        ]

        renderWithProviders()

        expect(screen.queryByTestId('split-terminal-panel')).not.toBeInTheDocument()
    })

    it('restores a split-terminal child into the main terminal split pane', () => {
        mockSessions = [
            {
                id: 'split-child',
                active: true,
                metadata: {
                    path: '/tmp/project',
                    parentSessionId: 'session-1',
                    childRole: 'split-terminal'
                }
            }
        ]

        renderWithProviders()

        expect(screen.getByTestId('split-terminal-panel')).toHaveTextContent('split-child')
    })
})

describe('TerminalPage file preview viewport behavior', () => {
    beforeEach(() => {
        cleanup()
        vi.clearAllMocks()
        mockTerminalSocketState = { status: 'connected' }
        mockTerminalAttachment = null
        mockSessions = []
        mockSessionMetadata = { path: '/tmp/project' }
        allowMockTerminalTextareaFocus = true
        mockTerminalTextarea = null
        closeSessionMock.mockResolvedValue(undefined)
        setDefaultFileSearchMock()
        setDefaultSupervisionTargetMock()
        setMatchMediaMock()
        localStorage.setItem(
            getStickyFilePreviewStorageKey('test-scope', 'session-1'),
            '/tmp/project/src/example.ts'
        )
    })

    afterEach(() => {
        localStorage.removeItem(getStickyFilePreviewStorageKey('test-scope', 'session-1'))
        cleanup()
    })

    it('renders the preview as a full-screen dialog on compact viewports', () => {
        Object.defineProperty(window, 'innerWidth', {
            configurable: true,
            writable: true,
            value: 640
        })

        renderWithProviders()

        expect(screen.getByRole('dialog')).toBeInTheDocument()
        expect(screen.getByTestId('file-preview-panel')).toHaveAttribute('data-presentation', 'overlay')
        expect(screen.queryByLabelText('Resize file preview')).not.toBeInTheDocument()
    })

    it('renders the preview as a resizable sidebar on wider viewports', () => {
        Object.defineProperty(window, 'innerWidth', {
            configurable: true,
            writable: true,
            value: 1280
        })

        renderWithProviders()

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        expect(screen.getByLabelText('Resize file preview')).toBeInTheDocument()
        expect(screen.getByTestId('file-preview-panel')).toHaveAttribute('data-presentation', 'sidebar')
    })
})

describe('TerminalPage open file dialog', () => {
    beforeEach(() => {
        cleanup()
        vi.clearAllMocks()
        mockTerminalSocketState = { status: 'connected' }
        mockTerminalAttachment = null
        mockSessions = []
        mockSessionMetadata = { path: '/tmp/project' }
        closeSessionMock.mockResolvedValue(undefined)
        localStorage.removeItem(RECENT_OPEN_FILES_KEY)
        setDefaultFileSearchMock()
        setDefaultSupervisionTargetMock()
        setMatchMediaMock()
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
            expect.objectContaining({
                closeSession: closeSessionMock
            }),
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
                expect.objectContaining({
                    closeSession: closeSessionMock
                }),
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
        expect(screen.getAllByText('src/nested/helper.ts').length).toBeGreaterThan(0)
    })
})

describe('TerminalPage split close behavior', () => {
    beforeEach(() => {
        cleanup()
        vi.clearAllMocks()
        mockTerminalSocketState = { status: 'connected' }
        mockTerminalAttachment = null
        mockSessions = [
            {
                id: 'split-session-1',
                active: true,
                metadata: { parentSessionId: 'session-1', childRole: 'split-terminal' }
            }
        ]
        mockSessionMetadata = { path: '/tmp/project' }
        allowMockTerminalTextareaFocus = true
        mockTerminalTextarea = null
        closeSessionMock.mockResolvedValue(undefined)
        setDefaultFileSearchMock()
        setDefaultSupervisionTargetMock()
        setMatchMediaMock()
    })

    afterEach(() => {
        cleanup()
    })

    it('clamps split width to leave room for the primary terminal on smaller viewports', () => {
        Object.defineProperty(window, 'innerWidth', {
            configurable: true,
            writable: true,
            value: 700
        })
        localStorage.setItem('maglev:splitTerminalWidth', '880')

        renderWithProviders()

        const splitShell = screen.getByTestId('split-terminal-panel').parentElement
        expect(splitShell).toHaveStyle({ width: '340px' })
    })

    it('closes the split session instead of only hiding the panel', async () => {
        renderWithProviders()

        expect(screen.getByTestId('split-terminal-panel')).toHaveTextContent('split-session-1')

        fireEvent.click(screen.getAllByRole('button', { name: 'Close split' })[0]!)

        await waitFor(() => {
            expect(closeSessionMock).toHaveBeenCalledWith('split-session-1')
        })

        expect(screen.queryByTestId('split-terminal-panel')).not.toBeInTheDocument()
    })

    it('unsplits the child terminal into a standalone session', async () => {
        renderWithProviders()

        fireEvent.click(screen.getByRole('button', { name: 'Unsplit' }))

        await waitFor(() => {
            expect(updateSessionMock).toHaveBeenCalledWith('split-session-1', {
                parentSessionId: null,
                childRole: null
            })
        })

        expect(screen.queryByTestId('split-terminal-panel')).not.toBeInTheDocument()
    })
})

describe('TerminalPage new session focus handoff', () => {
    beforeEach(() => {
        cleanup()
        vi.clearAllMocks()
        vi.useFakeTimers()
        mockTerminalSocketState = { status: 'connected' }
        mockTerminalAttachment = null
        mockSessions = []
        mockSessionMetadata = { path: '/tmp/project' }
        allowMockTerminalTextareaFocus = false
        mockTerminalTextarea = null
        closeSessionMock.mockResolvedValue(undefined)
        setDefaultFileSearchMock()
        setDefaultSupervisionTargetMock()
        sessionStorage.setItem(PENDING_TERMINAL_FOCUS_KEY, 'session-1')
        globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => window.setTimeout(() => {
            callback(performance.now())
        }, 16)) as typeof requestAnimationFrame
        globalThis.cancelAnimationFrame = ((handle: number) => {
            window.clearTimeout(handle)
        }) as typeof cancelAnimationFrame
        setMatchMediaMock()
    })

    afterEach(() => {
        sessionStorage.removeItem(PENDING_TERMINAL_FOCUS_KEY)
        cleanup()
        globalThis.requestAnimationFrame = originalRequestAnimationFrame
        globalThis.cancelAnimationFrame = originalCancelAnimationFrame
        vi.useRealTimers()
    })

    it('keeps pending focus until the terminal textarea actually takes focus', async () => {
        renderWithProviders()

        expect(sessionStorage.getItem(PENDING_TERMINAL_FOCUS_KEY)).toBe('session-1')

        allowMockTerminalTextareaFocus = true
        await act(async () => {
            vi.advanceTimersByTime(1000)
        })

        expect(mockTerminalTextarea).not.toBeNull()
        expect(sessionStorage.getItem(PENDING_TERMINAL_FOCUS_KEY)).toBeNull()
        expect(document.activeElement).toBe(mockTerminalTextarea)
    })

    it('shows startup progress while waiting for shell terminal metadata', () => {
        mockSessionMetadata = {
            path: '/tmp/project',
            flavor: 'shell'
        }
        mockTerminalSocketState = { status: 'idle' }
        mockTerminalAttachment = null

        renderWithProviders()

        expect(screen.getByText('Preparing terminal…')).toBeInTheDocument()
        expect(screen.getByText('The shell session exists, but the terminal backend is not ready yet.')).toBeInTheDocument()
    })

    it('shows startup progress while attaching to a fresh terminal', () => {
        mockSessionMetadata = {
            path: '/tmp/project',
            flavor: 'shell',
            shellTerminalId: 'term-1',
            shellTerminalState: 'ready'
        }
        mockTerminalSocketState = { status: 'connecting' }
        mockTerminalAttachment = null

        renderWithProviders()

        expect(screen.getByText('Connecting to terminal…')).toBeInTheDocument()
        expect(screen.getByText('Attaching this page to the new terminal backend.')).toBeInTheDocument()
    })
})

describe('TerminalPage supervisor bridge help', () => {
    beforeEach(() => {
        cleanup()
        vi.clearAllMocks()
        mockTerminalSocketState = { status: 'connected' }
        mockTerminalAttachment = null
        mockSessions = []
        mockSessionMetadata = {
            path: '/tmp/project',
            terminalSupervision: {
                role: 'supervisor',
                peerSessionId: 'worker-1',
                state: 'active'
            }
        }
        closeSessionMock.mockResolvedValue(undefined)
        setDefaultFileSearchMock()
        globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => window.setTimeout(() => {
            callback(performance.now())
        }, 16)) as typeof requestAnimationFrame
        globalThis.cancelAnimationFrame = ((handle: number) => {
            window.clearTimeout(handle)
        }) as typeof cancelAnimationFrame
        getTerminalSupervisionTargetMock.mockResolvedValue({
            worker: {
                id: 'worker-1',
                active: true,
                metadata: { path: '/tmp/worker' }
            },
            supervisor: {
                id: 'session-1',
                active: true,
                metadata: { path: '/tmp/project' }
            },
            bridge: {
                workspaceRoot: '/tmp/project',
                bridgeDir: '/tmp/project/.maglev-supervision/session-1',
                transcriptFilePath: '/tmp/project/.maglev-supervision/session-1/worker-terminal.log',
                helperScriptPath: '/tmp/project/.maglev-supervision/session-1/send-to-worker.sh',
                stateFilePath: '/tmp/project/.maglev-supervision/session-1/worker-terminal.json',
                readmePath: '/tmp/project/.maglev-supervision/session-1/README.txt',
                storageScope: 'workspace'
            },
            snapshot: {
                outputBuffer: 'worker ready\n',
                status: 'ready',
                updatedAt: Date.now(),
                exitInfo: null
            },
            events: []
        })
        setMatchMediaMock()
    })

    afterEach(() => {
        cleanup()
        globalThis.requestAnimationFrame = originalRequestAnimationFrame
        globalThis.cancelAnimationFrame = originalCancelAnimationFrame
    })

    it('shows the compact supervisor command and opens bridge help in a dialog', async () => {
        renderWithProviders()

        expect(await screen.findByText(/Session session-1: maglev supervisor send --session session-1 -- <command \.\.\.>/i)).toBeInTheDocument()
        expect(screen.queryByText('Supervisor bridge')).not.toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: 'Supervisor bridge help' }))

        expect(await screen.findByText('Supervisor bridge help')).toBeInTheDocument()
        expect(screen.getByText('Session session-1')).toBeInTheDocument()
        expect(screen.getByText(/maglev supervisor send --session session-1 -- git status/i)).toBeInTheDocument()
        expect(screen.getByText(/run the tests and summarize the failure/i)).toBeInTheDocument()
        expect(await screen.findByText('/tmp/project/.maglev-supervision/session-1/worker-terminal.log')).toBeInTheDocument()
        expect(screen.getByText('/tmp/project/.maglev-supervision/session-1/worker-terminal.json')).toBeInTheDocument()
        expect(screen.getByText('/tmp/project/.maglev-supervision/session-1/send-to-worker.sh')).toBeInTheDocument()
        expect(screen.getByText(/not by editing a bridge file directly/i)).toBeInTheDocument()
    })
})
