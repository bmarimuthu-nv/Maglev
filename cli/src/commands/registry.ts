import { authCommand } from './auth'
import { runnerCommand } from './runner'
import { doctorCommand } from './doctor'
import { hubCommand } from './hub'
import { serverCommand } from './server'
import { shellCommand } from './shell'
import type { CommandContext, CommandDefinition } from './types'

const COMMANDS: CommandDefinition[] = [
    authCommand,
    shellCommand,
    hubCommand,
    serverCommand,
    doctorCommand,
    runnerCommand
]

const commandMap = new Map<string, CommandDefinition>()
for (const command of COMMANDS) {
    commandMap.set(command.name, command)
}

export function resolveCommand(args: string[]): { command: CommandDefinition; context: CommandContext } {
    const subcommand = args[0]
    const command = subcommand ? commandMap.get(subcommand) : undefined
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
