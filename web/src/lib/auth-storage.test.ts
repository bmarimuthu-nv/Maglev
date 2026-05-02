import { beforeEach, describe, expect, it } from 'vitest'
import type { HubIdentityResponse } from '@/types/api'
import {
    getHubScopedJwtStorageKey,
    readStoredJwtToken,
    storeJwtToken,
} from './auth-storage'

function base64UrlEncode(value: unknown): string {
    return btoa(JSON.stringify(value))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '')
}

function makeJwt(payload: Record<string, unknown>): string {
    return `${base64UrlEncode({ alg: 'HS256' })}.${base64UrlEncode(payload)}.signature`
}

function createIdentity(overrides?: Partial<HubIdentityResponse>): HubIdentityResponse {
    return {
        name: 'work-hub',
        namespace: 'hub-work-hub',
        machineId: 'machine-1',
        identityKey: 'hub:hub-work-hub:machine:machine-1',
        ...overrides
    }
}

describe('auth storage', () => {
    beforeEach(() => {
        window.localStorage.clear()
    })

    it('stores jwt tokens under both URL and hub identity keys', () => {
        const identity = createIdentity()
        const token = makeJwt({ ns: identity.namespace, exp: 4_102_444_800 })

        storeJwtToken('https://old.example/h/work-hub', identity, token)

        expect(window.localStorage.getItem('maglev_jwt_token::https://old.example/h/work-hub')).toBe(token)
        expect(window.localStorage.getItem(getHubScopedJwtStorageKey(identity.identityKey))).toBe(token)
    })

    it('recovers a same-namespace jwt after the server URL changes', () => {
        const identity = createIdentity()
        const token = makeJwt({ ns: identity.namespace, exp: 4_102_444_800 })
        window.localStorage.setItem('maglev_jwt_token::https://old.example/h/work-hub', token)

        expect(readStoredJwtToken('https://new.example/h/work-hub', identity)).toBe(token)
        expect(window.localStorage.getItem(getHubScopedJwtStorageKey(identity.identityKey))).toBe(token)
    })

    it('does not recover a jwt from a different namespace', () => {
        const identity = createIdentity()
        const token = makeJwt({ ns: 'hub-other', exp: 4_102_444_800 })
        window.localStorage.setItem('maglev_jwt_token::https://old.example/h/other', token)

        expect(readStoredJwtToken('https://new.example/h/work-hub', identity)).toBeNull()
    })
})
