import { useCallback, useEffect, useState } from 'react'

export type ReviewBaseMode = 'origin' | 'upstream' | 'fork-point'

const STORAGE_KEY = 'maglev-review-base-mode'

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

function isReviewBaseMode(value: string | null): value is ReviewBaseMode {
    return value === 'origin' || value === 'upstream' || value === 'fork-point'
}

function getInitialValue(): ReviewBaseMode {
    const raw = safeGetItem(STORAGE_KEY)
    return isReviewBaseMode(raw) ? raw : 'origin'
}

export function getReviewBaseModeOptions(): Array<{ value: ReviewBaseMode; label: string; description: string }> {
    return [
        {
            value: 'origin',
            label: 'Origin default branch',
            description: 'Compare against origin/HEAD, origin/main, or origin/master'
        },
        {
            value: 'upstream',
            label: 'Upstream default branch',
            description: 'Compare against upstream/HEAD, upstream/main, or upstream/master'
        },
        {
            value: 'fork-point',
            label: 'Branch fork point',
            description: 'Compare from the branch base/fork-point commit against upstream default branch first, then origin'
        }
    ]
}

export function useReviewBaseMode(): { reviewBaseMode: ReviewBaseMode; setReviewBaseMode: (mode: ReviewBaseMode) => void } {
    const [reviewBaseMode, setReviewBaseModeState] = useState<ReviewBaseMode>(getInitialValue)

    useEffect(() => {
        if (!isBrowser()) return

        const onStorage = (event: StorageEvent) => {
            if (event.key !== STORAGE_KEY) return
            if (isReviewBaseMode(event.newValue)) {
                setReviewBaseModeState(event.newValue)
            }
        }

        window.addEventListener('storage', onStorage)
        return () => window.removeEventListener('storage', onStorage)
    }, [])

    const setReviewBaseMode = useCallback((mode: ReviewBaseMode) => {
        setReviewBaseModeState(mode)
        safeSetItem(STORAGE_KEY, mode)
    }, [])

    return { reviewBaseMode, setReviewBaseMode }
}
