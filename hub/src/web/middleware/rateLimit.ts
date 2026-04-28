import type { Context } from 'hono'
import type { WebAppEnv } from './auth'

export type RateLimitRule = {
    bucket: string
    max: number
    windowMs: number
}

type RateLimitEntry = {
    count: number
    resetAt: number
}

export class MemoryRateLimiter {
    private readonly entries: Map<string, RateLimitEntry> = new Map()
    private readonly maxEntries: number

    constructor(maxEntries = 10_000) {
        this.maxEntries = maxEntries
    }

    check(rule: RateLimitRule, clientKey: string, now = Date.now()): {
        allowed: boolean
        remaining: number
        retryAfterSeconds: number
    } {
        this.pruneExpiredEntries(now)

        const entryKey = `${rule.bucket}:${clientKey}`
        const existing = this.entries.get(entryKey)

        if (!existing || existing.resetAt <= now) {
            this.entries.set(entryKey, {
                count: 1,
                resetAt: now + rule.windowMs
            })
            this.pruneOverflowEntries()
            return {
                allowed: true,
                remaining: Math.max(0, rule.max - 1),
                retryAfterSeconds: Math.max(1, Math.ceil(rule.windowMs / 1000))
            }
        }

        if (existing.count >= rule.max) {
            return {
                allowed: false,
                remaining: 0,
                retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000))
            }
        }

        existing.count += 1
        return {
            allowed: true,
            remaining: Math.max(0, rule.max - existing.count),
            retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000))
        }
    }

    reset(): void {
        this.entries.clear()
    }

    private pruneExpiredEntries(now: number): void {
        for (const [key, entry] of this.entries) {
            if (entry.resetAt <= now) {
                this.entries.delete(key)
            }
        }
    }

    private pruneOverflowEntries(): void {
        if (this.entries.size <= this.maxEntries) {
            return
        }

        const overflow = this.entries.size - this.maxEntries
        let removed = 0
        for (const key of this.entries.keys()) {
            this.entries.delete(key)
            removed += 1
            if (removed >= overflow) {
                break
            }
        }
    }
}

export const defaultWebRateLimiter = new MemoryRateLimiter()

function parseForwardedHeader(value: string | undefined): string | null {
    if (!value) {
        return null
    }

    const firstSegment = value.split(',')[0]?.trim()
    if (!firstSegment) {
        return null
    }

    for (const part of firstSegment.split(';')) {
        const [rawKey, rawValue] = part.split('=')
        if (rawKey?.trim().toLowerCase() !== 'for') {
            continue
        }

        const candidate = rawValue?.trim().replace(/^"|"$/g, '') ?? ''
        if (!candidate) {
            continue
        }

        return sanitizeClientHint(candidate.replace(/^\[|\]$/g, ''))
    }

    return null
}

function parseForwardedForHeader(value: string | undefined): string | null {
    if (!value) {
        return null
    }

    const first = value.split(',')[0]?.trim()
    return sanitizeClientHint(first ?? null)
}

function sanitizeClientHint(value: string | null | undefined): string | null {
    if (!value) {
        return null
    }

    const trimmed = value.trim()
    if (!trimmed) {
        return null
    }

    return trimmed.replace(/\s+/g, '_').slice(0, 128)
}

function getAnonymousClientHint(c: Context<WebAppEnv>): string {
    const forwardedIp = parseForwardedForHeader(c.req.header('x-forwarded-for'))
        ?? sanitizeClientHint(c.req.header('cf-connecting-ip'))
        ?? sanitizeClientHint(c.req.header('x-real-ip'))
        ?? parseForwardedHeader(c.req.header('forwarded'))
    if (forwardedIp) {
        return `ip:${forwardedIp}`
    }

    const userAgent = sanitizeClientHint(c.req.header('user-agent'))
    if (userAgent) {
        return `ua:${userAgent}`
    }

    return 'anonymous'
}

export function getRateLimitClientKey(
    c: Context<WebAppEnv>,
    options?: {
        preferAuthenticatedUser?: boolean
    }
): string {
    if (options?.preferAuthenticatedUser) {
        const userId = c.get('userId')
        const namespace = c.get('namespace')
        if (typeof userId === 'number' && typeof namespace === 'string' && namespace.length > 0) {
            return `user:${userId}:${namespace}`
        }
    }

    return getAnonymousClientHint(c)
}

export function enforceRateLimit(
    c: Context<WebAppEnv>,
    rule: RateLimitRule,
    options?: {
        limiter?: MemoryRateLimiter
        preferAuthenticatedUser?: boolean
    }
): Response | null {
    const limiter = options?.limiter ?? defaultWebRateLimiter
    const clientKey = getRateLimitClientKey(c, {
        preferAuthenticatedUser: options?.preferAuthenticatedUser
    })
    const result = limiter.check(rule, clientKey)

    c.header('X-RateLimit-Limit', String(rule.max))
    c.header('X-RateLimit-Remaining', String(result.remaining))
    c.header('X-RateLimit-Reset', String(result.retryAfterSeconds))

    if (result.allowed) {
        return null
    }

    c.header('Retry-After', String(result.retryAfterSeconds))
    return c.json({
        error: 'Rate limit exceeded'
    }, 429)
}
