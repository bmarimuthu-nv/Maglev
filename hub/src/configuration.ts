/**
 * Configuration for maglev-hub (Direct Connect)
 *
 * Configuration is loaded with priority: environment variable > settings.json > default
 * When values are read from environment variables and not present in settings.json,
 * they are automatically saved for future use
 *
 * Optional environment variables:
 * - MAGLEV_API_TOKEN: Shared secret for maglev CLI authentication (auto-generated if not set)
 * - TELEGRAM_BOT_TOKEN: Telegram Bot API token from @BotFather
 * - TELEGRAM_NOTIFICATION: Enable/disable Telegram notifications (default: true)
 * - MAGLEV_LISTEN_HOST: Host/IP to bind the HTTP service (default: 127.0.0.1)
 * - MAGLEV_LISTEN_PORT: Port for HTTP service (default: 3006)
 * - MAGLEV_PUBLIC_URL: Public URL for external access (e.g., Telegram Mini App)
 * - CORS_ORIGINS: Comma-separated CORS origins
 * - MAGLEV_GITHUB_OAUTH_CLIENT_ID: GitHub OAuth App client ID for remote browser auth
 * - MAGLEV_GITHUB_OWNER: Single allowed GitHub login for remote browser auth
 * - MAGLEV_GITHUB_ALLOWED_USERS: Comma-separated allowed GitHub logins for remote browser auth
 * - MAGLEV_SERVER_URL: Self-hosted server base URL for remote registration
 * - VAPID_SUBJECT: Contact email or URL for Web Push (defaults to mailto:admin@maglev.run)
 * - MAGLEV_TERMINAL_SUPERVISION_HUMAN_OVERRIDE_MS: Human-priority cooldown after worker terminal input (default: 30000)
 * - MAGLEV_STALE_SESSION_ARCHIVE_MS: Inactive-session auto-archive TTL in milliseconds (default: 86400000)
 * - MAGLEV_HOME: Data directory (default: ~/.maglev)
 * - DB_PATH: SQLite database path (default: {MAGLEV_HOME}/maglev.db)
 */

import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getOrCreateCliApiToken } from './config/cliApiToken'
import { getSettingsFile } from './config/settings'
import { loadServerSettings, type ServerSettings, type ServerSettingsResult } from './config/serverSettings'

export type ConfigSource = 'env' | 'file' | 'default'

export interface ConfigSources {
    telegramBotToken: ConfigSource
    telegramNotification: ConfigSource
    listenHost: ConfigSource
    listenPort: ConfigSource
    publicUrl: ConfigSource
    corsOrigins: ConfigSource
    githubOauthClientId: ConfigSource
    githubOwner: ConfigSource
    githubAllowedUsers: ConfigSource
    githubAuth: 'file' | 'default'
    serverUrl: ConfigSource
    cliApiToken: 'env' | 'file' | 'generated'
}

class Configuration {
    /** Telegram Bot API token */
    public readonly telegramBotToken: string | null

    /** Telegram bot enabled status (token present) */
    public readonly telegramEnabled: boolean

    /** Telegram notifications enabled */
    public readonly telegramNotification: boolean

    /** CLI auth token (shared secret) */
    public cliApiToken: string

    /** Source of CLI API token */
    public cliApiTokenSource: 'env' | 'file' | 'generated' | ''

    /** Whether CLI API token was newly generated (for first-run display) */
    public cliApiTokenIsNew: boolean

    /** Path to settings.json file */
    public readonly settingsFile: string

    /** Data directory for credentials and state */
    public readonly dataDir: string

    /** SQLite DB path */
    public readonly dbPath: string

    /** Port for the HTTP service */
    public readonly listenPort: number

    /** Host/IP to bind the HTTP service to */
    public readonly listenHost: string

    /** Public URL for external access (e.g., Telegram Mini App) */
    public readonly publicUrl: string

    /** Allowed CORS origins for Mini App + Socket.IO (comma-separated env override) */
    public readonly corsOrigins: string[]

    /** GitHub OAuth App client ID for remote auth */
    public readonly githubOauthClientId: string | null

    /** Preferred single allowed GitHub owner login */
    public readonly githubOwner: string | null

    /** Explicit allowlist of GitHub logins */
    public readonly githubAllowedUsers: string[]

    /** Locally bootstrapped GitHub owner identity */
    public readonly githubAuth: {
        provider: 'github'
        accessToken: string
        userId: number
        login: string
        name?: string
    } | null

    /** Self-hosted server base URL */
    public readonly serverUrl: string | null

    /** Bound machine for this named hub */
    public readonly boundMachineId: string | null

    /** Human-priority cooldown after worker terminal input */
    public readonly terminalSupervisionHumanOverrideMs: number

    /** Inactive-session auto-archive TTL */
    public readonly staleSessionArchiveMs: number

    /** Sources of each configuration value */
    public readonly sources: ConfigSources

    /** Private constructor - use createConfiguration() instead */
    private constructor(
        dataDir: string,
        dbPath: string,
        serverSettings: ServerSettings,
        sources: ServerSettingsResult['sources']
    ) {
        this.dataDir = dataDir
        this.dbPath = dbPath
        this.settingsFile = getSettingsFile(dataDir)

        // Apply server settings
        this.telegramBotToken = serverSettings.telegramBotToken
        this.telegramEnabled = Boolean(this.telegramBotToken)
        this.telegramNotification = serverSettings.telegramNotification
        this.listenHost = serverSettings.listenHost
        this.listenPort = serverSettings.listenPort
        this.publicUrl = serverSettings.publicUrl
        this.corsOrigins = serverSettings.corsOrigins
        this.githubOauthClientId = serverSettings.githubOauthClientId
        this.githubOwner = serverSettings.githubOwner
        this.githubAllowedUsers = serverSettings.githubAllowedUsers
        this.githubAuth = serverSettings.githubAuth
        this.serverUrl = serverSettings.serverUrl
        this.boundMachineId = process.env.MAGLEV_MACHINE_ID?.trim() || null
        this.terminalSupervisionHumanOverrideMs = (() => {
            const raw = process.env.MAGLEV_TERMINAL_SUPERVISION_HUMAN_OVERRIDE_MS?.trim()
            if (!raw) {
                return 30_000
            }
            const parsed = Number.parseInt(raw, 10)
            return Number.isFinite(parsed) && parsed >= 0 ? parsed : 30_000
        })()
        this.staleSessionArchiveMs = (() => {
            const raw = process.env.MAGLEV_STALE_SESSION_ARCHIVE_MS?.trim()
            if (!raw) {
                return 24 * 60 * 60 * 1000
            }
            const parsed = Number.parseInt(raw, 10)
            return Number.isFinite(parsed) && parsed >= 0 ? parsed : 24 * 60 * 60 * 1000
        })()

        // CLI API token - will be set by _setCliApiToken() before create() returns
        this.cliApiToken = ''
        this.cliApiTokenSource = ''
        this.cliApiTokenIsNew = false

        // Store sources for logging (cliApiToken will be set by _setCliApiToken)
        this.sources = {
            ...sources,
        } as ConfigSources

        // Ensure data directory exists
        if (!existsSync(this.dataDir)) {
            mkdirSync(this.dataDir, { recursive: true })
        }
    }

    /** Create configuration asynchronously */
    static async create(): Promise<Configuration> {
        // 1. Determine data directory (env only - not persisted)
        const dataDir = process.env.MAGLEV_HOME
            ? process.env.MAGLEV_HOME.replace(/^~/, homedir())
            : join(homedir(), '.maglev')

        // Ensure data directory exists before loading settings
        if (!existsSync(dataDir)) {
            mkdirSync(dataDir, { recursive: true })
        }

        // 2. Determine DB path (env only - not persisted)
        const dbPath = process.env.DB_PATH
            ? process.env.DB_PATH.replace(/^~/, homedir())
            : join(dataDir, 'maglev.db')

        // 3. Load hub settings (with persistence)
        const settingsResult = await loadServerSettings(dataDir)

        if (settingsResult.savedToFile) {
            console.log(`[Hub] Configuration saved to ${getSettingsFile(dataDir)}`)
        }

        // 4. Create configuration instance
        const config = new Configuration(
            dataDir,
            dbPath,
            settingsResult.settings,
            settingsResult.sources
        )

        // 5. Load CLI API token
        const tokenResult = await getOrCreateCliApiToken(dataDir)
        config._setCliApiToken(tokenResult.token, tokenResult.source, tokenResult.isNew)

        return config
    }

    /** Set CLI API token (called during async initialization) */
    _setCliApiToken(token: string, source: 'env' | 'file' | 'generated', isNew: boolean): void {
        this.cliApiToken = token
        this.cliApiTokenSource = source
        this.cliApiTokenIsNew = isNew
        ;(this.sources as { cliApiToken: string }).cliApiToken = source
    }
}

// Singleton instance (set by createConfiguration)
let _configuration: Configuration | null = null

/**
 * Create and initialize configuration asynchronously.
 * Must be called once at startup before getConfiguration() can be used.
 */
export async function createConfiguration(): Promise<Configuration> {
    if (_configuration) {
        return _configuration
    }
    _configuration = await Configuration.create()
    return _configuration
}

/**
 * Get the initialized configuration.
 * Throws if createConfiguration() has not been called yet.
 */
export function getConfiguration(): Configuration {
    if (!_configuration) {
        throw new Error('Configuration not initialized. Call createConfiguration() first.')
    }
    return _configuration
}

// For compatibility - throws on access if not configured
export const configuration = new Proxy({} as Configuration, {
    get(_, prop) {
        return getConfiguration()[prop as keyof Configuration]
    }
})
