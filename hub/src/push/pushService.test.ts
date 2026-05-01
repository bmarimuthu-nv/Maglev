import { afterEach, describe, expect, it, mock } from 'bun:test'

import { PushService, type PushPayload } from './pushService'
import type { Store, StoredPushSubscription } from '../store'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function createPayload(): PushPayload {
    return {
        title: 'Permission Request',
        body: 'session-1 (Edit)',
        data: {
            type: 'permission-request',
            sessionId: 'session-1',
            url: '/sessions/session-1'
        }
    }
}

function createSubscription(endpoint: string): StoredPushSubscription {
    return {
        id: 1,
        namespace: 'default',
        endpoint,
        p256dh: `p256dh-${endpoint}`,
        auth: `auth-${endpoint}`,
        createdAt: 1
    }
}

function createStore(subscriptions: StoredPushSubscription[]): Store {
    const items = [...subscriptions]
    return {
        push: {
            getPushSubscriptionsByNamespace(namespace: string) {
                return items.filter((subscription) => subscription.namespace === namespace)
            },
            removePushSubscription(namespace: string, endpoint: string) {
                const index = items.findIndex((subscription) => {
                    return subscription.namespace === namespace && subscription.endpoint === endpoint
                })
                if (index >= 0) {
                    items.splice(index, 1)
                }
            }
        }
    } as unknown as Store
}

function createService(
    subscriptions: StoredPushSubscription[],
    options: ConstructorParameters<typeof PushService>[3]
): PushService {
    return new PushService(
        { publicKey: 'public', privateKey: 'private' },
        'mailto:test@example.com',
        createStore(subscriptions),
        {
            configureVapidDetails() {
            },
            ...options
        }
    )
}

describe('PushService', () => {
    afterEach(() => {
        mock.restore()
    })

    it('retries transient push failures with backoff until success', async () => {
        const sendCalls: string[] = []
        let attempt = 0
        const service = createService([createSubscription('endpoint-1')], {
            retryDelaysMs: [5, 10],
            sendNotification: async (subscription) => {
                sendCalls.push(subscription.endpoint)
                attempt += 1
                if (attempt < 3) {
                    throw { statusCode: 503 }
                }
            }
        })

        await service.sendToNamespace('default', createPayload())
        expect(service.getQueuedRetryCount()).toBe(1)

        await sleep(35)

        expect(sendCalls).toEqual(['endpoint-1', 'endpoint-1', 'endpoint-1'])
        expect(service.getQueuedRetryCount()).toBe(0)
    })

    it('removes gone subscriptions and clears queued retries', async () => {
        let attempt = 0
        const service = createService([createSubscription('endpoint-1')], {
            retryDelaysMs: [5, 10],
            sendNotification: async () => {
                attempt += 1
                if (attempt === 1) {
                    throw { statusCode: 503 }
                }
                throw { statusCode: 410 }
            }
        })

        await service.sendToNamespace('default', createPayload())
        await sleep(15)

        expect(service.getQueuedRetryCount()).toBe(0)
        await service.sendToNamespace('default', createPayload())
        expect(service.getQueuedRetryCount()).toBe(0)
    })

    it('drops the oldest queued retry when the queue is full', async () => {
        const sendCalls: string[] = []
        const warnings: string[] = []
        const service = createService([
            createSubscription('endpoint-1'),
            createSubscription('endpoint-2'),
            createSubscription('endpoint-3')
        ], {
            retryDelaysMs: [5],
            maxQueuedRetries: 2,
            logger: {
                error() {
                },
                warn(message: string) {
                    warnings.push(message)
                }
            },
            sendNotification: async (subscription) => {
                sendCalls.push(subscription.endpoint)
                throw { statusCode: 503 }
            }
        })

        await service.sendToNamespace('default', createPayload())

        expect(service.getQueuedRetryCount()).toBe(2)
        expect(warnings).toHaveLength(1)

        await sleep(20)

        expect(sendCalls).toEqual([
            'endpoint-1',
            'endpoint-2',
            'endpoint-3',
            'endpoint-2',
            'endpoint-3'
        ])
        expect(service.getQueuedRetryCount()).toBe(0)
    })
})
