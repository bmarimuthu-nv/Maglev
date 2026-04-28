/**
 * Maglev Hub - Main Entry Point
 *
 * Provides:
 * - Web app + HTTP API
 * - Socket.IO for CLI connections
 * - SSE updates for the web UI
 * - Optional Telegram bot for notifications and Mini App entrypoint
 */

import { createConfiguration, type ConfigSource } from './configuration'
import { Store } from './store'
import { SyncEngine, type SyncEvent } from './sync/syncEngine'
import { NotificationHub } from './notifications/notificationHub'
import type { NotificationChannel } from './notifications/notificationTypes'
import { MaglevBot } from './telegram/bot'
import { startWebServer } from './web/server'
import { getOrCreateJwtSecret } from './config/jwtSecret'
import { createSocketServer } from './socket/server'
import { SSEManager } from './sse/sseManager'
import { getOrCreateVapidKeys } from './config/vapidKeys'
import { PushService } from './push/pushService'
import { PushNotificationChannel } from './push/pushNotificationChannel'
import { VisibilityTracker } from './visibility/visibilityTracker'
import { GitHubDeviceAuthService } from './github/deviceAuth'
import { BrokerClient } from './broker/client'
import { getOrCreateBrokerKey, readBrokerUrl } from './broker/key'
import { loadHubLaunchFoldersSafe } from './hubConfig'
import QRCode from 'qrcode'
import type { Server as BunServer } from 'bun'
import type { WebSocketData } from '@socket.io/bun-engine'

/** Format config source for logging */
function formatSource(source: ConfigSource | 'generated'): string {
    switch (source) {
        case 'env':
            return 'environment'
        case 'file':
            return 'settings.json'
        case 'default':
            return 'default'
        case 'generated':
            return 'generated'
    }
}

function resolveRemoteMode(args: string[]): boolean {
    for (const arg of args) {
        if (arg === '--relay' || arg === '--no-relay') {
            throw new Error('`--relay` and `--no-relay` were removed. Use `maglev hub --remote` for internet-exposed access.')
        }
        if (arg === '--remote') {
            return true
        }
    }
    return false
}

function normalizeOrigin(value: string): string {
    const trimmed = value.trim()
    if (!trimmed) {
        return ''
    }
    try {
        return new URL(trimmed).origin
    } catch {
        return trimmed
    }
}

function normalizeOrigins(origins: string[]): string[] {
    const normalized = origins
        .map(normalizeOrigin)
        .filter(Boolean)
    if (normalized.includes('*')) {
        return ['*']
    }
    return Array.from(new Set(normalized))
}

function mergeCorsOrigins(base: string[], extra: string[]): string[] {
    if (base.includes('*') || extra.includes('*')) {
        return ['*']
    }
    const merged = new Set<string>()
    for (const origin of base) {
        merged.add(origin)
    }
    for (const origin of extra) {
        merged.add(origin)
    }
    return Array.from(merged)
}

let syncEngine: SyncEngine | null = null
let maglevBot: MaglevBot | null = null
let webServer: BunServer<WebSocketData> | null = null
let sseManager: SSEManager | null = null
let visibilityTracker: VisibilityTracker | null = null
let notificationHub: NotificationHub | null = null
let brokerClient: BrokerClient | null = null

async function main() {
    console.log('Maglev Hub starting...')

    // Load configuration (async - loads from env/file with persistence)
    const remoteMode = resolveRemoteMode(process.argv)
    const config = await createConfiguration()
    const discoveredBrokerUrl = remoteMode && !config.brokerUrl
        ? await readBrokerUrl()
        : null
    const effectiveBrokerUrl = config.brokerUrl ?? discoveredBrokerUrl?.url ?? null
    const baseCorsOrigins = normalizeOrigins(config.corsOrigins)
    const corsOrigins = baseCorsOrigins

    // Display CLI API token information
    if (config.cliApiTokenIsNew) {
        console.log('')
        console.log('='.repeat(70))
        console.log('  NEW MAGLEV_API_TOKEN GENERATED')
        console.log('='.repeat(70))
        console.log('')
        console.log(`  Token: ${config.cliApiToken}`)
        console.log('')
        console.log(`  Saved to: ${config.settingsFile}`)
        console.log('')
        console.log('='.repeat(70))
        console.log('')
    } else {
        console.log(`[Hub] MAGLEV_API_TOKEN: loaded from ${formatSource(config.sources.cliApiToken)}`)
    }

    // Display other configuration sources
    console.log(`[Hub] MAGLEV_LISTEN_HOST: ${config.listenHost} (${formatSource(config.sources.listenHost)})`)
    console.log(`[Hub] MAGLEV_LISTEN_PORT: ${config.listenPort} (${formatSource(config.sources.listenPort)})`)
    console.log(`[Hub] MAGLEV_PUBLIC_URL: ${config.publicUrl} (${formatSource(config.sources.publicUrl)})`)
    if (config.boundMachineId) {
        console.log(`[Hub] Bound machine ID: ${config.boundMachineId}`)
    }

    if (!config.telegramEnabled) {
        console.log('[Hub] Telegram: disabled (no TELEGRAM_BOT_TOKEN)')
    } else {
        const tokenSource = formatSource(config.sources.telegramBotToken)
        console.log(`[Hub] Telegram: enabled (${tokenSource})`)
        const notificationSource = formatSource(config.sources.telegramNotification)
        console.log(`[Hub] Telegram notifications: ${config.telegramNotification ? 'enabled' : 'disabled'} (${notificationSource})`)
    }

    // Display tunnel status
    console.log(`[Hub] Remote mode: ${remoteMode ? 'enabled (--remote)' : 'disabled'}`)
    if (remoteMode) {
        if (effectiveBrokerUrl) {
            if (config.brokerUrl) {
                console.log(`[Hub] Broker URL: ${config.brokerUrl} (${formatSource(config.sources.brokerUrl)})`)
            } else if (discoveredBrokerUrl) {
                console.log(`[Hub] Broker URL: ${discoveredBrokerUrl.url} (${discoveredBrokerUrl.path})`)
            }
        }
    } else {
        console.log('[Hub] Tunnel: disabled')
    }

    console.log(`[Hub] GitHub OAuth client ID: ${config.githubOauthClientId ? formatSource(config.sources.githubOauthClientId) : 'not configured'}`)
    if (config.githubOwner) {
        console.log(`[Hub] GitHub owner: ${config.githubOwner} (${formatSource(config.sources.githubOwner)})`)
    } else if (config.githubAllowedUsers.length > 0) {
        console.log(`[Hub] GitHub allowlist: ${config.githubAllowedUsers.join(', ')} (${formatSource(config.sources.githubAllowedUsers)})`)
    } else if (config.githubAuth) {
        console.log(`[Hub] GitHub owner: ${config.githubAuth.login} (~/.maglev/github-auth.json bootstrap)`)
    } else {
        console.log('[Hub] GitHub allowlist: not configured')
    }

    if (remoteMode) {
        if (!config.githubOauthClientId) {
            throw new Error('Remote mode requires MAGLEV_GITHUB_OAUTH_CLIENT_ID')
        }
        if (!effectiveBrokerUrl) {
            throw new Error('Remote mode requires a broker URL. Start `maglev server` first so it can write ~/.maglev/broker-url, or pass `--broker-url`.')
        }
        if (!config.githubOwner && config.githubAllowedUsers.length === 0 && !config.githubAuth) {
            throw new Error('Remote mode requires MAGLEV_GITHUB_OWNER, MAGLEV_GITHUB_ALLOWED_USERS, or a bootstrapped owner from `maglev auth github login`')
        }
    }

    const store = new Store(config.dbPath)
    const jwtSecret = await getOrCreateJwtSecret()
    const vapidKeys = await getOrCreateVapidKeys(config.dataDir)
    const vapidSubject = process.env.VAPID_SUBJECT ?? 'mailto:admin@maglev.run'
    const pushService = new PushService(vapidKeys, vapidSubject, store)
    const gitHubAllowedUsers = config.githubOwner
        ? [config.githubOwner]
        : config.githubAllowedUsers.length > 0
            ? config.githubAllowedUsers
            : config.githubAuth
                ? [config.githubAuth.login]
                : []
    const gitHubDeviceAuth = remoteMode
        ? new GitHubDeviceAuthService({
            clientId: config.githubOauthClientId!,
            allowedUsers: gitHubAllowedUsers
        })
        : null

    visibilityTracker = new VisibilityTracker()
    sseManager = new SSEManager(30_000, visibilityTracker)

    const socketServer = createSocketServer({
        store,
        jwtSecret,
        corsOrigins,
        getSession: (sessionId) => {
            if (syncEngine) {
                return syncEngine.getSession(sessionId) ?? null
            }
            return store.sessions.getSession(sessionId)
        },
        onWebappEvent: (event: SyncEvent) => syncEngine?.handleRealtimeEvent(event),
        onSessionAlive: (payload) => syncEngine?.handleSessionAlive(payload),
        onSessionEnd: (payload) => syncEngine?.handleSessionEnd(payload),
        onMachineAlive: (payload) => syncEngine?.handleMachineAlive(payload),
        onSessionTerminalInput: (payload) => syncEngine?.noteHumanTerminalInput(payload.sessionId),
        onTerminalSnapshotUpdated: (payload) => {
            void syncEngine?.syncTerminalSupervisionBridge(payload.sessionId, payload.namespace)
        }
    })

    syncEngine = new SyncEngine(store, socketServer.io, socketServer.rpcRegistry, sseManager, {
        boundMachineId: config.boundMachineId,
        terminalStateCache: socketServer.terminalStateCache,
        terminalSupervisionHumanOverrideMs: config.terminalSupervisionHumanOverrideMs,
        staleSessionArchiveMs: config.staleSessionArchiveMs
    })

    const notificationChannels: NotificationChannel[] = [
        new PushNotificationChannel(pushService, sseManager, visibilityTracker, config.publicUrl)
    ]

    // Initialize Telegram bot (optional)
    if (config.telegramEnabled && config.telegramBotToken) {
        maglevBot = new MaglevBot({
            syncEngine,
            botToken: config.telegramBotToken,
            publicUrl: config.publicUrl,
            store
        })
        // Only add to notification channels if notifications are enabled
        if (config.telegramNotification) {
            notificationChannels.push(maglevBot)
        }
    }

    notificationHub = new NotificationHub(syncEngine, notificationChannels)

    // Start HTTP service first (before tunnel, so tunnel has something to forward to)
    webServer = await startWebServer({
        getSyncEngine: () => syncEngine,
        getSseManager: () => sseManager,
        getVisibilityTracker: () => visibilityTracker,
        jwtSecret,
        store,
        vapidPublicKey: vapidKeys.publicKey,
        socketEngine: socketServer.engine,
        corsOrigins,
        remoteMode,
        gitHubDeviceAuth
    })

    // Start the bot if configured
    if (maglevBot) {
        await maglevBot.start()
    }

    console.log('')
    console.log('[Web] Hub listening on :' + config.listenPort)
    console.log('[Web] Local:  http://localhost:' + config.listenPort)

    // Initialize tunnel AFTER web service is ready
    let tunnelUrl: string | null = null
    if (remoteMode) {
        const hubLaunchConfig = await loadHubLaunchFoldersSafe()
        const brokerOwner = config.githubOwner
            ?? config.githubAllowedUsers[0]
            ?? config.githubAuth?.login

        if (!brokerOwner) {
            throw new Error('Remote mode requires a GitHub owner identity')
        }

        const configuredBrokerToken = process.env.MAGLEV_BROKER_TOKEN?.trim() || null
        const brokerKey = configuredBrokerToken
            ? null
            : await getOrCreateBrokerKey()

        if (brokerKey) {
            console.log(`[Broker] Registration key: ${brokerKey.created ? 'created' : 'loaded'} from ${brokerKey.path}`)
        } else {
            console.log('[Broker] Registration key: loaded from MAGLEV_BROKER_TOKEN')
        }

        brokerClient = new BrokerClient({
            brokerUrl: effectiveBrokerUrl!,
            brokerToken: configuredBrokerToken ?? brokerKey?.key ?? null,
            owner: brokerOwner,
            localHost: config.listenHost,
            localPort: config.listenPort,
            hubName: process.env.MAGLEV_HUB_NAME?.trim() || null,
            launchFolders: hubLaunchConfig.folders,
            configError: hubLaunchConfig.error,
            onStatusChange: (status) => {
                console.log(`[Broker] ${status}`)
            }
        })

        try {
            tunnelUrl = await brokerClient.start()
            console.log(`[Broker] Registered hub ${brokerClient.getHubId()}`)
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            const brokerSource = config.brokerUrl
                ? `${config.brokerUrl} (${formatSource(config.sources.brokerUrl)})`
                : discoveredBrokerUrl
                    ? `${discoveredBrokerUrl.url} (${discoveredBrokerUrl.path})`
                    : effectiveBrokerUrl!
            throw new Error(
                `Remote mode broker registration failed for ${brokerSource}: ${message}. ` +
                'Pass `--broker-url <url>` or fix ~/.maglev/broker-url, then retry.'
            )
        }
    }

    if (tunnelUrl) {
        const announceTunnelAccess = async () => {
            console.log('[Broker] Public: ' + tunnelUrl)

            console.log('')
            console.log('Open in browser:')
            console.log(`  ${tunnelUrl}`)
            console.log('')
            console.log('or scan the QR code to open:')

            // Display QR code for easy mobile access
            try {
                const qrString = await QRCode.toString(tunnelUrl, {
                    type: 'terminal',
                    small: true,
                    margin: 1,
                    errorCorrectionLevel: 'L'
                })
                console.log('')
                console.log(qrString)
            } catch {
                // QR code generation failure should not affect main flow
            }
        }

        void announceTunnelAccess()
    }
    console.log('')
    console.log('Maglev Hub is ready!')

    // Handle shutdown
    const shutdown = async () => {
        console.log('\nShutting down...')
        await brokerClient?.stop()
        await maglevBot?.stop()
        notificationHub?.stop()
        syncEngine?.stop()
        sseManager?.stop()
        webServer?.stop()
        process.exit(0)
    }

    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)

    // Keep process running
    await new Promise(() => {})
}

main().catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
})
