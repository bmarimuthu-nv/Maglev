import { afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { decodeJwt } from 'jose'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createConfiguration } from '../../configuration'
import type { Store } from '../../store'
import type { WebAppEnv } from '../middleware/auth'
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
    gitHubDeviceAuth?: {
        start: () => Promise<unknown>
        poll: (deviceCode: string) => Promise<unknown>
    } | null
}) {
    const app = new Hono<WebAppEnv>()
    app.route('/api', createAuthRoutes(JWT_SECRET, {} as Store, {
        remoteMode: options?.remoteMode,
        gitHubDeviceAuth: options?.gitHubDeviceAuth as never
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
})
