import chalk from 'chalk'
import { authAndSetupMachineIfNeeded } from '@/ui/auth'
import { initializeToken } from '@/ui/tokenInit'
import { configuration } from '@/configuration'
import type { CommandDefinition } from './types'

type HubHealthProbeResult =
    | {
        ok: true
        apiUrl: string
        healthUrl: string
    }
    | {
        ok: false
        apiUrl: string
        healthUrl: string | null
        reason: 'invalid-url' | 'timeout' | 'connection-refused' | 'http-error' | 'network-error'
        detail: string
        status?: number
    }

function getErrorDetail(error: unknown): string {
    if (!(error instanceof Error)) {
        return 'unknown error'
    }

    const details = [error.name, error.message]
    const cause = (error as Error & { cause?: unknown }).cause
    if (cause instanceof Error) {
        details.push(cause.name, cause.message)
        const code = (cause as Error & { code?: string }).code
        if (code) {
            details.push(code)
        }
    }
    const code = (error as Error & { code?: string }).code
    if (code) {
        details.push(code)
    }

    return details.filter(Boolean).join(': ')
}

function classifyHubHealthError(error: unknown): Pick<Extract<HubHealthProbeResult, { ok: false }>, 'reason' | 'detail'> {
    const detail = getErrorDetail(error)
    const normalizedDetail = detail.toLowerCase()

    if (normalizedDetail.includes('timeout')) {
        return { reason: 'timeout', detail }
    }
    if (normalizedDetail.includes('econnrefused') || normalizedDetail.includes('connection refused')) {
        return { reason: 'connection-refused', detail }
    }

    return { reason: 'network-error', detail }
}

async function probeHubHealth(apiUrl: string, timeoutMs: number = 3000): Promise<HubHealthProbeResult> {
    let healthUrl: string

    try {
        healthUrl = new URL('/health', apiUrl).toString()
    } catch (error) {
        return {
            ok: false,
            apiUrl,
            healthUrl: null,
            reason: 'invalid-url',
            detail: getErrorDetail(error)
        }
    }

    try {
        const response = await fetch(healthUrl, {
            signal: AbortSignal.timeout(timeoutMs)
        })
        if (response.ok) {
            return {
                ok: true,
                apiUrl,
                healthUrl
            }
        }
        return {
            ok: false,
            apiUrl,
            healthUrl,
            reason: 'http-error',
            status: response.status,
            detail: `HTTP ${response.status}`
        }
    } catch (error) {
        const classified = classifyHubHealthError(error)
        return {
            ok: false,
            apiUrl,
            healthUrl,
            ...classified
        }
    }
}

function getHubPreflightGuidance(result: Extract<HubHealthProbeResult, { ok: false }>): string[] {
    const lines = [
        chalk.red('No running hub found.'),
        chalk.gray(`Configured hub URL: ${result.apiUrl}`)
    ]

    switch (result.reason) {
        case 'invalid-url':
            lines.push(chalk.gray('MAGLEV_API_URL is not a valid base URL.'))
            lines.push(chalk.gray('Set it to something like: http://localhost:3006'))
            break
        case 'connection-refused':
            lines.push(chalk.gray(`Nothing is listening at ${result.healthUrl ?? `${result.apiUrl}/health`}.`))
            lines.push(chalk.gray('Start one with: maglev hub start'))
            break
        case 'timeout':
            lines.push(chalk.gray(`Hub did not answer at ${result.healthUrl ?? `${result.apiUrl}/health`} within 3s.`))
            lines.push(chalk.gray('If it is still starting, wait and retry. Otherwise check: maglev hub logs -f'))
            break
        case 'http-error':
            lines.push(chalk.gray(`Expected /health to return 200 OK, got HTTP ${result.status ?? 'unknown'}.`))
            lines.push(chalk.gray('MAGLEV_API_URL may be pointing at the wrong service or port.'))
            break
        case 'network-error':
            lines.push(chalk.gray(`Could not reach ${result.healthUrl ?? `${result.apiUrl}/health`}.`))
            lines.push(chalk.gray(`Network error: ${result.detail}`))
            lines.push(chalk.gray('Check MAGLEV_API_URL or start a local hub with: maglev hub start'))
            break
    }

    return lines
}

export const __test__ = {
    classifyHubHealthError,
    probeHubHealth,
    getHubPreflightGuidance
}

export const shellCommand: CommandDefinition = {
    name: 'shell',
    description: 'Start a shell session (default command)',
    requiresRuntimeAssets: true,
    run: async ({ commandArgs }) => {
        try {
            let startedBy: 'runner' | 'terminal' = 'terminal'

            for (let i = 0; i < commandArgs.length; i++) {
                const arg = commandArgs[i]
                if (arg === '--started-by') {
                    const value = commandArgs[++i]
                    if (value !== 'runner' && value !== 'terminal') {
                        throw new Error('`--started-by` must be `runner` or `terminal`')
                    }
                    startedBy = value
                    continue
                }
                if (arg === '--help' || arg === '-h' || arg === 'help') {
                    console.log(`
${chalk.bold('maglev shell')} - Shell-only remote session

${chalk.bold('Usage:')}
  maglev shell
  maglev shell --started-by runner
`)
                    process.exit(0)
                }
                throw new Error(`Unexpected argument: ${arg}`)
            }

            await initializeToken()

            const hubHealth = await probeHubHealth(configuration.apiUrl)
            if (!hubHealth.ok) {
                for (const line of getHubPreflightGuidance(hubHealth)) {
                    console.error(line)
                }
                process.exit(1)
            }

            await authAndSetupMachineIfNeeded()

            const { runShell } = await import('@/shell/runShell')
            await runShell({ startedBy })
        } catch (error) {
            console.error(chalk.red('Error:'), error instanceof Error ? error.message : 'Unknown error')
            if (process.env.DEBUG) {
                console.error(error)
            }
            process.exit(1)
        }
    }
}
