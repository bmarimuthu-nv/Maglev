import type { Database } from 'bun:sqlite'

import { durableWrite } from './durableWrite'
import type { StoredUser } from './types'
import { addUser, getUser, getUsersByPlatform, getUsersByPlatformAndNamespace, removeUser } from './users'

export class UserStore {
    private readonly db: Database

    constructor(db: Database) {
        this.db = db
    }

    getUser(platform: string, platformUserId: string): StoredUser | null {
        return getUser(this.db, platform, platformUserId)
    }

    getUsersByPlatform(platform: string): StoredUser[] {
        return getUsersByPlatform(this.db, platform)
    }

    getUsersByPlatformAndNamespace(platform: string, namespace: string): StoredUser[] {
        return getUsersByPlatformAndNamespace(this.db, platform, namespace)
    }

    addUser(platform: string, platformUserId: string, namespace: string): StoredUser {
        return durableWrite(this.db, () => addUser(this.db, platform, platformUserId, namespace))
    }

    removeUser(platform: string, platformUserId: string): boolean {
        return durableWrite(this.db, () => removeUser(this.db, platform, platformUserId))
    }
}
