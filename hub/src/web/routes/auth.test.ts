import { afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { decodeJwt } from 'jose'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createConfiguration } from '../../configuration'
import type { Store } from '../../store'
import { createAuthMiddleware, type WebAppEnv } from '../middleware/auth'
import { MemoryRateLimiter } from '../middleware/rateLimit'
import { createAuthRoutes } from './auth'
import { signBrokerSessionToken, BROKER_SESSION_HEADER } from '../brokerSession'

const JWT_SECRET = new TextEncoder().encode('test-jwt-secret')

beforeAll(async () => {
    const maglevHome = join(tmpdir(), `maglev-auth-test-${process.pid}`)
    mkdirSync(maglevHome, { recursive: true })
    process.env.MAGLEV_HOME = maglevHome
    process.env.MAGLEV_API_TOKEN = 'test-cli-token'
    process.env.MAGLEV_GITHUB_OAUTH_CLIENT_ID = 'github-client-id'
    process.env.MAGLEV_GITHUB_OWNER = 'octocat'
    await createConfiguration()
})

afterEach(() => {
    delete process.env.MAGLEV_NAMESPACE
})

function createApp(options?: {
    remoteMode?: boolean
    useMiddleware?: boolean
    gitHubDeviceAuth?: {
        start: () => Promise<unknown>
        poll: (deviceCode: string) => Promise<unknown>
    } | null
    rateLimiter?: MemoryRateLimiter
    rateLimits?: Record<string, {
        bucket: string
        max: number
        windowMs: number
    }>
}) {
    const app = new Hono<WebAppEnv>()
    if (options?.useMiddleware) {
        app.use('/api/*', createAuthMiddleware(JWT_SECRET))
    }
    app.route('/api', createAuthRoutes(JWT_SECRET, {} as Store, {
        remoteMode: options?.remoteMode,
        gitHubDeviceAuth: options?.gitHubDeviceAuth as never,
        rateLimiter: options?.rateLimiter,
        rateLimits: options?.rateLimits as never
    }))
    return app
}

describe('auth routes', () => {
    it('advertises github device auth only in remote mode', async () => {
        const app = createApp({
            remoteMode: true,
            gitHubDeviceAuth: {
                start: async () => ({}),
                poll: async () => ({ status: 'authorization_pending' })
            }
        })

        const response = await app.request('/api/auth/methods')

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            methods: ['brokerSession']
        })
    })

    it('rejects browser access-token auth in remote mode', async () => {
        const app = createApp({
            remoteMode: true,
            gitHubDeviceAuth: {
                start: async () => ({}),
                poll: async () => ({ status: 'authorization_pending' })
            }
        })

        const response = await app.request('/api/auth', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ accessToken: 'test-cli-token' })
        })

        expect(response.status).toBe(403)
        expect(await response.json()).toEqual({
            error: 'Access token login is disabled in remote mode'
        })
    })

    it('completes github device auth and returns a hub jwt in non-remote mode', async () => {
        const app = createApp({
            remoteMode: false,
            gitHubDeviceAuth: {
                start: async () => ({
                    deviceCode: 'device-code',
                    userCode: 'ABCD-EFGH',
                    verificationUri: 'https://github.com/login/device',
                    expiresIn: 900,
                    interval: 5
                }),
                poll: async (deviceCode: string) => {
                    expect(deviceCode).toBe('device-code')
                    return {
                        status: 'authorized',
                        identity: {
                            id: 1,
                            login: 'octocat',
                            name: 'The Octocat'
                        }
                    }
                }
            }
        })

        const response = await app.request('/api/github/device/poll', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ deviceCode: 'device-code' })
        })

        const body = await response.json() as Record<string, unknown>
        expect(response.status).toBe(200)
        expect(body.status).toBe('authorized')
        expect(typeof body.token).toBe('string')
        expect(decodeJwt(String(body.token)).ns).toBe('default')
        expect(body.githubUser).toEqual({
            id: 1,
            login: 'octocat',
            name: 'The Octocat'
        })
    })

    it('mints a hub jwt from a broker session header', async () => {
        process.env.MAGLEV_NAMESPACE = 'hub-devbox-a'
        const app = createApp({
            remoteMode: true,
            gitHubDeviceAuth: {
                start: async () => ({}),
                poll: async () => ({ status: 'authorization_pending' })
            }
        })

        const brokerToken = await signBrokerSessionToken({
            uid: 123,
            login: 'octocat'
        })

        const response = await app.request('/api/auth/broker', {
            method: 'POST',
            headers: {
                [BROKER_SESSION_HEADER]: brokerToken
            }
        })

        const body = await response.json() as Record<string, unknown>
        expect(response.status).toBe(200)
        expect(typeof body.token).toBe('string')
        expect(decodeJwt(String(body.token)).ns).toBe('hub-devbox-a')
    })

    it('allows broker auth bootstrap through jwt middleware', async () => {
        process.env.MAGLEV_NAMESPACE = 'hub-devbox-a'
        const app = createApp({
            remoteMode: true,
            useMiddleware: true,
            gitHubDeviceAuth: {
                start: async () => ({}),
                poll: async () => ({ status: 'authorization_pending' })
            }
        })

        const brokerToken = await signBrokerSessionToken({
            uid: 123,
            login: 'octocat'
        })

        const response = await app.request('/api/auth/broker', {
            method: 'POST',
            headers: {
                [BROKER_SESSION_HEADER]: brokerToken
            }
        })

        const body = await response.json() as Record<string, unknown>
        expect(response.status).toBe(200)
        expect(typeof body.token).toBe('string')
        expect(decodeJwt(String(body.token)).ns).toBe('hub-devbox-a')
    })

    it('rate limits repeated access-token auth attempts from the same forwarded client', async () => {
        const app = createApp({
            rateLimiter: new MemoryRateLimiter(),
            rateLimits: {
                auth: {
                    bucket: 'auth-test',
                    max: 2,
                    windowMs: 60_000
                }
            }
        })

        const requestInit = {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-forwarded-for': '203.0.113.10'
            },
            body: JSON.stringify({ accessToken: 'wrong-token' })
        } satisfies RequestInit

        const first = await app.request('/api/auth', requestInit)
        const second = await app.request('/api/auth', requestInit)
        const third = await app.request('/api/auth', requestInit)

        expect(first.status).toBe(401)
        expect(second.status).toBe(401)
        expect(third.status).toBe(429)
        expect(await third.json()).toEqual({ error: 'Rate limit exceeded' })
    })

    it('keeps auth rate limiting isolated by practical client key', async () => {
        const app = createApp({
            rateLimiter: new MemoryRateLimiter(),
            rateLimits: {
                auth: {
                    bucket: 'auth-test',
                    max: 1,
                    windowMs: 60_000
                }
            }
        })

        const first = await app.request('/api/auth', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-forwarded-for': '203.0.113.10'
            },
            body: JSON.stringify({ accessToken: 'wrong-token' })
        })
        const second = await app.request('/api/auth', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-forwarded-for': '203.0.113.11'
            },
            body: JSON.stringify({ accessToken: 'wrong-token' })
        })

        expect(first.status).toBe(401)
        expect(second.status).toBe(401)
    })
})
