import { PROTOCOL_VERSION } from '@maglev/protocol'
import type { SSEManager } from '../sse/sseManager'
import type { SyncEngine } from '../sync/syncEngine'

export type HubHealthSnapshot = {
    status: 'ok'
    protocolVersion: typeof PROTOCOL_VERSION
    serverTime: string
    uptimeMs: number
    remoteMode: boolean
    sync: {
        connected: boolean
        sessions: {
            total: number
            active: number
        }
        machines: {
            total: number
            online: number
        }
    }
    sse: {
        connections: {
            total: number
            visible: number
        }
    }
}

export type HubNamespaceMetricsSnapshot = {
    namespace: string
    serverTime: string
    uptimeMs: number
    sessions: {
        total: number
        active: number
    }
    machines: {
        total: number
        online: number
    }
    sse: {
        connections: {
            total: number
            visible: number
        }
    }
}

export function createHubHealthSnapshot(options: {
    syncEngine: SyncEngine | null
    sseManager: SSEManager | null
    remoteMode: boolean
    startedAtMs: number
    now?: number
}): HubHealthSnapshot {
    const now = options.now ?? Date.now()
    const syncEngine = options.syncEngine
    const sseManager = options.sseManager

    return {
        status: 'ok',
        protocolVersion: PROTOCOL_VERSION,
        serverTime: new Date(now).toISOString(),
        uptimeMs: Math.max(0, now - options.startedAtMs),
        remoteMode: options.remoteMode,
        sync: {
            connected: Boolean(syncEngine),
            sessions: {
                total: syncEngine?.getSessionCount() ?? 0,
                active: syncEngine?.getActiveSessionCount() ?? 0
            },
            machines: {
                total: syncEngine?.getMachineCount() ?? 0,
                online: syncEngine?.getOnlineMachineCount() ?? 0
            }
        },
        sse: {
            connections: {
                total: sseManager?.getConnectionCount() ?? 0,
                visible: sseManager?.getVisibleConnectionCount() ?? 0
            }
        }
    }
}

export function createHubNamespaceMetricsSnapshot(options: {
    namespace: string
    syncEngine: SyncEngine | null
    sseManager: SSEManager | null
    startedAtMs: number
    now?: number
}): HubNamespaceMetricsSnapshot {
    const now = options.now ?? Date.now()
    const syncEngine = options.syncEngine
    const sseManager = options.sseManager

    return {
        namespace: options.namespace,
        serverTime: new Date(now).toISOString(),
        uptimeMs: Math.max(0, now - options.startedAtMs),
        sessions: {
            total: syncEngine?.getSessionCountByNamespace(options.namespace) ?? 0,
            active: syncEngine?.getActiveSessionCountByNamespace(options.namespace) ?? 0
        },
        machines: {
            total: syncEngine?.getMachineCountByNamespace(options.namespace) ?? 0,
            online: syncEngine?.getOnlineMachineCountByNamespace(options.namespace) ?? 0
        },
        sse: {
            connections: {
                total: sseManager?.getConnectionCount(options.namespace) ?? 0,
                visible: sseManager?.getVisibleConnectionCount(options.namespace) ?? 0
            }
        }
    }
}

export function logObservabilityEvent(
    level: 'warn' | 'error',
    event: string,
    fields: Record<string, unknown> = {}
): void {
    const payload = {
        source: 'hub-observability',
        event,
        ...fields
    }
    const line = JSON.stringify(payload)
    if (level === 'error') {
        console.error(line)
        return
    }
    console.warn(line)
}
