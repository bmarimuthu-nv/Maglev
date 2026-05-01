import type { Database } from 'bun:sqlite'

import { durableWrite } from './durableWrite'
import type { StoredPushSubscription } from './types'
import { addPushSubscription, getPushSubscriptionsByNamespace, removePushSubscription } from './pushSubscriptions'

export class PushStore {
    private readonly db: Database

    constructor(db: Database) {
        this.db = db
    }

    addPushSubscription(namespace: string, subscription: { endpoint: string; p256dh: string; auth: string }): void {
        durableWrite(this.db, () => addPushSubscription(this.db, namespace, subscription))
    }

    removePushSubscription(namespace: string, endpoint: string): void {
        durableWrite(this.db, () => removePushSubscription(this.db, namespace, endpoint))
    }

    getPushSubscriptionsByNamespace(namespace: string): StoredPushSubscription[] {
        return getPushSubscriptionsByNamespace(this.db, namespace)
    }
}
