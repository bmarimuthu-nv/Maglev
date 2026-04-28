import { afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { MemoryRateLimiter } from '../middleware/rateLimit'
import type { WebAppEnv } from '../middleware/auth'
import { createEventsRoutes, resetSseTicketsForTests } from './events'

// Minimal stubs
const nullSseManager = () => null
const nullSyncEngine = () => null
const nullVisibilityTracker = () => null

function createApp() {
    const app = new Hono<WebAppEnv>()

    // Simulate auth middleware setting userId and namespace
    app.use('/api/*', async (c, next) => {
        c.set('userId', 1)
        c.set('namespace', 'test-ns')
        await next()
    })

    app.route('/api', createEventsRoutes(nullSseManager, nullSyncEngine, nullVisibilityTracker))
    return app
}

function createStreamingApp(options?: {
    ticketCap?: number
    rateLimiter?: MemoryRateLimiter
    ticketRateLimit?: {
        bucket: string
        max: number
        windowMs: number
    }
}) {
    const app = new Hono<WebAppEnv>()

    app.use('/api/*', async (c, next) => {
        c.set('userId', 1)
        c.set('namespace', 'test-ns')
        await next()
    })

    const sseManager = {
        subscribe: () => undefined,
        unsubscribe: () => undefined
    }

    const syncEngine = {
        resolveSessionAccess: (_sessionId: string, namespace: string) => ({
            ok: namespace === 'test-ns',
            sessionId: 'session-1',
            session: {
                id: 'session-1',
                namespace: 'test-ns',
                active: true
            }
        }),
        getMachine: () => undefined
    }

    app.route(
        '/api',
        createEventsRoutes(
            () => sseManager as any,
            () => syncEngine as any,
            () => null,
            options
        )
    )

    return app
}

afterEach(() => {
    resetSseTicketsForTests()
})

describe('SSE ticket endpoint', () => {
    it('POST /api/events/ticket returns a ticket string', async () => {
        const app = createApp()
        const res = await app.request('/api/events/ticket', { method: 'POST' })
        expect(res.status).toBe(200)
        const body = await res.json() as { ticket: string }
        expect(typeof body.ticket).toBe('string')
        expect(body.ticket.length).toBeGreaterThan(0)
    })

    it('returns different tickets on each call', async () => {
        const app = createApp()
        const res1 = await app.request('/api/events/ticket', { method: 'POST' })
        const res2 = await app.request('/api/events/ticket', { method: 'POST' })
        const body1 = await res1.json() as { ticket: string }
        const body2 = await res2.json() as { ticket: string }
        expect(body1.ticket).not.toBe(body2.ticket)
    })

    it('GET /api/events with valid ticket passes auth (returns 503 because SSE manager is null)', async () => {
        const app = createApp()

        // First get a ticket
        const ticketRes = await app.request('/api/events/ticket', { method: 'POST' })
        const { ticket } = await ticketRes.json() as { ticket: string }

        // Use the ticket to connect to SSE
        const eventsRes = await app.request(`/api/events?ticket=${encodeURIComponent(ticket)}`)
        // Should get 503 (SSE manager is null) not 401 (auth failure)
        expect(eventsRes.status).toBe(503)
    })

    it('GET /api/events with a reused ticket fails', async () => {
        const app = createApp()

        const ticketRes = await app.request('/api/events/ticket', { method: 'POST' })
        const { ticket } = await ticketRes.json() as { ticket: string }

        // First use - should pass auth (503 from null manager)
        const first = await app.request(`/api/events?ticket=${encodeURIComponent(ticket)}`)
        expect(first.status).toBe(503)

        // Second use - ticket was consumed, should fail
        const second = await app.request(`/api/events?ticket=${encodeURIComponent(ticket)}`)
        expect(second.status).toBe(401)
    })

    it('GET /api/events with invalid ticket returns 401', async () => {
        const app = createApp()
        const res = await app.request('/api/events?ticket=bogus-ticket-value')
        expect(res.status).toBe(401)
    })

    it('GET /api/events with ticket auth and sessionId uses the ticket namespace for session access', async () => {
        const app = createStreamingApp()

        const ticketRes = await app.request('/api/events/ticket', { method: 'POST' })
        const { ticket } = await ticketRes.json() as { ticket: string }

        const eventsRes = await app.request(`/api/events?ticket=${encodeURIComponent(ticket)}&sessionId=session-1`)
        expect(eventsRes.status).toBe(200)
    })

    it('GET /api/events accepts multiple sessionId params', async () => {
        const app = createStreamingApp()

        const ticketRes = await app.request('/api/events/ticket', { method: 'POST' })
        const { ticket } = await ticketRes.json() as { ticket: string }

        const eventsRes = await app.request(
            `/api/events?ticket=${encodeURIComponent(ticket)}&sessionId=session-1&sessionId=session-1`
        )
        expect(eventsRes.status).toBe(200)
    })

    it('prunes the oldest tickets when the ticket cap is exceeded', async () => {
        const app = createStreamingApp({
            ticketCap: 2
        })

        const firstTicketRes = await app.request('/api/events/ticket', { method: 'POST' })
        const secondTicketRes = await app.request('/api/events/ticket', { method: 'POST' })
        const thirdTicketRes = await app.request('/api/events/ticket', { method: 'POST' })

        const firstTicket = (await firstTicketRes.json() as { ticket: string }).ticket
        const secondTicket = (await secondTicketRes.json() as { ticket: string }).ticket
        const thirdTicket = (await thirdTicketRes.json() as { ticket: string }).ticket

        const firstUse = await app.request(`/api/events?ticket=${encodeURIComponent(firstTicket)}`)
        expect(firstUse.status).toBe(401)

        const secondUse = await app.request(`/api/events?ticket=${encodeURIComponent(secondTicket)}`)
        const thirdUse = await app.request(`/api/events?ticket=${encodeURIComponent(thirdTicket)}`)
        expect(secondUse.status).toBe(200)
        expect(thirdUse.status).toBe(200)
    })

    it('rate limits ticket creation per authenticated user', async () => {
        const app = createStreamingApp({
            rateLimiter: new MemoryRateLimiter(),
            ticketRateLimit: {
                bucket: 'events-ticket-test',
                max: 2,
                windowMs: 60_000
            }
        })

        const first = await app.request('/api/events/ticket', { method: 'POST' })
        const second = await app.request('/api/events/ticket', { method: 'POST' })
        const third = await app.request('/api/events/ticket', { method: 'POST' })

        expect(first.status).toBe(200)
        expect(second.status).toBe(200)
        expect(third.status).toBe(429)
        expect(third.headers.get('retry-after')).toBeTruthy()
        expect(await third.json()).toEqual({ error: 'Rate limit exceeded' })
    })
})
