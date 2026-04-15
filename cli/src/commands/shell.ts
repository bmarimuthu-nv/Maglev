import chalk from 'chalk'
import { authAndSetupMachineIfNeeded } from '@/ui/auth'
import { initializeToken } from '@/ui/tokenInit'
import { maybeAutoStartServer } from '@/utils/autoStartServer'
import type { CommandDefinition } from './types'

export const shellCommand: CommandDefinition = {
    name: 'shell',
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
            await maybeAutoStartServer()
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
