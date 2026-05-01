import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { ApiError } from '@/api/client'
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
    return {
        queryClient,
        Wrapper(props: { children: ReactNode }) {
            return (
                <QueryClientProvider client={queryClient}>
                    {props.children}
                </QueryClientProvider>
            )
        }
    }
}

describe('useSSE', () => {
    const originalEventSource = globalThis.EventSource

    beforeEach(() => {
        MockEventSource.instances = []
        ;(globalThis as typeof globalThis & { EventSource: typeof EventSource }).EventSource = MockEventSource as unknown as typeof EventSource
    })

    afterEach(() => {
        globalThis.EventSource = originalEventSource
        vi.useRealTimers()
    })

    it('ignores stale disconnects from a torn down subscription', () => {
        const onConnect = vi.fn()
        const onDisconnect = vi.fn()
        const { Wrapper } = createWrapper()
        const initialProps: { all?: boolean; sessionIds?: string[] } = { all: true }

        const { rerender } = renderHook(
            (subscription: { all?: boolean; sessionIds?: string[] }) => useSSE({
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
                wrapper: Wrapper
            }
        )

        const first = MockEventSource.instances[0]
        expect(first).toBeDefined()
        first?.onopen?.(new Event('open'))
        expect(onConnect).toHaveBeenCalledTimes(1)

        rerender({ sessionIds: ['session-1'] })

        const second = MockEventSource.instances[1]
        expect(second).toBeDefined()
        second?.onopen?.(new Event('open'))
        expect(onConnect).toHaveBeenCalledTimes(2)

        first?.onerror?.(new Event('error'))

        expect(onDisconnect).not.toHaveBeenCalled()
    })

    it('does not leak the page query string into the events subscription URL', () => {
        const { Wrapper } = createWrapper()

        renderHook(
            () => useSSE({
                enabled: true,
                token: 'token',
                baseUrl: 'http://localhost:3000/app?tab=directories&path=abc',
                subscription: { sessionIds: ['session-1'] },
                onEvent: vi.fn()
            }),
            { wrapper: Wrapper }
        )

        const first = MockEventSource.instances[0]
        expect(first).toBeDefined()
        expect(first?.url).toContain('/app/api/events?')
        expect(first?.url).toContain('sessionId=session-1')
        expect(first?.url).not.toContain('tab=directories')
        expect(first?.url).not.toContain('path=abc')
        expect(first?.url).not.toContain('session-1?')
    })

    it('invalidates subscribed queries when an existing event source reconnects after disconnect', () => {
        const { Wrapper, queryClient } = createWrapper()
        const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue()

        renderHook(
            () => useSSE({
                enabled: true,
                token: 'token',
                baseUrl: 'http://localhost:3000',
                subscription: {
                    sessionIds: ['session-1'],
                    machineId: 'machine-1'
                },
                onEvent: vi.fn(),
                onDisconnect: vi.fn()
            }),
            { wrapper: Wrapper }
        )

        const eventSource = MockEventSource.instances[0]
        expect(eventSource).toBeDefined()

        eventSource?.onopen?.(new Event('open'))
        invalidateQueries.mockClear()

        eventSource?.onerror?.(new Event('error'))
        eventSource?.onopen?.(new Event('open'))

        expect(invalidateQueries).toHaveBeenCalledWith({
            queryKey: ['sessions', 'http://localhost:3000']
        })
        expect(invalidateQueries).toHaveBeenCalledWith({
            queryKey: ['session', 'http://localhost:3000', 'session-1']
        })
        expect(invalidateQueries).toHaveBeenCalledWith({
            queryKey: ['hub-config', 'http://localhost:3000']
        })
    })

    it('does not fall back to raw token auth when ticket creation is rate limited', () => {
        vi.useFakeTimers()
        const { Wrapper } = createWrapper()

        renderHook(
            () => useSSE({
                enabled: true,
                token: 'token',
                baseUrl: 'http://localhost:3000',
                api: {
                    createEventsTicket: async () => {
                        throw new ApiError('rate limited', 429)
                    }
                } as never,
                onEvent: vi.fn(),
                onError: vi.fn()
            }),
            { wrapper: Wrapper }
        )

        expect(MockEventSource.instances).toHaveLength(0)
        vi.runOnlyPendingTimers()
        expect(MockEventSource.instances).toHaveLength(0)
        vi.useRealTimers()
    })
})
