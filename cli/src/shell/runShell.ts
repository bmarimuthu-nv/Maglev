import { bootstrapSession } from '@/agent/sessionFactory'
import { registerKillSessionHandler } from '@/session/registerKillSessionHandler'
import { getShellTerminalId } from '@/shell/terminalId'
import { logger } from '@/ui/logger'

export async function runShell(options?: {
    startedBy?: 'runner' | 'terminal'
}): Promise<void> {
    const startupCommand = process.env.MAGLEV_SHELL_STARTUP_COMMAND?.trim() || undefined
    const pinned = process.env.MAGLEV_SHELL_PINNED === 'true'
    const { session, sessionInfo } = await bootstrapSession({
        flavor: 'shell',
        startedBy: options?.startedBy ?? 'terminal',
        workingDirectory: process.cwd(),
        agentState: {
            controlledByUser: false
        },
        metadataOverrides: {
            startupCommand,
            pinned
        }
    })

    logger.infoDeveloper(`Session: ${sessionInfo.id}`)
    logger.infoDeveloper(`Logs: ${logger.logFilePath}`)

    let shutdownRequested = false
    let resolveShutdown: (() => void) | null = null
    const awaitShutdown = new Promise<void>((resolve) => {
        resolveShutdown = resolve
    })

    const requestShutdown = async () => {
        if (shutdownRequested) {
            return
        }
        shutdownRequested = true
        resolveShutdown?.()
    }

    const onSignal = () => {
        void requestShutdown()
    }

    registerKillSessionHandler(session.rpcHandlerManager, requestShutdown)

    process.on('SIGINT', onSignal)
    process.on('SIGTERM', onSignal)

    const terminalId = getShellTerminalId(sessionInfo.id)
    const updateShellMetadataState = (shellTerminalState: 'ready' | 'stale', archiveReason?: string) => {
        session.updateMetadata((currentMetadata) => ({
            ...currentMetadata,
            startupCommand: currentMetadata.startupCommand ?? startupCommand,
            pinned: currentMetadata.pinned ?? pinned,
            shellTerminalId: terminalId,
            shellTerminalState,
            lifecycleState: archiveReason ? 'archived' : currentMetadata.lifecycleState,
            lifecycleStateSince: archiveReason ? Date.now() : currentMetadata.lifecycleStateSince,
            archivedBy: archiveReason ? 'cli' : currentMetadata.archivedBy,
            archiveReason: archiveReason ?? currentMetadata.archiveReason
        }))
    }
    session.ensureTerminal(terminalId, 120, 30, { createIfMissing: true })
    updateShellMetadataState('ready')
    session.keepAlive(false, 'remote')
    const keepAliveInterval = setInterval(() => {
        const tmuxState = session.checkTerminalExists(terminalId)
        if (tmuxState.status === 'missing') {
            updateShellMetadataState('stale', 'Shell backend missing')
            void requestShutdown()
            return
        }
        session.keepAlive(false, 'remote')
    }, 2_000)

    try {
        await awaitShutdown
    } finally {
        clearInterval(keepAliveInterval)
        process.off('SIGINT', onSignal)
        process.off('SIGTERM', onSignal)
        session.sendSessionDeath()
        await session.flush()
        session.close()
    }
}
