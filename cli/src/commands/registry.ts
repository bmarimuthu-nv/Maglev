import { authCommand } from './auth'
import { runnerCommand } from './runner'
import { doctorCommand } from './doctor'
import { hubCommand } from './hub'
import { serverCommand } from './server'
import { shellCommand } from './shell'
import { supervisorCommand } from './supervisor'
import type { CommandContext, CommandDefinition } from './types'

const COMMANDS: CommandDefinition[] = [
    shellCommand,
    supervisorCommand,
    hubCommand,
    serverCommand,
    authCommand,
    doctorCommand,
    runnerCommand
]

const commandMap = new Map<string, CommandDefinition>()
for (const command of COMMANDS) {
    commandMap.set(command.name, command)
}

function showTopLevelHelp(): void {
    console.log('maglev — Terminal session manager\n')
    console.log('Usage:  maglev <command> [options]\n')
    console.log('Commands:')
    const maxLen = Math.max(...COMMANDS.map((c) => c.name.length))
    for (const cmd of COMMANDS) {
        const padding = ' '.repeat(maxLen - cmd.name.length + 2)
        console.log(`  ${cmd.name}${padding}${cmd.description ?? ''}`)
    }
    console.log('\nRun "maglev <command> --help" for command-specific help.')
}

export function resolveCommand(args: string[]): { command: CommandDefinition; context: CommandContext } {
    const subcommand = args[0]

    // Top-level --help before resolving a subcommand
    if (!subcommand || subcommand === '--help' || subcommand === '-h' || subcommand === 'help') {
        return {
            command: {
                name: 'help',
                description: 'Show this help message',
                requiresRuntimeAssets: false,
                run: async () => {
                    showTopLevelHelp()
                    process.exit(0)
                }
            },
            context: { args, subcommand, commandArgs: [] }
        }
    }

    const command = commandMap.get(subcommand)
    const resolvedCommand = command ?? shellCommand
    const commandArgs = command ? args.slice(1) : args

    return {
        command: resolvedCommand,
        context: {
            args,
            subcommand,
            commandArgs
        }
    }
}
