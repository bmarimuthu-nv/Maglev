import { afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import type { WebAppEnv } from '../middleware/auth'
import { createEventsRoutes } from './events'

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
})
