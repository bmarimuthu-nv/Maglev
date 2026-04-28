import {
    getLocalStorageKeys,
    readLocalStorageItem,
    removeLocalStorageItem,
    writeLocalStorageItem,
} from '@/lib/storage-local'

const SESSION_STORAGE_PREFIX = 'maglev:session'
const STICKY_FILE_PREVIEW_KEY = 'sticky-file-preview'
const SESSION_LIST_ORDER_KEY_PREFIX = 'maglev:session-list-order'
const STORAGE_FOUNDATION_MIGRATION_KEY_PREFIX = 'maglev:storage-foundation-v1'

export const LEGACY_SESSION_ORDER_KEY = 'maglev-session-order-v2'
const LEGACY_STICKY_FILE_PREVIEW_KEY_PREFIX = 'maglev:sticky-file-preview'

function encodeStorageSegment(segment: string): string {
    return encodeURIComponent(segment)
}

function decodeStorageSegment(segment: string): string {
    return decodeURIComponent(segment)
}

export function getSessionListOrderStorageKey(scopeKey: string): string {
    return `${SESSION_LIST_ORDER_KEY_PREFIX}:${encodeStorageSegment(scopeKey)}`
}

export function getStickyFilePreviewStorageKey(scopeKey: string, sessionId: string): string {
    return `${SESSION_STORAGE_PREFIX}:${encodeStorageSegment(scopeKey)}:${encodeStorageSegment(sessionId)}:${STICKY_FILE_PREVIEW_KEY}`
}

export function getLegacyStickyFilePreviewStorageKey(baseUrl: string, sessionId: string): string {
    return `${LEGACY_STICKY_FILE_PREVIEW_KEY_PREFIX}:${baseUrl}:${sessionId}`
}

function getStorageFoundationMigrationKey(scopeKey: string): string {
    return `${STORAGE_FOUNDATION_MIGRATION_KEY_PREFIX}:${encodeStorageSegment(scopeKey)}`
}

type ParsedSessionStorageKey = {
    scopeKey: string
    sessionId: string
    slot: string
}

export function parseSessionScopedStorageKey(key: string): ParsedSessionStorageKey | null {
    const parts = key.split(':')
    if (parts.length < 5 || parts[0] !== 'maglev' || parts[1] !== 'session') {
        return null
    }

    const [, , encodedScopeKey, encodedSessionId, ...slotParts] = parts
    if (!encodedScopeKey || !encodedSessionId || slotParts.length === 0) {
        return null
    }

    try {
        return {
            scopeKey: decodeStorageSegment(encodedScopeKey),
            sessionId: decodeStorageSegment(encodedSessionId),
            slot: slotParts.join(':'),
        }
    } catch {
        return null
    }
}

function listScopedSessionStorageKeys(scopeKey: string, sessionId: string): string[] {
    return getLocalStorageKeys().filter((key) => {
        const parsed = parseSessionScopedStorageKey(key)
        return parsed?.scopeKey === scopeKey && parsed.sessionId === sessionId
    })
}

export function cleanupSessionScopedStorage(options: {
    scopeKey: string
    baseUrl?: string
    sessionId: string
}): void {
    for (const key of listScopedSessionStorageKeys(options.scopeKey, options.sessionId)) {
        removeLocalStorageItem(key)
    }

    if (options.baseUrl) {
        removeLocalStorageItem(getLegacyStickyFilePreviewStorageKey(options.baseUrl, options.sessionId))
    }
}

export function migrateStorageFoundation(options: {
    scopeKey: string
    baseUrl: string
    sessionIds: Iterable<string>
}): void {
    const migrationKey = getStorageFoundationMigrationKey(options.scopeKey)
    if (readLocalStorageItem(migrationKey) === '1') {
        return
    }

    const scopedOrderKey = getSessionListOrderStorageKey(options.scopeKey)
    const legacySessionOrder = readLocalStorageItem(LEGACY_SESSION_ORDER_KEY)
    if (legacySessionOrder && readLocalStorageItem(scopedOrderKey) === null) {
        writeLocalStorageItem(scopedOrderKey, legacySessionOrder)
    }

    for (const sessionId of options.sessionIds) {
        const scopedStickyKey = getStickyFilePreviewStorageKey(options.scopeKey, sessionId)
        if (readLocalStorageItem(scopedStickyKey) !== null) {
            continue
        }

        const legacyStickyKey = getLegacyStickyFilePreviewStorageKey(options.baseUrl, sessionId)
        const legacyStickyValue = readLocalStorageItem(legacyStickyKey)
        if (!legacyStickyValue || legacyStickyValue.trim().length === 0) {
            continue
        }

        writeLocalStorageItem(scopedStickyKey, legacyStickyValue)
        removeLocalStorageItem(legacyStickyKey)
    }

    writeLocalStorageItem(migrationKey, '1')
}

export function sweepOrphanedSessionStorage(options: {
    scopeKey: string
    baseUrl: string
    activeSessionIds: Iterable<string>
}): void {
    const activeSessionIds = new Set(options.activeSessionIds)

    for (const key of getLocalStorageKeys()) {
        const parsed = parseSessionScopedStorageKey(key)
        if (parsed?.scopeKey === options.scopeKey && !activeSessionIds.has(parsed.sessionId)) {
            removeLocalStorageItem(key)
            continue
        }

        const legacyPrefix = `${LEGACY_STICKY_FILE_PREVIEW_KEY_PREFIX}:${options.baseUrl}:`
        if (key.startsWith(legacyPrefix)) {
            const sessionId = key.slice(legacyPrefix.length)
            if (!activeSessionIds.has(sessionId)) {
                removeLocalStorageItem(key)
            }
        }
    }
}
