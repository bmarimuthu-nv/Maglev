import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { join, resolve } from 'node:path'
import { existsSync, statSync } from 'node:fs'
import { serveStatic } from 'hono/bun'
import { configuration } from '../configuration'
import { PROTOCOL_VERSION } from '@maglev/protocol'
import type { SyncEngine } from '../sync/syncEngine'
import { createAuthMiddleware, type WebAppEnv } from './middleware/auth'
import { createAuthRoutes } from './routes/auth'
import { createBindRoutes } from './routes/bind'
import { createEventsRoutes } from './routes/events'
import { createSessionsRoutes } from './routes/sessions'
import { createPermissionsRoutes } from './routes/permissions'
import { createMachinesRoutes } from './routes/machines'
import { createGitRoutes } from './routes/git'
import { createCliRoutes } from './routes/cli'
import { createPushRoutes } from './routes/push'
import { createHubRoutes } from './routes/hub'
import { createMetricsRoutes } from './routes/metrics'
import type { SSEManager } from '../sse/sseManager'
import type { VisibilityTracker } from '../visibility/visibilityTracker'
import type { Server as BunServer } from 'bun'
import type { Server as SocketEngine } from '@socket.io/bun-engine'
import type { WebSocketData } from '@socket.io/bun-engine'
import { loadEmbeddedAssetMap, type EmbeddedWebAsset } from './embeddedAssets'
import { isBunCompiled } from '../utils/bunCompiled'
import type { Store } from '../store'
import type { GitHubDeviceAuthService } from '../github/deviceAuth'
import { BROKER_SESSION_HEADER } from './brokerSession'
import { loadHubLaunchFolders } from '../hubConfig'
import { createHubHealthSnapshot, logObservabilityEvent } from './observability'

function findWebappDistDir(): { distDir: string; indexHtmlPath: string } {
    const candidates = [
        join(process.cwd(), '..', 'web', 'dist'),
        join(import.meta.dir, '..', '..', '..', 'web', 'dist'),
        join(process.cwd(), 'web', 'dist')
    ]

    for (const distDir of candidates) {
        const indexHtmlPath = join(distDir, 'index.html')
        if (existsSync(indexHtmlPath)) {
            return { distDir, indexHtmlPath }
        }
    }

    const distDir = candidates[0]
    return { distDir, indexHtmlPath: join(distDir, 'index.html') }
}

function serveEmbeddedAsset(asset: EmbeddedWebAsset): Response {
    return new Response(Bun.file(asset.sourcePath), {
        headers: {
            'Content-Type': asset.mimeType
        }
    })
}

function resolveStaticAssetPath(distDir: string, requestPath: string): string | null {
    const normalizedPath = requestPath.replace(/^\/+/, '')
    if (!normalizedPath) {
        return null
    }
    const assetPath = join(distDir, normalizedPath)
    // Prevent path traversal: resolved path must stay under distDir
    const resolvedDistDir = resolve(distDir)
    const resolvedAssetPath = resolve(assetPath)
    if (!resolvedAssetPath.startsWith(resolvedDistDir + '/') && resolvedAssetPath !== resolvedDistDir) {
        return null
    }
    if (!existsSync(assetPath)) {
        return null
    }
    try {
        return statSync(assetPath).isFile() ? assetPath : null
    } catch {
        return null
    }
}

function createWebApp(options: {
    getSyncEngine: () => SyncEngine | null
    getSseManager: () => SSEManager | null
    getVisibilityTracker: () => VisibilityTracker | null
    jwtSecret: Uint8Array
    store: Store
    vapidPublicKey: string
    corsOrigins?: string[]
    embeddedAssetMap: Map<string, EmbeddedWebAsset> | null
    remoteMode?: boolean
    gitHubDeviceAuth?: GitHubDeviceAuthService | null
    startedAtMs: number
}): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.onError((err, c) => {
        console.error('[Web] Unhandled route error:', err.message)
        return c.json({ error: 'Internal server error' }, 500)
    })

    app.use('*', logger())

    if (options.remoteMode) {
        app.use('*', async (c, next) => {
            const path = c.req.path
            if (path === '/health' || path.startsWith('/cli')) {
                return await next()
            }
            if (!c.req.header(BROKER_SESSION_HEADER)) {
                return c.text('Server session required', 401)
            }
            return await next()
        })
    }

    // Health check endpoint (no auth required)
    app.get('/health', (c) => {
        try {
            return c.json(createHubHealthSnapshot({
                syncEngine: options.getSyncEngine(),
                sseManager: options.getSseManager(),
                remoteMode: Boolean(options.remoteMode),
                startedAtMs: options.startedAtMs
            }))
        } catch (error) {
            logObservabilityEvent('error', 'health-request-failed', {
                path: c.req.path,
                message: error instanceof Error ? error.message : 'unknown error'
            })
            return c.json({
                status: 'error',
                protocolVersion: PROTOCOL_VERSION
            }, 500)
        }
    })

    const corsOrigins = options.corsOrigins ?? configuration.corsOrigins
    const corsOriginOption = corsOrigins.includes('*') ? '*' : corsOrigins
    const corsMiddleware = cors({
        origin: corsOriginOption,
        allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
        allowHeaders: ['authorization', 'content-type']
    })
    app.use('/api/*', corsMiddleware)
    app.use('/cli/*', corsMiddleware)

    app.route('/cli', createCliRoutes(options.getSyncEngine))

    app.route('/api', createAuthRoutes(options.jwtSecret, options.store, {
        remoteMode: options.remoteMode,
        gitHubDeviceAuth: options.gitHubDeviceAuth
    }))
    app.route('/api', createBindRoutes(options.jwtSecret, options.store, {
        remoteMode: options.remoteMode
    }))

    app.use('/api/*', createAuthMiddleware(options.jwtSecret))
    app.route('/api', createEventsRoutes(options.getSseManager, options.getSyncEngine, options.getVisibilityTracker))
    app.route('/api', createSessionsRoutes(options.getSyncEngine))
    app.route('/api', createPermissionsRoutes(options.getSyncEngine))
    app.route('/api', createMachinesRoutes(options.getSyncEngine))
    app.route('/api', createGitRoutes(options.getSyncEngine))
    app.route('/api', createHubRoutes(options.getSyncEngine, loadHubLaunchFolders))
    app.route('/api', createMetricsRoutes(options.getSyncEngine, options.getSseManager, options.startedAtMs))
    app.route('/api', createPushRoutes(options.store, options.vapidPublicKey))
    if (options.embeddedAssetMap) {
        const embeddedAssetMap = options.embeddedAssetMap
        const indexHtmlAsset = embeddedAssetMap.get('/index.html')

        if (!indexHtmlAsset) {
            app.get('*', (c) => {
                return c.text(
                    'Embedded Mini App is missing index.html. Rebuild the executable after running bun run build:web.',
                    503
                )
            })
            return app
        }

        app.use('*', async (c, next) => {
            if (c.req.path.startsWith('/api')) {
                return await next()
            }

            if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
                return await next()
            }

            const asset = embeddedAssetMap.get(c.req.path)
            if (asset) {
                return serveEmbeddedAsset(asset)
            }

            return await next()
        })

        app.get('*', async (c, next) => {
            if (c.req.path.startsWith('/api')) {
                await next()
                return
            }

            return serveEmbeddedAsset(indexHtmlAsset)
        })

        return app
    }

    const { distDir, indexHtmlPath } = findWebappDistDir()

    if (!existsSync(indexHtmlPath)) {
        app.get('/', (c) => {
            return c.text(
                'Mini App is not built.\n\nRun:\n  cd web\n  bun install\n  bun run build\n',
                503
            )
        })
        return app
    }

    app.use('/assets/*', serveStatic({ root: distDir }))

    app.use('*', async (c, next) => {
        if (c.req.path.startsWith('/api')) {
            await next()
            return
        }

        if (!resolveStaticAssetPath(distDir, c.req.path)) {
            await next()
            return
        }

        return await serveStatic({ root: distDir })(c, next)
    })

    app.get('*', async (c, next) => {
        if (c.req.path.startsWith('/api')) {
            await next()
            return
        }

        return await serveStatic({ root: distDir, path: 'index.html' })(c, next)
    })

    return app
}

export async function startWebServer(options: {
    getSyncEngine: () => SyncEngine | null
    getSseManager: () => SSEManager | null
    getVisibilityTracker: () => VisibilityTracker | null
    jwtSecret: Uint8Array
    store: Store
    vapidPublicKey: string
    socketEngine: SocketEngine
    corsOrigins?: string[]
    remoteMode?: boolean
    gitHubDeviceAuth?: GitHubDeviceAuthService | null
}): Promise<BunServer<WebSocketData>> {
    const isCompiled = isBunCompiled()
    const embeddedAssetMap = isCompiled ? await loadEmbeddedAssetMap() : null
    const startedAtMs = Date.now()
    const app = createWebApp({
        getSyncEngine: options.getSyncEngine,
        getSseManager: options.getSseManager,
        getVisibilityTracker: options.getVisibilityTracker,
        jwtSecret: options.jwtSecret,
        store: options.store,
        vapidPublicKey: options.vapidPublicKey,
        corsOrigins: options.corsOrigins,
        embeddedAssetMap,
        remoteMode: options.remoteMode,
        gitHubDeviceAuth: options.gitHubDeviceAuth,
        startedAtMs
    })

    const socketHandler = options.socketEngine.handler()

    const server = Bun.serve({
        hostname: configuration.listenHost,
        port: configuration.listenPort,
        idleTimeout: Math.max(30, socketHandler.idleTimeout),
        maxRequestBodySize: socketHandler.maxRequestBodySize,
        websocket: socketHandler.websocket,
        fetch: (req, server) => {
            const url = new URL(req.url)
            if (url.pathname.startsWith('/socket.io/')) {
                return socketHandler.fetch(req, server)
            }
            return app.fetch(req)
        }
    })

    console.log(`[Web] hub listening on ${configuration.listenHost}:${configuration.listenPort}`)
    console.log(`[Web] public URL: ${configuration.publicUrl}`)

    return server
}
