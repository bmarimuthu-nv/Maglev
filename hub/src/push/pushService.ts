import * as webPush from 'web-push'
import type { Store } from '../store'
import type { VapidKeys } from '../config/vapidKeys'

export type PushPayload = {
    title: string
    body: string
    tag?: string
    data?: {
        type: string
        sessionId: string
        url: string
    }
}

type StoredSubscription = {
    endpoint: string
    p256dh: string
    auth: string
}

type PushSubscription = {
    endpoint: string
    keys: {
        p256dh: string
        auth: string
    }
}

type PushSendNotification = (
    subscription: PushSubscription,
    body: string
) => Promise<unknown>

type ConfigureVapidDetails = (
    subject: string,
    publicKey: string,
    privateKey: string
) => void

type PushLogger = Pick<Console, 'error' | 'warn'>

type QueuedPushRetry = {
    key: string
    namespace: string
    endpoint: string
    body: string
    retryCount: number
    timer: ReturnType<typeof setTimeout>
}

export type PushServiceOptions = {
    retryDelaysMs?: number[]
    maxQueuedRetries?: number
    sendNotification?: PushSendNotification
    configureVapidDetails?: ConfigureVapidDetails
    logger?: PushLogger
}

export class PushService {
    private readonly retryDelaysMs: number[]
    private readonly maxQueuedRetries: number
    private readonly sendNotification: PushSendNotification
    private readonly configureVapidDetails: ConfigureVapidDetails
    private readonly logger: PushLogger
    private readonly queuedRetries: Map<string, QueuedPushRetry> = new Map()
    private readonly retryOrder: string[] = []

    constructor(
        private readonly vapidKeys: VapidKeys,
        private readonly subject: string,
        private readonly store: Store,
        options?: PushServiceOptions
    ) {
        this.retryDelaysMs = options?.retryDelaysMs ?? [1_000, 5_000, 15_000]
        this.maxQueuedRetries = Math.max(1, options?.maxQueuedRetries ?? 128)
        this.sendNotification = options?.sendNotification ?? ((subscription, body) => {
            return webPush.sendNotification(subscription, body)
        })
        this.configureVapidDetails = options?.configureVapidDetails ?? ((subject, publicKey, privateKey) => {
            webPush.setVapidDetails(subject, publicKey, privateKey)
        })
        this.logger = options?.logger ?? console
        this.configureVapidDetails(this.subject, this.vapidKeys.publicKey, this.vapidKeys.privateKey)
    }

    async sendToNamespace(namespace: string, payload: PushPayload): Promise<void> {
        const subscriptions = this.store.push.getPushSubscriptionsByNamespace(namespace)
        if (subscriptions.length === 0) {
            return
        }

        const body = JSON.stringify(payload)
        await Promise.all(subscriptions.map((subscription) => {
            return this.sendToSubscription(namespace, subscription, body, 0)
        }))
    }

    getQueuedRetryCount(): number {
        return this.queuedRetries.size
    }

    private async sendToSubscription(
        namespace: string,
        subscription: StoredSubscription,
        body: string,
        retryCount: number
    ): Promise<void> {
        const pushSubscription: PushSubscription = {
            endpoint: subscription.endpoint,
            keys: {
                p256dh: subscription.p256dh,
                auth: subscription.auth
            }
        }

        try {
            await this.sendNotification(pushSubscription, body)
        } catch (error) {
            const statusCode = getPushErrorStatusCode(error)

            if (isGonePushStatusCode(statusCode)) {
                this.removeSubscriptionAndQueuedRetries(namespace, subscription.endpoint)
                return
            }

            if (isTransientPushStatusCode(statusCode) && retryCount < this.retryDelaysMs.length) {
                this.queueRetry(namespace, subscription.endpoint, body, retryCount + 1)
                return
            }

            this.logger.error('[PushService] Failed to send notification:', error)
        }
    }

    private queueRetry(
        namespace: string,
        endpoint: string,
        body: string,
        retryCount: number
    ): void {
        const key = buildRetryKey(namespace, endpoint, body)
        if (this.queuedRetries.has(key)) {
            return
        }

        this.trimRetryQueueIfNeeded()

        const delayMs = this.retryDelaysMs[retryCount - 1] ?? this.retryDelaysMs[this.retryDelaysMs.length - 1]
        const timer = setTimeout(() => {
            void this.runQueuedRetry(key)
        }, delayMs)
        timer.unref?.()

        this.queuedRetries.set(key, {
            key,
            namespace,
            endpoint,
            body,
            retryCount,
            timer
        })
        this.retryOrder.push(key)
    }

    private async runQueuedRetry(key: string): Promise<void> {
        const retry = this.dequeueRetry(key)
        if (!retry) {
            return
        }

        const subscription = this.store.push.getPushSubscriptionsByNamespace(retry.namespace)
            .find((entry) => entry.endpoint === retry.endpoint)
        if (!subscription) {
            return
        }

        await this.sendToSubscription(retry.namespace, subscription, retry.body, retry.retryCount)
    }

    private trimRetryQueueIfNeeded(): void {
        while (this.queuedRetries.size >= this.maxQueuedRetries) {
            const oldestKey = this.retryOrder.shift()
            if (!oldestKey) {
                return
            }
            const oldestRetry = this.queuedRetries.get(oldestKey)
            if (!oldestRetry) {
                continue
            }
            clearTimeout(oldestRetry.timer)
            this.queuedRetries.delete(oldestKey)
            this.logger.warn(`[PushService] Dropped queued retry for ${oldestRetry.endpoint} because the retry queue is full.`)
            return
        }
    }

    private removeSubscriptionAndQueuedRetries(namespace: string, endpoint: string): void {
        this.store.push.removePushSubscription(namespace, endpoint)
        for (const retryKey of [...this.retryOrder]) {
            const retry = this.queuedRetries.get(retryKey)
            if (!retry || retry.namespace !== namespace || retry.endpoint !== endpoint) {
                continue
            }
            this.dequeueRetry(retryKey)
        }
    }

    private dequeueRetry(key: string): QueuedPushRetry | null {
        const retry = this.queuedRetries.get(key)
        if (!retry) {
            return null
        }
        clearTimeout(retry.timer)
        this.queuedRetries.delete(key)
        const orderIndex = this.retryOrder.indexOf(key)
        if (orderIndex >= 0) {
            this.retryOrder.splice(orderIndex, 1)
        }
        return retry
    }
}

function buildRetryKey(namespace: string, endpoint: string, body: string): string {
    return `${namespace}\n${endpoint}\n${body}`
}

function getPushErrorStatusCode(error: unknown): number | null {
    return typeof (error as { statusCode?: unknown }).statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : null
}

function isGonePushStatusCode(statusCode: number | null): boolean {
    return statusCode === 404 || statusCode === 410
}

function isTransientPushStatusCode(statusCode: number | null): boolean {
    if (statusCode == null) {
        return true
    }
    return statusCode === 408
        || statusCode === 425
        || statusCode === 429
        || statusCode === 500
        || statusCode === 502
        || statusCode === 503
        || statusCode === 504
}
