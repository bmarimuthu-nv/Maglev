import type { HubIdentityResponse } from '@/types/api'
import {
    getLocalStorageKeys,
    readLocalStorageItem,
    removeLocalStorageItem,
    writeLocalStorageItem,
} from '@/lib/storage-local'

const DEFAULT_NAMESPACE = 'default'
const ACCESS_TOKEN_PREFIX = 'maglev_access_token::'
const JWT_TOKEN_PREFIX = 'maglev_jwt_token::'
const ACCESS_TOKEN_BY_HUB_PREFIX = 'maglev_access_token_by_hub::'
const JWT_TOKEN_BY_HUB_PREFIX = 'maglev_jwt_token_by_hub::'

function encodeStorageSegment(segment: string): string {
    return encodeURIComponent(segment)
}

function decodeBase64UrlJson(value: string): unknown {
    const base64 = value
        .replace(/-/g, '+')
        .replace(/_/g, '/')
        .padEnd(Math.ceil(value.length / 4) * 4, '=')
    return JSON.parse(globalThis.atob(base64))
}

function decodeJwtPayload(token: string): { ns?: unknown; exp?: unknown } | null {
    const parts = token.split('.')
    if (parts.length < 2 || !parts[1]) {
        return null
    }

    try {
        const payload = decodeBase64UrlJson(parts[1])
        return payload && typeof payload === 'object'
            ? payload as { ns?: unknown; exp?: unknown }
            : null
    } catch {
        return null
    }
}

export function decodeJwtNamespace(token: string): string | null {
    const payload = decodeJwtPayload(token)
    return typeof payload?.ns === 'string' ? payload.ns : null
}

export function decodeJwtExpMs(token: string): number | null {
    const payload = decodeJwtPayload(token)
    return typeof payload?.exp === 'number' ? payload.exp * 1000 : null
}

function isUsableJwt(token: string): boolean {
    const expMs = decodeJwtExpMs(token)
    return expMs === null || expMs > Date.now()
}

function getUrlAccessTokenKey(baseUrl: string): string {
    return `${ACCESS_TOKEN_PREFIX}${baseUrl}`
}

function getUrlJwtTokenKey(baseUrl: string): string {
    return `${JWT_TOKEN_PREFIX}${baseUrl}`
}

function getHubAccessTokenKey(identityKey: string): string {
    return `${ACCESS_TOKEN_BY_HUB_PREFIX}${encodeStorageSegment(identityKey)}`
}

function getHubJwtTokenKey(identityKey: string): string {
    return `${JWT_TOKEN_BY_HUB_PREFIX}${encodeStorageSegment(identityKey)}`
}

function parseAccessTokenNamespace(token: string): string | null {
    const trimmed = token.trim()
    if (!trimmed) {
        return null
    }

    const separatorIndex = trimmed.lastIndexOf(':')
    if (separatorIndex === -1) {
        return DEFAULT_NAMESPACE
    }

    const namespace = trimmed.slice(separatorIndex + 1)
    return namespace.trim() === namespace && namespace.length > 0 ? namespace : null
}

function findStoredJwtForIdentity(identity: HubIdentityResponse): string | null {
    for (const key of getLocalStorageKeys()) {
        if (!key.startsWith(JWT_TOKEN_PREFIX) && !key.startsWith(JWT_TOKEN_BY_HUB_PREFIX)) {
            continue
        }

        const token = readLocalStorageItem(key)
        if (!token || !isUsableJwt(token)) {
            continue
        }

        if (decodeJwtNamespace(token) === identity.namespace) {
            return token
        }
    }

    return null
}

function findStoredAccessTokenForIdentity(identity: HubIdentityResponse): string | null {
    for (const key of getLocalStorageKeys()) {
        if (!key.startsWith(ACCESS_TOKEN_PREFIX) && !key.startsWith(ACCESS_TOKEN_BY_HUB_PREFIX)) {
            continue
        }

        const token = readLocalStorageItem(key)
        if (!token) {
            continue
        }

        if (parseAccessTokenNamespace(token) === identity.namespace) {
            return token
        }
    }

    return null
}

export function readStoredJwtToken(baseUrl: string, identity: HubIdentityResponse | null): string | null {
    const identityToken = identity ? readLocalStorageItem(getHubJwtTokenKey(identity.identityKey)) : null
    if (identityToken && isUsableJwt(identityToken)) {
        return identityToken
    }

    const urlToken = readLocalStorageItem(getUrlJwtTokenKey(baseUrl))
    if (urlToken && isUsableJwt(urlToken)) {
        if (identity && decodeJwtNamespace(urlToken) === identity.namespace) {
            writeLocalStorageItem(getHubJwtTokenKey(identity.identityKey), urlToken)
        }
        return urlToken
    }

    if (!identity) {
        return null
    }

    const matchingToken = findStoredJwtForIdentity(identity)
    if (matchingToken) {
        writeLocalStorageItem(getHubJwtTokenKey(identity.identityKey), matchingToken)
    }
    return matchingToken
}

export function readStoredAccessToken(baseUrl: string, identity: HubIdentityResponse | null): string | null {
    const identityToken = identity ? readLocalStorageItem(getHubAccessTokenKey(identity.identityKey)) : null
    if (identityToken) {
        return identityToken
    }

    const urlToken = readLocalStorageItem(getUrlAccessTokenKey(baseUrl))
    if (urlToken) {
        if (identity && parseAccessTokenNamespace(urlToken) === identity.namespace) {
            writeLocalStorageItem(getHubAccessTokenKey(identity.identityKey), urlToken)
        }
        return urlToken
    }

    if (!identity) {
        return null
    }

    const matchingToken = findStoredAccessTokenForIdentity(identity)
    if (matchingToken) {
        writeLocalStorageItem(getHubAccessTokenKey(identity.identityKey), matchingToken)
    }
    return matchingToken
}

export function storeAccessToken(baseUrl: string, identity: HubIdentityResponse | null, token: string): void {
    writeLocalStorageItem(getUrlAccessTokenKey(baseUrl), token)
    if (identity) {
        writeLocalStorageItem(getHubAccessTokenKey(identity.identityKey), token)
    }
}

export function storeJwtToken(baseUrl: string, identity: HubIdentityResponse | null, token: string): void {
    writeLocalStorageItem(getUrlJwtTokenKey(baseUrl), token)
    if (identity) {
        writeLocalStorageItem(getHubJwtTokenKey(identity.identityKey), token)
    }
}

export function clearStoredAccessToken(baseUrl: string, identity: HubIdentityResponse | null): void {
    removeLocalStorageItem(getUrlAccessTokenKey(baseUrl))
    if (identity) {
        removeLocalStorageItem(getHubAccessTokenKey(identity.identityKey))
    }
}

export function clearStoredJwtToken(baseUrl: string, identity: HubIdentityResponse | null): void {
    removeLocalStorageItem(getUrlJwtTokenKey(baseUrl))
    if (identity) {
        removeLocalStorageItem(getHubJwtTokenKey(identity.identityKey))
    }
}

export function getHubScopedJwtStorageKey(identityKey: string): string {
    return getHubJwtTokenKey(identityKey)
}
