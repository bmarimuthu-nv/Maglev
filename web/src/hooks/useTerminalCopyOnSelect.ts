import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'maglev-terminal-copy-on-select'

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
    return safeGetItem(STORAGE_KEY) === 'true'
}

export function useTerminalCopyOnSelect(): { copyOnSelect: boolean; setCopyOnSelect: (enabled: boolean) => void } {
    const [copyOnSelect, setCopyOnSelectState] = useState<boolean>(getInitialValue)

    useEffect(() => {
        if (!isBrowser()) return

        const onStorage = (event: StorageEvent) => {
            if (event.key !== STORAGE_KEY) return
            setCopyOnSelectState(event.newValue === 'true')
        }

        window.addEventListener('storage', onStorage)
        return () => window.removeEventListener('storage', onStorage)
    }, [])

    const setCopyOnSelect = useCallback((enabled: boolean) => {
        setCopyOnSelectState(enabled)
        safeSetItem(STORAGE_KEY, String(enabled))
    }, [])

    return { copyOnSelect, setCopyOnSelect }
}
