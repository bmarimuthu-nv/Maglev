import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { SSEManager } from '../../sse/sseManager'
import type { SyncEngine } from '../../sync/syncEngine'
import type { VisibilityState } from '../../visibility/visibilityTracker'
import type { VisibilityTracker } from '../../visibility/visibilityTracker'
import type { WebAppEnv } from '../middleware/auth'
import { enforceRateLimit, type MemoryRateLimiter, type RateLimitRule } from '../middleware/rateLimit'
import { requireSession } from './guards'

type SSETicket = {
    userId: number
    namespace: string
    expiresAt: number
}

const TICKET_TTL_MS = 30_000
const TICKET_CLEANUP_INTERVAL_MS = 60_000
const DEFAULT_TICKET_CAP = 256
const sseTickets = new Map<string, SSETicket>()
const DEFAULT_EVENTS_TICKET_RATE_LIMIT: RateLimitRule = {
    bucket: 'events-ticket',
    max: 30,
    windowMs: 60_000
}

function pruneExpiredTickets(now: number): void {
    for (const [key, ticket] of sseTickets) {
        if (ticket.expiresAt <= now) {
            sseTickets.delete(key)
        }
    }
}

function enforceTicketCap(ticketCap: number): void {
    if (ticketCap <= 0) {
        sseTickets.clear()
        return
    }

    while (sseTickets.size >= ticketCap) {
        const oldestKey = sseTickets.keys().next().value
        if (typeof oldestKey !== 'string') {
            break
        }
        sseTickets.delete(oldestKey)
    }
}

const sseTicketCleanupTimer = setInterval(() => {
    pruneExpiredTickets(Date.now())
}, TICKET_CLEANUP_INTERVAL_MS)

sseTicketCleanupTimer.unref?.()

function parseOptionalId(value: string | undefined): string | null {
    if (!value) {
        return null
    }
    return value.trim() ? value : null
}

function parseOptionalIds(values: string[]): string[] {
    return values
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
}

function parseBoolean(value: string | undefined): boolean {
    if (!value) {
        return false
    }
    return value === 'true' || value === '1'
}

function parseVisibility(value: string | undefined): VisibilityState {
    return value === 'visible' ? 'visible' : 'hidden'
}

const visibilitySchema = z.object({
    subscriptionId: z.string().min(1),
    visibility: z.enum(['visible', 'hidden'])
})

export function createEventsRoutes(
    getSseManager: () => SSEManager | null,
    getSyncEngine: () => SyncEngine | null,
    getVisibilityTracker: () => VisibilityTracker | null,
    options?: {
        ticketCap?: number
        rateLimiter?: MemoryRateLimiter
        ticketRateLimit?: RateLimitRule
    }
): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()
    const ticketCap = options?.ticketCap ?? DEFAULT_TICKET_CAP
    const rateLimiter = options?.rateLimiter
    const ticketRateLimit = options?.ticketRateLimit ?? DEFAULT_EVENTS_TICKET_RATE_LIMIT

    app.post('/events/ticket', (c) => {
        const limited = enforceRateLimit(c, ticketRateLimit, {
            limiter: rateLimiter,
            preferAuthenticatedUser: true
        })
        if (limited) {
            return limited
        }

        const now = Date.now()
        pruneExpiredTickets(now)
        enforceTicketCap(ticketCap)

        const ticket = randomBytes(32).toString('base64url')
        sseTickets.set(ticket, {
            userId: c.get('userId'),
            namespace: c.get('namespace'),
            expiresAt: now + TICKET_TTL_MS
        })
        return c.json({ ticket })
    })

    app.get('/events', (c) => {
        const query = c.req.query()
        const searchParams = new URL(c.req.url).searchParams

        // Validate auth first: accept single-use ticket or JWT-derived namespace
        let namespace = ''
        const ticketParam = query.ticket
        if (ticketParam) {
            const ticketData = sseTickets.get(ticketParam)
            if (!ticketData || ticketData.expiresAt <= Date.now()) {
                sseTickets.delete(ticketParam)
                return c.json({ error: 'Invalid or expired ticket' }, 401)
            }
            sseTickets.delete(ticketParam)
            namespace = ticketData.namespace
            c.set('userId', ticketData.userId)
            c.set('namespace', ticketData.namespace)
        } else {
            namespace = c.get('namespace')
        }

        const manager = getSseManager()
        if (!manager) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const all = parseBoolean(query.all)
        const sessionIds = parseOptionalIds(searchParams.getAll('sessionId'))
        const machineId = parseOptionalId(query.machineId)
        const subscriptionId = randomUUID()
        const visibility = parseVisibility(query.visibility)
        let resolvedSessionIds = sessionIds

        if (sessionIds.length > 0 || machineId) {
            const engine = getSyncEngine()
            if (!engine) {
                return c.json({ error: 'Not connected' }, 503)
            }
            if (sessionIds.length > 0) {
                const nextResolvedSessionIds: string[] = []
                for (const sessionId of sessionIds) {
                    const sessionResult = requireSession(c, engine, sessionId)
                    if (sessionResult instanceof Response) {
                        return sessionResult
                    }
                    nextResolvedSessionIds.push(sessionResult.sessionId)
                }
                resolvedSessionIds = Array.from(new Set(nextResolvedSessionIds))
            }
            if (machineId) {
                const machine = engine.getMachine(machineId)
                if (!machine) {
                    return c.json({ error: 'Machine not found' }, 404)
                }
                if (machine.namespace !== namespace) {
                    return c.json({ error: 'Machine access denied' }, 403)
                }
            }
        }

        return streamSSE(c, async (stream) => {
            manager.subscribe({
                id: subscriptionId,
                namespace,
                all,
                sessionIds: resolvedSessionIds,
                machineId,
                visibility,
                send: (event) => stream.writeSSE({ data: JSON.stringify(event) }),
                sendHeartbeat: async () => {
                    await stream.writeSSE({
                        data: JSON.stringify({
                            type: 'heartbeat',
                            namespace,
                            data: {
                                timestamp: Date.now()
                            }
                        })
                    })
                }
            })

            await stream.writeSSE({
                data: JSON.stringify({
                    type: 'connection-changed',
                    data: {
                        status: 'connected',
                        subscriptionId
                    }
                })
            })

            await new Promise<void>((resolve) => {
                const done = () => resolve()
                c.req.raw.signal.addEventListener('abort', done, { once: true })
                stream.onAbort(done)
            })

            manager.unsubscribe(subscriptionId)
        })
    })

    app.post('/visibility', async (c) => {
        const tracker = getVisibilityTracker()
        if (!tracker) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const json = await c.req.json().catch(() => null)
        const parsed = visibilitySchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const namespace = c.get('namespace')
        const updated = tracker.setVisibility(parsed.data.subscriptionId, namespace, parsed.data.visibility)
        if (!updated) {
            return c.json({ error: 'Subscription not found' }, 404)
        }

        return c.json({ ok: true })
    })

    return app
}

export function resetSseTicketsForTests(): void {
    sseTickets.clear()
}
