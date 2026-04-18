import { z } from 'zod'
import type { RpcRegistry } from '../../rpcRegistry'
import type { CliSocketWithData } from '../../socketTypes'

const rpcRegisterSchema = z.object({
    method: z.string().min(1)
})

const rpcUnregisterSchema = z.object({
    method: z.string().min(1)
})

/**
 * Validate that the RPC method name belongs to a scope the socket is authorized for.
 * Method names are formatted as `{scopeId}:{handler}`. The socket must have presented
 * the matching sessionId or machineId in its handshake auth to register handlers for it.
 */
function isMethodAllowed(socket: CliSocketWithData, method: string): boolean {
    const colonIndex = method.indexOf(':')
    if (colonIndex < 0) {
        return false
    }
    const scopeId = method.slice(0, colonIndex)
    const auth = socket.handshake.auth as Record<string, unknown> | undefined
    if (!auth) return false
    if (typeof auth.sessionId === 'string' && scopeId === auth.sessionId) return true
    if (typeof auth.machineId === 'string' && scopeId === auth.machineId) return true
    return false
}

export function registerRpcHandlers(socket: CliSocketWithData, rpcRegistry: RpcRegistry): void {
    socket.on('rpc-register', (data: unknown) => {
        const parsed = rpcRegisterSchema.safeParse(data)
        if (!parsed.success) {
            return
        }
        if (!isMethodAllowed(socket, parsed.data.method)) {
            return
        }
        rpcRegistry.register(socket, parsed.data.method)
    })

    socket.on('rpc-unregister', (data: unknown) => {
        const parsed = rpcUnregisterSchema.safeParse(data)
        if (!parsed.success) {
            return
        }
        if (!isMethodAllowed(socket, parsed.data.method)) {
            return
        }
        rpcRegistry.unregister(socket, parsed.data.method)
    })
}
