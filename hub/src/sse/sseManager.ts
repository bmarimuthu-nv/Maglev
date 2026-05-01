import type { SyncEvent } from '../sync/syncEngine'
import type { VisibilityState } from '../visibility/visibilityTracker'
import type { VisibilityTracker } from '../visibility/visibilityTracker'

export type SSESubscription = {
    id: string
    namespace: string
    all: boolean
    sessionIds: string[]
    machineId: string | null
}

type SSEConnection = SSESubscription & {
    send: (event: SyncEvent) => void | Promise<void>
    sendHeartbeat: () => void | Promise<void>
    failureStrikes: number
}

export class SSEManager {
    private readonly connections: Map<string, SSEConnection> = new Map()
    private heartbeatTimer: NodeJS.Timeout | null = null
    private readonly heartbeatMs: number
    private readonly visibilityTracker: VisibilityTracker
    private readonly maxFailureStrikes: number

    constructor(heartbeatMs = 30_000, visibilityTracker: VisibilityTracker, maxFailureStrikes = 3) {
        this.heartbeatMs = heartbeatMs
        this.visibilityTracker = visibilityTracker
        this.maxFailureStrikes = Math.max(1, maxFailureStrikes)
    }

    subscribe(options: {
        id: string
        namespace: string
        all?: boolean
        sessionIds?: string[]
        machineId?: string | null
        visibility?: VisibilityState
        send: (event: SyncEvent) => void | Promise<void>
        sendHeartbeat: () => void | Promise<void>
    }): SSESubscription {
        const subscription: SSEConnection = {
            id: options.id,
            namespace: options.namespace,
            all: Boolean(options.all),
            sessionIds: options.sessionIds ?? [],
            machineId: options.machineId ?? null,
            send: options.send,
            sendHeartbeat: options.sendHeartbeat,
            failureStrikes: 0
        }

        this.connections.set(subscription.id, subscription)
        this.visibilityTracker.registerConnection(
            subscription.id,
            subscription.namespace,
            options.visibility ?? 'hidden'
        )
        this.ensureHeartbeat()
        return {
            id: subscription.id,
            namespace: subscription.namespace,
            all: subscription.all,
            sessionIds: subscription.sessionIds,
            machineId: subscription.machineId
        }
    }

    unsubscribe(id: string): void {
        this.connections.delete(id)
        this.visibilityTracker.removeConnection(id)
        if (this.connections.size === 0) {
            this.stopHeartbeat()
        }
    }

    async sendToast(namespace: string, event: Extract<SyncEvent, { type: 'toast' }>): Promise<number> {
        const deliveries: Array<Promise<{ id: string; ok: boolean }>> = []
        for (const connection of this.connections.values()) {
            if (connection.namespace !== namespace) {
                continue
            }
            if (!this.visibilityTracker.isVisibleConnection(connection.id)) {
                continue
            }

            deliveries.push(
                Promise.resolve(connection.send(event))
                    .then(() => ({ id: connection.id, ok: true }))
                    .catch(() => ({ id: connection.id, ok: false }))
            )
        }

        if (deliveries.length === 0) {
            return 0
        }

        const results = await Promise.all(deliveries)
        let successCount = 0
        for (const result of results) {
            if (result.ok) {
                this.resetFailureStrikes(result.id)
                successCount += 1
                continue
            }
            this.recordFailure(result.id)
        }

        return successCount
    }

    broadcast(event: SyncEvent): void {
        for (const connection of this.connections.values()) {
            if (!this.shouldSend(connection, event)) {
                continue
            }

            void Promise.resolve(connection.send(event)).then(() => {
                this.resetFailureStrikes(connection.id)
            }, () => {
                this.recordFailure(connection.id)
            })
        }
    }

    stop(): void {
        this.stopHeartbeat()
        for (const id of this.connections.keys()) {
            this.visibilityTracker.removeConnection(id)
        }
        this.connections.clear()
    }

    getConnectionCount(namespace?: string): number {
        if (!namespace) {
            return this.connections.size
        }

        let count = 0
        for (const connection of this.connections.values()) {
            if (connection.namespace === namespace) {
                count += 1
            }
        }
        return count
    }

    getVisibleConnectionCount(namespace?: string): number {
        return this.visibilityTracker.getVisibleConnectionCount(namespace)
    }

    private ensureHeartbeat(): void {
        if (this.heartbeatTimer || this.heartbeatMs <= 0) {
            return
        }

        this.heartbeatTimer = setInterval(() => {
            for (const connection of this.connections.values()) {
                void Promise.resolve(connection.sendHeartbeat()).then(() => {
                    this.resetFailureStrikes(connection.id)
                }, () => {
                    this.recordFailure(connection.id)
                })
            }
        }, this.heartbeatMs)
    }

    private stopHeartbeat(): void {
        if (!this.heartbeatTimer) {
            return
        }

        clearInterval(this.heartbeatTimer)
        this.heartbeatTimer = null
    }

    private shouldSend(connection: SSEConnection, event: SyncEvent): boolean {
        if (event.type !== 'connection-changed') {
            const eventNamespace = event.namespace
            if (!eventNamespace || eventNamespace !== connection.namespace) {
                return false
            }
        }

        if (event.type === 'connection-changed') {
            return true
        }

        if (connection.all) {
            return true
        }

        if ('sessionId' in event && connection.sessionIds.includes(event.sessionId)) {
            return true
        }

        if ('machineId' in event && connection.machineId === event.machineId) {
            return true
        }

        return false
    }

    private recordFailure(connectionId: string): void {
        const connection = this.connections.get(connectionId)
        if (!connection) {
            return
        }

        connection.failureStrikes += 1
        if (connection.failureStrikes >= this.maxFailureStrikes) {
            this.unsubscribe(connectionId)
        }
    }

    private resetFailureStrikes(connectionId: string): void {
        const connection = this.connections.get(connectionId)
        if (!connection || connection.failureStrikes === 0) {
            return
        }

        connection.failureStrikes = 0
    }
}
