/**
 * Global configuration for Maglev CLI
 *
 * Centralizes all configuration including environment variables and paths
 * Environment files should be loaded using Node's --env-file flag
 */

import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import packageJson from '../package.json'
import { getCliArgs } from '@/utils/cliArgs'
import { DEFAULT_NAMESPACE, getCurrentNamespace } from '@/utils/namespace'

class Configuration {
    private _apiUrl: string
    private _cliApiToken: string
    public readonly isRunnerProcess: boolean

    // Directories and paths (from persistence)
    public readonly maglevHomeDir: string
    public readonly logsDir: string
    public readonly settingsFile: string
    public readonly privateKeyFile: string
    public readonly runnerStateFile: string
    public readonly runnerLockFile: string
    public readonly currentCliVersion: string

    public readonly isExperimentalEnabled: boolean

    constructor() {
        // Server configuration
        this._apiUrl = process.env.MAGLEV_API_URL || 'http://localhost:3006'
        this._cliApiToken = process.env.MAGLEV_API_TOKEN || ''

        // Check if we're running as runner based on process args
        const args = getCliArgs()
        this.isRunnerProcess = args.length >= 2 && args[0] === 'runner' && (args[1] === 'start-sync')

        // Directory configuration - Priority: MAGLEV_HOME env > default home dir
        if (process.env.MAGLEV_HOME) {
            // Expand ~ to home directory if present
            const expandedPath = process.env.MAGLEV_HOME.replace(/^~/, homedir())
            this.maglevHomeDir = expandedPath
        } else {
            this.maglevHomeDir = join(homedir(), '.maglev')
        }

        this.logsDir = join(this.maglevHomeDir, 'logs')
        this.settingsFile = join(this.maglevHomeDir, 'settings.json')
        this.privateKeyFile = join(this.maglevHomeDir, 'access.key')
        const namespace = getCurrentNamespace()
        const runnerStateBasename = namespace === DEFAULT_NAMESPACE
            ? 'runner.state.json'
            : `runner.${namespace.replace(/[^a-zA-Z0-9._-]+/g, '-')}.state.json`
        this.runnerStateFile = join(this.maglevHomeDir, runnerStateBasename)
        this.runnerLockFile = `${this.runnerStateFile}.lock`

        this.isExperimentalEnabled = ['true', '1', 'yes'].includes(process.env.MAGLEV_EXPERIMENTAL?.toLowerCase() || '')

        this.currentCliVersion = packageJson.version

        if (!existsSync(this.maglevHomeDir)) {
            mkdirSync(this.maglevHomeDir, { recursive: true })
        }
        // Ensure directories exist
        if (!existsSync(this.logsDir)) {
            mkdirSync(this.logsDir, { recursive: true })
        }
    }

    get apiUrl(): string {
        return this._apiUrl
    }

    _setApiUrl(url: string): void {
        this._apiUrl = url
    }

    get cliApiToken(): string {
        return this._cliApiToken
    }

    _setCliApiToken(token: string): void {
        this._cliApiToken = token
    }
}

export const configuration: Configuration = new Configuration()
