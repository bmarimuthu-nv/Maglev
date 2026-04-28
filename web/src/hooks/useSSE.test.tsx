import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useSSE } from './useSSE'

class MockEventSource {
    static CONNECTING = 0
    static OPEN = 1
    static CLOSED = 2
    static instances: MockEventSource[] = []

    readonly url: string
    readyState = MockEventSource.CONNECTING
    onopen: ((event: Event) => void) | null = null
    onmessage: ((event: MessageEvent<string>) => void) | null = null
    onerror: ((event: Event) => void) | null = null
    close = vi.fn(() => {
        this.readyState = MockEventSource.CLOSED
    })

    constructor(url: string) {
        this.url = url
        MockEventSource.instances.push(this)
    }
}

function createWrapper() {
    const queryClient = new QueryClient()
    return function Wrapper(props: { children: ReactNode }) {
        return (
            <QueryClientProvider client={queryClient}>
                {props.children}
            </QueryClientProvider>
        )
    }
}

describe('useSSE', () => {
    const originalEventSource = globalThis.EventSource

    beforeEach(() => {
        MockEventSource.instances = []
        vi.stubGlobal('EventSource', MockEventSource)
    })

    afterEach(() => {
        vi.unstubAllGlobals()
        globalThis.EventSource = originalEventSource
    })

    it('ignores stale disconnects from a torn down subscription', () => {
        const onConnect = vi.fn()
        const onDisconnect = vi.fn()
        const wrapper = createWrapper()
        const initialProps: { all?: boolean; sessionId?: string } = { all: true }

        const { rerender } = renderHook(
            (subscription: { all?: boolean; sessionId?: string }) => useSSE({
                enabled: true,
                token: 'token',
                baseUrl: 'http://localhost:3000',
                subscription,
                onEvent: vi.fn(),
                onConnect,
                onDisconnect
            }),
            {
                initialProps,
                wrapper
            }
        )

        const first = MockEventSource.instances[0]
        expect(first).toBeDefined()
        first?.onopen?.(new Event('open'))
        expect(onConnect).toHaveBeenCalledTimes(1)

        rerender({ sessionId: 'session-1' })

        const second = MockEventSource.instances[1]
        expect(second).toBeDefined()
        second?.onopen?.(new Event('open'))
        expect(onConnect).toHaveBeenCalledTimes(2)

        first?.onerror?.(new Event('error'))

        expect(onDisconnect).not.toHaveBeenCalled()
    })

    it('does not leak the page query string into the events subscription URL', () => {
        const wrapper = createWrapper()

        renderHook(
            () => useSSE({
                enabled: true,
                token: 'token',
                baseUrl: 'http://localhost:3000/app?tab=directories&path=abc',
                subscription: { sessionId: 'session-1' },
                onEvent: vi.fn()
            }),
            { wrapper }
        )

        const first = MockEventSource.instances[0]
        expect(first).toBeDefined()
        expect(first?.url).toContain('/app/api/events?')
        expect(first?.url).toContain('sessionId=session-1')
        expect(first?.url).not.toContain('tab=directories')
        expect(first?.url).not.toContain('path=abc')
        expect(first?.url).not.toContain('session-1?')
    })
})
