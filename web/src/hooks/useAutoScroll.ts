import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'maglev-auto-scroll'

function isBrowser(): boolean {
    return typeof window !== 'undefined' && typeof document !== 'undefined'
}

function safeGetItem(key: string): string | null {
    if (!isBrowser()) return null
    try {
        return localStorage.getItem(key)
    } catch {
        return null
    }
}

function safeSetItem(key: string, value: string): void {
    if (!isBrowser()) return
    try {
        localStorage.setItem(key, value)
    } catch {
        // ignore
    }
}

function getInitialValue(): boolean {
    const raw = safeGetItem(STORAGE_KEY)
    // Enabled by default (opt-out). Only disable if explicitly set to 'false'.
    return raw !== 'false'
}

export function useAutoScroll(): { autoScroll: boolean; setAutoScroll: (enabled: boolean) => void } {
    const [autoScroll, setAutoScrollState] = useState<boolean>(getInitialValue)

    useEffect(() => {
        if (!isBrowser()) return

        const onStorage = (event: StorageEvent) => {
            if (event.key !== STORAGE_KEY) return
            setAutoScrollState(event.newValue !== 'false')
        }

        window.addEventListener('storage', onStorage)
        return () => window.removeEventListener('storage', onStorage)
    }, [])

    const setAutoScroll = useCallback((enabled: boolean) => {
        setAutoScrollState(enabled)
        safeSetItem(STORAGE_KEY, String(enabled))
    }, [])

    return { autoScroll, setAutoScroll }
}
