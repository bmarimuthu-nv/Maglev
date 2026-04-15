import { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'
import { logger } from '@/lib'

interface KillSessionResponse {
    success: boolean
    message: string
}

export function registerKillSessionHandler(
    rpcHandlerManager: RpcHandlerManager,
    killSession: () => Promise<void>
): void {
    rpcHandlerManager.registerHandler<Record<string, never>, KillSessionResponse>('killSession', async () => {
        logger.debug('Kill session request received')

        void killSession()

        return {
            success: true,
            message: 'Killing maglev CLI process'
        }
    })
}
