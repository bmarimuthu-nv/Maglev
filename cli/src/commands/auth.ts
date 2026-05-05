import chalk from 'chalk'
import os from 'node:os'
import * as readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { configuration } from '@/configuration'
import { readSettings, clearMachineId, updateSettings } from '@/persistence'
import { completeGitHubDeviceFlow, startGitHubDeviceFlow } from '@/auth/githubDevice'
import { getCurrentNamespace, getMachineIdForCurrentNamespace } from '@/utils/namespace'
import { readRemoteGitHubAuthState, writeRemoteGitHubAuthState } from '../../../hub/src/broker/key'
import type { CommandDefinition } from './types'

const DEFAULT_GITHUB_OAUTH_CLIENT_ID = 'Iv23lisoLXKLFuPpGRGe'
const LEGACY_DEFAULT_GITHUB_OAUTH_CLIENT_ID = 'Ov23liS6nujzeYeDnZxL'

function normalizePersistedGitHubOauthClientId(clientId: string | null | undefined): string | undefined {
    const trimmed = clientId?.trim()
    if (!trimmed) {
        return undefined
    }
    return trimmed === LEGACY_DEFAULT_GITHUB_OAUTH_CLIENT_ID ? DEFAULT_GITHUB_OAUTH_CLIENT_ID : trimmed
}

export async function handleAuthCommand(args: string[]): Promise<void> {
    const subcommand = args[0]

    if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
        showHelp()
        return
    }

    if (subcommand === 'status') {
        const settings = await readSettings()
        const envToken = process.env.MAGLEV_API_TOKEN
        const settingsToken = settings.cliApiToken
        const hasToken = Boolean(envToken || settingsToken)
        const tokenSource = envToken ? 'environment' : (settingsToken ? 'settings file' : 'none')
        const machineId = getMachineIdForCurrentNamespace(settings)
        console.log(chalk.bold('\nDirect Connect Status\n'))
        console.log(chalk.gray(`  MAGLEV_API_URL: ${configuration.apiUrl}`))
        console.log(chalk.gray(`  MAGLEV_API_TOKEN: ${hasToken ? 'set' : 'missing'}`))
        console.log(chalk.gray(`  Token Source: ${tokenSource}`))
        console.log(chalk.gray(`  Namespace: ${getCurrentNamespace()}`))
        console.log(chalk.gray(`  Machine ID: ${machineId ?? 'not set'}`))
        console.log(chalk.gray(`  Host: ${os.hostname()}`))

        if (!hasToken) {
            console.log('')
            console.log(chalk.yellow('  Token not configured. To get your token:'))
            console.log(chalk.gray('    1. Check the server startup logs (first run shows generated token)'))
            console.log(chalk.gray('    2. Read ~/.maglev/settings.json on the server'))
            console.log(chalk.gray('    3. Ask your server administrator (if token is set via env var)'))
            console.log('')
            console.log(chalk.gray('  Then run: maglev auth login'))
        }
        return
    }

    if (subcommand === 'github') {
        await handleGitHubAuthCommand(args.slice(1))
        return
    }

    if (subcommand === 'login') {
        if (!process.stdin.isTTY) {
            console.error(chalk.red('Cannot prompt for token in non-TTY environment.'))
            console.error(chalk.gray('Set MAGLEV_API_TOKEN environment variable instead.'))
            process.exit(1)
        }

        const rl = readline.createInterface({ input, output })

        try {
            const token = await rl.question(chalk.cyan('Enter MAGLEV_API_TOKEN: '))

            if (!token.trim()) {
                console.error(chalk.red('Token cannot be empty'))
                process.exit(1)
            }

            await updateSettings(current => ({
                ...current,
                cliApiToken: token.trim()
            }))
            configuration._setCliApiToken(token.trim())
            console.log(chalk.green(`\nToken saved to ${configuration.settingsFile}`))
        } finally {
            rl.close()
        }
        return
    }

    if (subcommand === 'logout') {
        await updateSettings(current => ({
            ...current,
            cliApiToken: undefined
        }))
        await clearMachineId()
        console.log(chalk.green('Cleared local credentials (token and machineId).'))
        console.log(chalk.gray('Note: If MAGLEV_API_TOKEN is set via environment variable, it will still be used.'))
        return
    }

    console.error(chalk.red(`Unknown auth subcommand: ${subcommand}`))
    showHelp()
    process.exit(1)
}

async function handleGitHubAuthCommand(args: string[]): Promise<void> {
    const subcommand = args[0] || 'status'
    const settings = await readSettings()
    const remoteGitHubAuth = await readRemoteGitHubAuthState()
    const githubSettings = remoteGitHubAuth?.state ?? {}

    if (subcommand === 'status') {
        const githubAuth = githubSettings.githubAuth
        const clientId = process.env.MAGLEV_GITHUB_OAUTH_CLIENT_ID?.trim()
            || normalizePersistedGitHubOauthClientId(githubSettings.githubOauthClientId)
            || normalizePersistedGitHubOauthClientId(settings.githubOauthClientId)
            || DEFAULT_GITHUB_OAUTH_CLIENT_ID
        console.log(chalk.bold('\nGitHub Auth Status\n'))
        console.log(chalk.gray(`  OAuth Client ID: ${clientId}`))
        console.log(chalk.gray(`  Storage: ${remoteGitHubAuth?.path ?? '~/.maglev/github-auth.json (not created)'}`))
        if (!githubAuth) {
            console.log(chalk.gray('  Owner: not authenticated'))
            return
        }
        console.log(chalk.gray(`  Owner: ${githubAuth.login} (${githubAuth.userId})`))
        console.log(chalk.gray(`  Name: ${githubAuth.name ?? 'unknown'}`))
        console.log(chalk.gray('  Token: cached'))
        return
    }

    if (subcommand === 'login') {
        const clientId = process.env.MAGLEV_GITHUB_OAUTH_CLIENT_ID?.trim()
            || normalizePersistedGitHubOauthClientId(githubSettings.githubOauthClientId)
            || normalizePersistedGitHubOauthClientId(settings.githubOauthClientId)
            || DEFAULT_GITHUB_OAUTH_CLIENT_ID

        console.log(chalk.bold('\nGitHub Device Login\n'))
        const started = await startGitHubDeviceFlow(clientId)
        console.log(chalk.gray(`  Open: ${started.verificationUri}`))
        console.log(chalk.gray(`  Code: ${started.userCode}`))
        if (started.verificationUriComplete) {
            console.log(chalk.gray(`  Direct: ${started.verificationUriComplete}`))
        }
        console.log('')
        console.log(chalk.gray('Waiting for GitHub authorization...'))

        const deadline = Date.now() + started.expiresIn * 1000
        let intervalMs = Math.max(started.interval, 1) * 1000

        while (Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, intervalMs))
            const result = await completeGitHubDeviceFlow(clientId, started.deviceCode)

            if (result.status === 'authorization_pending') {
                continue
            }
            if (result.status === 'slow_down') {
                intervalMs += 5000
                continue
            }
            if (result.status === 'expired_token') {
                throw new Error('GitHub device code expired. Run `maglev auth github login` again.')
            }
            if (result.status === 'access_denied') {
                throw new Error('GitHub authorization was denied.')
            }
            if (result.status === 'authorized') {
                const path = await writeRemoteGitHubAuthState({
                    githubOauthClientId: clientId,
                    githubAuth: {
                        provider: 'github',
                        accessToken: result.identity.accessToken,
                        userId: result.identity.userId,
                        login: result.identity.login,
                        name: result.identity.name
                    }
                })
                console.log(chalk.green(`Authenticated as ${result.identity.login}. Saved to ${path}`))
                return
            }
        }

        throw new Error('Timed out waiting for GitHub authorization.')
    }

    if (subcommand === 'logout') {
        await writeRemoteGitHubAuthState({
            githubOauthClientId: normalizePersistedGitHubOauthClientId(githubSettings.githubOauthClientId)
                ?? normalizePersistedGitHubOauthClientId(settings.githubOauthClientId),
            githubAuth: undefined
        })
        console.log(chalk.green('Cleared cached GitHub authentication.'))
        return
    }

    console.error(chalk.red(`Unknown GitHub auth subcommand: ${subcommand}`))
    console.log(chalk.gray('Use `maglev auth github status|login|logout`.'))
    process.exit(1)
}

function showHelp(): void {
    console.log(`
${chalk.bold('maglev auth')} - Authentication management

${chalk.bold('Usage:')}
  maglev auth status            Show current configuration
  maglev auth login             Enter and save MAGLEV_API_TOKEN
  maglev auth logout            Clear saved credentials
  maglev auth github status     Show cached GitHub owner auth
  maglev auth github login      Authenticate owner via GitHub device flow
  maglev auth github logout     Clear cached GitHub owner auth

${chalk.bold('Token priority (highest to lowest):')}
  1. MAGLEV_API_TOKEN environment variable
  2. ~/.maglev/settings.json
  3. Interactive prompt (on first run)

${chalk.bold('GitHub owner auth storage:')}
  ~/.maglev/github-auth.json
`)
}

export const authCommand: CommandDefinition = {
    name: 'auth',
    description: 'Manage authentication (login, logout, status)',
    requiresRuntimeAssets: true,
    run: async ({ commandArgs }) => {
        try {
            await handleAuthCommand(commandArgs)
        } catch (error) {
            console.error(chalk.red('Error:'), error instanceof Error ? error.message : 'Unknown error')
            if (process.env.DEBUG) {
                console.error(error)
            }
            process.exit(1)
        }
    }
}
