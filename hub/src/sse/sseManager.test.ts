import { describe, expect, it } from 'bun:test'
import { SSEManager } from './sseManager'
import type { SyncEvent } from '../sync/syncEngine'
import { VisibilityTracker } from '../visibility/visibilityTracker'

describe('SSEManager namespace filtering', () => {
    it('routes events to matching namespace', () => {
        const manager = new SSEManager(0, new VisibilityTracker())
        const receivedAlpha: SyncEvent[] = []
        const receivedBeta: SyncEvent[] = []

        manager.subscribe({
            id: 'alpha',
            namespace: 'alpha',
            all: true,
            send: (event) => {
                receivedAlpha.push(event)
            },
            sendHeartbeat: () => {}
        })

        manager.subscribe({
            id: 'beta',
            namespace: 'beta',
            all: true,
            send: (event) => {
                receivedBeta.push(event)
            },
            sendHeartbeat: () => {}
        })

        manager.broadcast({ type: 'session-updated', sessionId: 's1', namespace: 'alpha' })

        expect(receivedAlpha).toHaveLength(1)
        expect(receivedBeta).toHaveLength(0)
    })

    it('routes session events to any subscribed session id', () => {
        const manager = new SSEManager(0, new VisibilityTracker())
        const received: SyncEvent[] = []

        manager.subscribe({
            id: 'multi-session',
            namespace: 'alpha',
            sessionIds: ['s1', 's2'],
            send: (event) => {
                received.push(event)
            },
            sendHeartbeat: () => {}
        })

        manager.broadcast({ type: 'session-updated', sessionId: 's2', namespace: 'alpha' })
        manager.broadcast({ type: 'session-updated', sessionId: 's3', namespace: 'alpha' })

        expect(received).toHaveLength(1)
        expect(received[0]).toEqual({ type: 'session-updated', sessionId: 's2', namespace: 'alpha' })
    })

    it('broadcasts connection-changed to all namespaces', () => {
        const manager = new SSEManager(0, new VisibilityTracker())
        const received: Array<{ id: string; event: SyncEvent }> = []

        manager.subscribe({
            id: 'alpha',
            namespace: 'alpha',
            all: true,
            send: (event) => {
                received.push({ id: 'alpha', event })
            },
            sendHeartbeat: () => {}
        })

        manager.subscribe({
            id: 'beta',
            namespace: 'beta',
            all: true,
            send: (event) => {
                received.push({ id: 'beta', event })
            },
            sendHeartbeat: () => {}
        })

        manager.broadcast({ type: 'connection-changed', data: { status: 'connected' } })

        expect(received).toHaveLength(2)
        expect(received.map((entry) => entry.id).sort()).toEqual(['alpha', 'beta'])
    })

    it('sends toast only to visible connections in a namespace', async () => {
        const manager = new SSEManager(0, new VisibilityTracker())
        const received: Array<{ id: string; event: SyncEvent }> = []

        manager.subscribe({
            id: 'visible',
            namespace: 'alpha',
            all: true,
            visibility: 'visible',
            send: (event) => {
                received.push({ id: 'visible', event })
            },
            sendHeartbeat: () => {}
        })

        manager.subscribe({
            id: 'hidden',
            namespace: 'alpha',
            all: true,
            visibility: 'hidden',
            send: (event) => {
                received.push({ id: 'hidden', event })
            },
            sendHeartbeat: () => {}
        })

        manager.subscribe({
            id: 'other',
            namespace: 'beta',
            all: true,
            visibility: 'visible',
            send: (event) => {
                received.push({ id: 'other', event })
            },
            sendHeartbeat: () => {}
        })

        const toastEvent: Extract<SyncEvent, { type: 'toast' }> = {
            type: 'toast',
            data: {
                title: 'Test',
                body: 'Toast body',
                sessionId: 'session-1',
                url: '/sessions/session-1'
            }
        }

        const delivered = await manager.sendToast('alpha', toastEvent)

        expect(delivered).toBe(1)
        expect(received).toHaveLength(1)
        expect(received[0]?.id).toBe('visible')
    })

    it('keeps a connection subscribed until it reaches the failure strike threshold', async () => {
        const manager = new SSEManager(0, new VisibilityTracker(), 3)
        let attempts = 0
        const received: SyncEvent[] = []

        manager.subscribe({
            id: 'flaky',
            namespace: 'alpha',
            all: true,
            send: async (event) => {
                attempts += 1
                if (attempts <= 2) {
                    throw new Error('temporary failure')
                }
                received.push(event)
            },
            sendHeartbeat: () => {}
        })

        manager.broadcast({ type: 'session-updated', sessionId: 's1', namespace: 'alpha' })
        await Promise.resolve()
        manager.broadcast({ type: 'session-updated', sessionId: 's1', namespace: 'alpha' })
        await Promise.resolve()
        manager.broadcast({ type: 'session-updated', sessionId: 's1', namespace: 'alpha' })
        await Promise.resolve()

        expect(received).toHaveLength(1)
        expect(received[0]).toEqual({ type: 'session-updated', sessionId: 's1', namespace: 'alpha' })
    })

    it('resets failure strikes after a successful send', async () => {
        const manager = new SSEManager(0, new VisibilityTracker(), 3)
        let attempts = 0
        let delivered = 0

        manager.subscribe({
            id: 'recovered',
            namespace: 'alpha',
            all: true,
            send: async () => {
                attempts += 1
                if (attempts === 1 || attempts >= 3) {
                    throw new Error('temporary failure')
                }
                delivered += 1
            },
            sendHeartbeat: () => {}
        })

        manager.broadcast({ type: 'session-updated', sessionId: 's1', namespace: 'alpha' })
        await Promise.resolve()
        manager.broadcast({ type: 'session-updated', sessionId: 's1', namespace: 'alpha' })
        await Promise.resolve()
        manager.broadcast({ type: 'session-updated', sessionId: 's1', namespace: 'alpha' })
        await Promise.resolve()
        manager.broadcast({ type: 'session-updated', sessionId: 's1', namespace: 'alpha' })
        await Promise.resolve()
        manager.broadcast({ type: 'session-updated', sessionId: 's1', namespace: 'alpha' })
        await Promise.resolve()

        expect(delivered).toBe(1)
    })

    it('drops a connection after repeated heartbeat failures', async () => {
        const manager = new SSEManager(5, new VisibilityTracker(), 2)
        let heartbeats = 0
        let deliveries = 0

        manager.subscribe({
            id: 'heartbeat-failure',
            namespace: 'alpha',
            all: true,
            send: () => {
                deliveries += 1
            },
            sendHeartbeat: async () => {
                heartbeats += 1
                throw new Error('heartbeat failed')
            }
        })

        await new Promise((resolve) => setTimeout(resolve, 20))

        manager.broadcast({ type: 'session-updated', sessionId: 's1', namespace: 'alpha' })
        await Promise.resolve()
        manager.stop()

        expect(heartbeats).toBeGreaterThanOrEqual(2)
        expect(deliveries).toBe(0)
    })
})
