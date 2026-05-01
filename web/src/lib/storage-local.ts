export function readLocalStorageItem(key: string): string | null {
    if (typeof window === 'undefined') {
        return null
    }

    try {
        return window.localStorage.getItem(key)
    } catch {
        return null
    }
}

export function writeLocalStorageItem(key: string, value: string): void {
    if (typeof window === 'undefined') {
        return
    }

    try {
        window.localStorage.setItem(key, value)
    } catch {
        // Ignore storage errors
    }
}

export function removeLocalStorageItem(key: string): void {
    if (typeof window === 'undefined') {
        return
    }

    try {
        window.localStorage.removeItem(key)
    } catch {
        // Ignore storage errors
    }
}

export function getLocalStorageKeys(): string[] {
    if (typeof window === 'undefined') {
        return []
    }

    try {
        return Object.keys(window.localStorage)
    } catch {
        return []
    }
}

export function readLocalStorageJson<T>(key: string): T | null {
    const raw = readLocalStorageItem(key)
    if (!raw) {
        return null
    }

    try {
        return JSON.parse(raw) as T
    } catch {
        return null
    }
}

export function writeLocalStorageJson(key: string, value: unknown): void {
    writeLocalStorageItem(key, JSON.stringify(value))
}

export function readLocalStorageNumber(key: string): number | null {
    const raw = readLocalStorageItem(key)
    if (!raw) {
        return null
    }

    const parsed = Number.parseInt(raw, 10)
    return Number.isFinite(parsed) ? parsed : null
}
