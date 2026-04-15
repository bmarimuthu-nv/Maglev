const OPEN_FILE_SHORTCUT_KEY = 'maglev:openFileShortcut'
const DEFAULT_SHORTCUT = 'Cmd+Shift+P'

export type ParsedShortcut = {
    alt: boolean
    ctrl: boolean
    meta: boolean
    shift: boolean
    key: string
}

function isApplePlatform(): boolean {
    if (typeof navigator === 'undefined') {
        return false
    }
    const platform = (
        (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform
        ?? navigator.platform
        ?? ''
    )
    return /mac|iphone|ipad|ipod/i.test(platform)
}

export function normalizeShortcutLabel(value: string): string {
    const parsed = parseShortcut(value)
    if (!parsed) {
        return DEFAULT_SHORTCUT
    }
    const parts: string[] = []
    if (parsed.meta) {
        parts.push(isApplePlatform() ? 'Cmd' : 'Ctrl')
    } else if (parsed.ctrl) {
        parts.push('Ctrl')
    }
    if (parsed.alt) {
        parts.push(isApplePlatform() ? 'Option' : 'Alt')
    }
    if (parsed.shift) {
        parts.push('Shift')
    }
    parts.push(parsed.key.length === 1 ? parsed.key.toUpperCase() : parsed.key)
    return parts.join('+')
}

export function parseShortcut(value: string): ParsedShortcut | null {
    const trimmed = value.trim()
    if (!trimmed) {
        return null
    }
    const parts = trimmed
        .split('+')
        .map((part) => part.trim())
        .filter(Boolean)
    if (parts.length === 0) {
        return null
    }

    let alt = false
    let ctrl = false
    let meta = false
    let shift = false
    let key = ''

    for (const rawPart of parts) {
        const part = rawPart.toLowerCase()
        if (part === 'cmd' || part === 'command' || part === 'meta' || part === 'mod') {
            if (part === 'mod') {
                if (isApplePlatform()) {
                    meta = true
                } else {
                    ctrl = true
                }
            } else {
                meta = true
            }
            continue
        }
        if (part === 'ctrl' || part === 'control') {
            ctrl = true
            continue
        }
        if (part === 'alt' || part === 'option') {
            alt = true
            continue
        }
        if (part === 'shift') {
            shift = true
            continue
        }
        key = rawPart.length === 1 ? rawPart.toLowerCase() : rawPart
    }

    if (!key) {
        return null
    }

    return { alt, ctrl, meta, shift, key }
}

export function getOpenFileShortcut(): string {
    if (typeof window === 'undefined') {
        return DEFAULT_SHORTCUT
    }
    try {
        const stored = localStorage.getItem(OPEN_FILE_SHORTCUT_KEY)
        return stored ? normalizeShortcutLabel(stored) : normalizeShortcutLabel(DEFAULT_SHORTCUT)
    } catch {
        return normalizeShortcutLabel(DEFAULT_SHORTCUT)
    }
}

export function setOpenFileShortcut(value: string) {
    const normalized = normalizeShortcutLabel(value)
    localStorage.setItem(OPEN_FILE_SHORTCUT_KEY, normalized)
    return normalized
}

export function matchShortcutEvent(event: KeyboardEvent, value: string): boolean {
    const parsed = parseShortcut(value)
    if (!parsed) {
        return false
    }
    const isApple = isApplePlatform()
    const eventKey = event.key.length === 1 ? event.key.toLowerCase() : event.key
    const metaMatched = parsed.meta ? (isApple ? event.metaKey : event.ctrlKey) : false
    const ctrlMatched = parsed.ctrl ? event.ctrlKey : false

    return eventKey === parsed.key
        && event.altKey === parsed.alt
        && event.shiftKey === parsed.shift
        && event.metaKey === (parsed.meta && isApple)
        && event.ctrlKey === (parsed.ctrl || (parsed.meta && !isApple))
        && (parsed.meta ? metaMatched : true)
        && (parsed.ctrl ? ctrlMatched : true)
}

export function eventToShortcutLabel(event: KeyboardEvent): string | null {
    const key = event.key.length === 1 ? event.key.toUpperCase() : event.key
    if (!key || ['Shift', 'Meta', 'Control', 'Alt'].includes(key)) {
        return null
    }
    const parts: string[] = []
    if (event.metaKey) {
        parts.push('Cmd')
    } else if (event.ctrlKey) {
        parts.push('Ctrl')
    }
    if (event.altKey) {
        parts.push(isApplePlatform() ? 'Option' : 'Alt')
    }
    if (event.shiftKey) {
        parts.push('Shift')
    }
    parts.push(key)
    return parts.join('+')
}

export const openFileShortcutStorageKey = OPEN_FILE_SHORTCUT_KEY
