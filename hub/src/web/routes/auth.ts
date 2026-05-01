import { Hono } from 'hono'
import { SignJWT } from 'jose'
import { z } from 'zod'
import { configuration } from '../../configuration'
import { constantTimeEquals } from '../../utils/crypto'
import { DEFAULT_NAMESPACE, parseAccessToken } from '../../utils/accessToken'
import { validateTelegramInitData } from '../telegramInitData'
import { getOrCreateOwnerId } from '../../config/ownerId'
import type { WebAppEnv } from '../middleware/auth'
import { enforceRateLimit, type MemoryRateLimiter, type RateLimitRule } from '../middleware/rateLimit'
import type { Store } from '../../store'
import { GitHubDeviceAuthService } from '../../github/deviceAuth'
import { getBrokerSessionFromHeaders } from '../brokerSession'

const telegramAuthSchema = z.object({
    initData: z.string()
})

const accessTokenAuthSchema = z.object({
    accessToken: z.string()
})

const authBodySchema = z.union([telegramAuthSchema, accessTokenAuthSchema])

const githubDevicePollSchema = z.object({
    deviceCode: z.string().min(1)
})

type AuthRouteRateLimits = {
    auth: RateLimitRule
    authBroker: RateLimitRule
    githubDeviceStart: RateLimitRule
    githubDevicePoll: RateLimitRule
}

const DEFAULT_AUTH_ROUTE_RATE_LIMITS: AuthRouteRateLimits = {
    auth: { bucket: 'auth', max: 10, windowMs: 60_000 },
    authBroker: { bucket: 'auth-broker', max: 20, windowMs: 60_000 },
    githubDeviceStart: { bucket: 'github-device-start', max: 10, windowMs: 60_000 },
    githubDevicePoll: { bucket: 'github-device-poll', max: 60, windowMs: 60_000 }
}

async function signWebJwt(jwtSecret: Uint8Array, namespace: string, options?: { username?: string; firstName?: string; lastName?: string; expiresIn?: string }) {
    const userId = await getOrCreateOwnerId()
    const token = await new SignJWT({ uid: userId, ns: namespace })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime(options?.expiresIn ?? '30d')
        .sign(jwtSecret)

    return {
        token,
        user: {
            id: userId,
            username: options?.username,
            firstName: options?.firstName,
            lastName: options?.lastName
        }
    }
}

function getHubNamespace(): string {
    const raw = process.env.MAGLEV_NAMESPACE?.trim()
    return raw || DEFAULT_NAMESPACE
}

function resolveAccessTokenNamespace(rawAccessToken: string): string {
    const parsedToken = parseAccessToken(rawAccessToken)
    if (!parsedToken) {
        return getHubNamespace()
    }
    if (!rawAccessToken.includes(':') && parsedToken.namespace === DEFAULT_NAMESPACE) {
        return getHubNamespace()
    }
    return parsedToken.namespace
}

export function createAuthRoutes(
    jwtSecret: Uint8Array,
    store: Store,
    options?: {
        remoteMode?: boolean
        gitHubDeviceAuth?: GitHubDeviceAuthService | null
        rateLimiter?: MemoryRateLimiter
        rateLimits?: Partial<AuthRouteRateLimits>
    }
): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()
    const remoteMode = options?.remoteMode === true
    const gitHubDeviceAuth = options?.gitHubDeviceAuth ?? null
    const rateLimiter = options?.rateLimiter
    const rateLimits: AuthRouteRateLimits = {
        ...DEFAULT_AUTH_ROUTE_RATE_LIMITS,
        ...options?.rateLimits
    }

    app.get('/auth/methods', (c) => {
        const methods: string[] = []
        if (!remoteMode && configuration.telegramEnabled && configuration.telegramBotToken) {
            methods.push('telegram')
        }
        if (gitHubDeviceAuth && !remoteMode) {
            methods.push('githubDevice')
        }
        if (remoteMode) {
            methods.push('brokerSession')
        }
        if (!remoteMode) {
            methods.push('accessToken')
        }
        return c.json({ methods })
    })

    app.post('/auth', async (c) => {
        const limited = enforceRateLimit(c, rateLimits.auth, { limiter: rateLimiter })
        if (limited) {
            return limited
        }

        const json = await c.req.json().catch(() => null)
        const parsed = authBodySchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        let userId: number
        let username: string | undefined
        let firstName: string | undefined
        let lastName: string | undefined
        let namespace: string

        // Access Token authentication (MAGLEV_API_TOKEN)
        if ('accessToken' in parsed.data) {
            if (remoteMode) {
                return c.json({ error: 'Access token login is disabled in remote mode' }, 403)
            }
            const parsedToken = parseAccessToken(parsed.data.accessToken)
            if (!parsedToken || !constantTimeEquals(parsedToken.baseToken, configuration.cliApiToken)) {
                return c.json({ error: 'Invalid access token' }, 401)
            }
            userId = await getOrCreateOwnerId()
            firstName = 'Web User'
            namespace = resolveAccessTokenNamespace(parsed.data.accessToken)
        } else {
            if (remoteMode) {
                return c.json({ error: 'Telegram login is disabled in remote mode' }, 403)
            }
            if (!configuration.telegramEnabled || !configuration.telegramBotToken) {
                return c.json({ error: 'Telegram authentication is disabled. Configure TELEGRAM_BOT_TOKEN.' }, 503)
            }

            // Telegram initData authentication
            const result = validateTelegramInitData(parsed.data.initData, configuration.telegramBotToken)
            if (!result.ok) {
                return c.json({ error: result.error }, 401)
            }

            const telegramUserId = String(result.user.id)
            const storedUser = store.users.getUser('telegram', telegramUserId)
            if (!storedUser) {
                return c.json({ error: 'not_bound' }, 401)
            }

            userId = await getOrCreateOwnerId()
            username = result.user.username
            firstName = result.user.first_name
            lastName = result.user.last_name
            namespace = storedUser.namespace
        }

        const auth = await signWebJwt(jwtSecret, namespace, {
            username,
            firstName,
            lastName
        })
        return c.json(auth)
    })

    app.post('/auth/broker', async (c) => {
        const limited = enforceRateLimit(c, rateLimits.authBroker, { limiter: rateLimiter })
        if (limited) {
            return limited
        }

        if (!remoteMode) {
            return c.json({ error: 'Broker session login is only available in remote mode' }, 404)
        }

        const brokerSession = await getBrokerSessionFromHeaders(c.req.raw.headers)
        if (!brokerSession) {
            return c.json({ error: 'Broker session required' }, 401)
        }

        const auth = await signWebJwt(jwtSecret, getHubNamespace(), {
            username: brokerSession.login
        })
        return c.json(auth)
    })

    app.post('/github/device/start', async (c) => {
        const limited = enforceRateLimit(c, rateLimits.githubDeviceStart, { limiter: rateLimiter })
        if (limited) {
            return limited
        }

        if (!gitHubDeviceAuth) {
            return c.json({ error: 'GitHub device auth is disabled' }, 404)
        }
        if (remoteMode) {
            return c.json({ error: 'GitHub device auth is managed by the broker in remote mode' }, 403)
        }

        try {
            const result = await gitHubDeviceAuth.start()
            return c.json(result)
        } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : 'Failed to start GitHub device flow' }, 502)
        }
    })

    app.post('/github/device/poll', async (c) => {
        const limited = enforceRateLimit(c, rateLimits.githubDevicePoll, { limiter: rateLimiter })
        if (limited) {
            return limited
        }

        if (!gitHubDeviceAuth) {
            return c.json({ error: 'GitHub device auth is disabled' }, 404)
        }
        if (remoteMode) {
            return c.json({ error: 'GitHub device auth is managed by the broker in remote mode' }, 403)
        }

        const json = await c.req.json().catch(() => null)
        const parsed = githubDevicePollSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        try {
            const result = await gitHubDeviceAuth.poll(parsed.data.deviceCode)
            if (result.status !== 'authorized') {
                return c.json(result)
            }

            const auth = await signWebJwt(jwtSecret, getHubNamespace(), {
                username: result.identity.login,
                firstName: result.identity.name,
                expiresIn: '30d'
            })
            return c.json({
                status: 'authorized',
                githubUser: result.identity,
                ...auth
            })
        } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : 'Failed to complete GitHub device flow' }, 502)
        }
    })

    return app
}
