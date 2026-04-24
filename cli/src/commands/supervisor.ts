import chalk from 'chalk'
import axios from 'axios'
import { configuration } from '@/configuration'
import { getAuthToken } from '@/api/auth'
import { initializeToken } from '@/ui/tokenInit'
import type { CommandDefinition } from './types'

type ParsedSupervisorSendArgs = {
    sessionId: string | null
    appendNewline: boolean
    dataParts: string[]
}

function printSupervisorHelp(): void {
    console.log(`
${chalk.bold('maglev supervisor')}

Send input from a supervisor session to its worker shell.

${chalk.bold('Usage:')}
  maglev supervisor send [--session <sessionId>] [--no-newline] -- <command ...>
  maglev supervisor send [--session <sessionId>] [--no-newline] <command ...>

${chalk.bold('Examples:')}
  maglev supervisor send -- ls -la
  maglev supervisor send --session session-123 -- "git status"
`)
}

function parseSupervisorSendArgs(args: string[]): ParsedSupervisorSendArgs {
    let sessionId: string | null = process.env.MAGLEV_SESSION_ID?.trim() || null
    let appendNewline = true
    const dataParts: string[] = []
    let passthrough = false

    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i]
        if (!passthrough && arg === '--') {
            passthrough = true
            continue
        }
        if (!passthrough && arg === '--session' && i + 1 < args.length) {
            sessionId = args[i + 1]?.trim() || null
            i += 1
            continue
        }
        if (!passthrough && arg.startsWith('--session=')) {
            sessionId = arg.slice('--session='.length).trim() || null
            continue
        }
        if (!passthrough && arg === '--no-newline') {
            appendNewline = false
            continue
        }
        dataParts.push(arg)
    }

    return { sessionId, appendNewline, dataParts }
}

export const __test__ = {
    parseSupervisorSendArgs
}

async function sendSupervisorInput(args: string[]): Promise<void> {
    const parsed = parseSupervisorSendArgs(args)
    if (!parsed.sessionId) {
        throw new Error('Supervisor session ID is required. Use --session or run from inside a Maglev shell session.')
    }

    const payload = parsed.dataParts.join(' ')
    if (!payload.trim()) {
        throw new Error('Command text is required.')
    }

    await initializeToken()
    await axios.post(
        `${configuration.apiUrl}/cli/sessions/${encodeURIComponent(parsed.sessionId)}/supervisor/write`,
        {
            data: parsed.appendNewline ? `${payload}\n` : payload
        },
        {
            headers: {
                Authorization: `Bearer ${getAuthToken()}`,
                'Content-Type': 'application/json'
            },
            timeout: 30_000
        }
    )
}

export const supervisorCommand: CommandDefinition = {
    name: 'supervisor',
    description: 'Send worker-shell input from a supervisor session',
    requiresRuntimeAssets: false,
    run: async ({ commandArgs }) => {
        try {
            const subcommand = commandArgs[0]
            if (!subcommand || subcommand === '--help' || subcommand === '-h' || subcommand === 'help') {
                printSupervisorHelp()
                return
            }
            if (subcommand !== 'send') {
                throw new Error(`Unknown supervisor subcommand: ${subcommand}`)
            }

            await sendSupervisorInput(commandArgs.slice(1))
        } catch (error) {
            console.error(chalk.red('Error:'), error instanceof Error ? error.message : 'Unknown error')
            if (process.env.DEBUG) {
                console.error(error)
            }
            process.exit(1)
        }
    }
}
