import { useCallback, useEffect, useState } from 'react'

export type ReviewAppearancePreference = 'system' | 'dark' | 'light'

const STORAGE_KEY = 'maglev-review-appearance'

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

function safeRemoveItem(key: string): void {
    if (!isBrowser()) return
    try {
        localStorage.removeItem(key)
    } catch {
        // ignore
    }
}

function isReviewAppearance(value: string | null): value is ReviewAppearancePreference {
    return value === 'system' || value === 'dark' || value === 'light'
}

function getInitialValue(): ReviewAppearancePreference {
    const raw = safeGetItem(STORAGE_KEY)
    return isReviewAppearance(raw) ? raw : 'system'
}

export function getReviewAppearanceOptions(): Array<{
    value: ReviewAppearancePreference
    label: string
    description: string
}> {
    return [
        {
            value: 'system',
            label: 'App default',
            description: 'Follow the main Maglev light/dark appearance'
        },
        {
            value: 'dark',
            label: 'Dark',
            description: 'Always use dark review surfaces'
        },
        {
            value: 'light',
            label: 'Light',
            description: 'Always use light review surfaces'
        }
    ]
}

export function useReviewAppearance(): {
    reviewAppearance: ReviewAppearancePreference
    setReviewAppearance: (mode: ReviewAppearancePreference) => void
} {
    const [reviewAppearance, setReviewAppearanceState] = useState<ReviewAppearancePreference>(getInitialValue)

    useEffect(() => {
        if (!isBrowser()) return

        const onStorage = (event: StorageEvent) => {
            if (event.key !== STORAGE_KEY) return
            if (isReviewAppearance(event.newValue)) {
                setReviewAppearanceState(event.newValue)
                return
            }
            if (event.newValue === null) {
                setReviewAppearanceState('system')
            }
        }

        window.addEventListener('storage', onStorage)
        return () => window.removeEventListener('storage', onStorage)
    }, [])

    const setReviewAppearance = useCallback((mode: ReviewAppearancePreference) => {
        setReviewAppearanceState(mode)
        if (mode === 'system') {
            safeRemoveItem(STORAGE_KEY)
        } else {
            safeSetItem(STORAGE_KEY, mode)
        }
    }, [])

    return { reviewAppearance, setReviewAppearance }
}
