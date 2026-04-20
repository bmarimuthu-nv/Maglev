import chalk from 'chalk'
import { authAndSetupMachineIfNeeded } from '@/ui/auth'
import { initializeToken } from '@/ui/tokenInit'
import { configuration } from '@/configuration'
import type { CommandDefinition } from './types'

async function checkHubReachable(apiUrl: string): Promise<boolean> {
    try {
        const response = await fetch(`${apiUrl}/health`, {
            signal: AbortSignal.timeout(3000)
        })
        return response.ok
    } catch {
        return false
    }
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

            const hubReachable = await checkHubReachable(configuration.apiUrl)
            if (!hubReachable) {
                console.error(chalk.red('No running hub found.'))
                console.error(chalk.gray(`Could not reach hub at ${configuration.apiUrl}`))
                console.error(chalk.gray('Start one with: maglev hub start'))
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
