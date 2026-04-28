import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect } from 'react'
import { SplitTerminalPanel } from './SplitTerminalPanel'

let mockSession: {
    id: string
    active: boolean
    metadata?: Record<string, unknown>
} | null = null

const oldWriteMock = vi.fn()
const newWriteMock = vi.fn()
const connectMock = vi.fn()
const reconnectViewMock = vi.fn()
const resizeMock = vi.fn()
const disconnectMock = vi.fn()
const replayMock = vi.fn()
let capturedTerminalDataHandler: ((data: string) => void) | null = null

vi.mock('@/lib/app-context', () => ({
    useAppContext: () => ({
        api: {},
        token: 'test-token',
        baseUrl: 'http://localhost:3000'
    })
}))

vi.mock('@/hooks/queries/useSession', () => ({
    useSession: () => ({
        session: mockSession,
        isLoading: false,
        error: null,
        refetch: vi.fn()
    })
}))

vi.mock('@/hooks/useTerminalSocket', () => ({
    useTerminalSocket: ({ terminalId }: { terminalId: string | null }) => ({
        state: { status: 'connected' as const },
        connect: connectMock,
        reconnectView: reconnectViewMock,
        write: terminalId ? newWriteMock : oldWriteMock,
        resize: resizeMock,
        disconnect: disconnectMock,
        onOutput: vi.fn(),
        onExit: vi.fn(),
        replay: replayMock,
        takeOver: vi.fn()
    })
}))

vi.mock('@/components/Terminal/TerminalView', () => ({
    TerminalView: (props: {
        onMount?: (terminal: {
            focus: () => void
            onData: (handler: (data: string) => void) => { dispose: () => void }
        }) => void
    }) => {
        useEffect(() => {
            props.onMount?.({
                focus: vi.fn(),
                onData: (handler: (data: string) => void) => {
                    capturedTerminalDataHandler = handler
                    return { dispose: vi.fn() }
                }
            })
        }, [])

        return <div data-testid="terminal-view" />
    }
}))

describe('SplitTerminalPanel child shell startup', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        capturedTerminalDataHandler = null
        mockSession = {
            id: 'child-1',
            active: true,
            metadata: {
                flavor: 'shell',
                childRole: 'split-terminal'
            }
        }
    })

    afterEach(() => {
        cleanup()
    })

    it('rewires terminal input to the real shell writer after shellTerminalId appears', () => {
        const { rerender } = render(
            <SplitTerminalPanel
                sessionId="child-1"
                onClose={() => {}}
            />
        )

        expect(capturedTerminalDataHandler).not.toBeNull()

        mockSession = {
            id: 'child-1',
            active: true,
            metadata: {
                flavor: 'shell',
                childRole: 'split-terminal',
                shellTerminalId: 'term-1',
                shellTerminalState: 'ready'
            }
        }

        rerender(
            <SplitTerminalPanel
                sessionId="child-1"
                onClose={() => {}}
            />
        )

        capturedTerminalDataHandler?.('pwd\n')

        expect(newWriteMock).toHaveBeenCalledWith('pwd\n')
        expect(oldWriteMock).not.toHaveBeenCalled()
    })
})
