import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppContext } from '@/lib/app-context'

const STORAGE_KEY_PREFIX = 'maglev:recentPaths'
const SAVED_PATHS_KEY_PREFIX = 'maglev:savedPaths'
const MAX_RECENT_PATHS = 5
const MAX_SAVED_PATHS = 20

type RecentPathsData = string[]
type SavedPathsData = string[]

function loadStoredJson(storageKey: string): unknown {
    try {
        const stored = localStorage.getItem(storageKey)
        return stored ? JSON.parse(stored) : null
    } catch {
        return null
    }
}

function loadRecentPaths(storageKey: string): RecentPathsData {
    const parsed = loadStoredJson(storageKey)
    return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === 'string')
        : []
}

function loadSavedPaths(storageKey: string): SavedPathsData {
    const parsed = loadStoredJson(storageKey)
    return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === 'string')
        : []
}

function saveStoredJson(storageKey: string, data: unknown): void {
    try {
        localStorage.setItem(storageKey, JSON.stringify(data))
    } catch {
        // Ignore storage errors
    }
}

export function useRecentPaths() {
    const { scopeKey } = useAppContext()
    const storageKey = `${STORAGE_KEY_PREFIX}:${scopeKey}`
    const savedPathsKey = `${SAVED_PATHS_KEY_PREFIX}:${scopeKey}`
    const [data, setData] = useState<RecentPathsData>(() => loadRecentPaths(storageKey))
    const [savedPaths, setSavedPaths] = useState<SavedPathsData>(() => loadSavedPaths(savedPathsKey))

    useEffect(() => {
        setData(loadRecentPaths(storageKey))
    }, [storageKey])

    useEffect(() => {
        setSavedPaths(loadSavedPaths(savedPathsKey))
    }, [savedPathsKey])

    const getRecentPaths = useCallback((): string[] => {
        return data
    }, [data])

    const addRecentPath = useCallback((path: string): void => {
        const trimmed = path.trim()
        if (!trimmed) return

        setData((prev) => {
            const filtered = prev.filter((item) => item !== trimmed)
            const next = [trimmed, ...filtered].slice(0, MAX_RECENT_PATHS)
            saveStoredJson(storageKey, next)
            return next
        })
    }, [storageKey])

    const addSavedPath = useCallback((path: string): void => {
        const trimmed = path.trim()
        if (!trimmed) return

        setSavedPaths((prev) => {
            const filtered = prev.filter((item) => item !== trimmed)
            const next = [trimmed, ...filtered].slice(0, MAX_SAVED_PATHS)
            saveStoredJson(savedPathsKey, next)
            return next
        })
    }, [savedPathsKey])

    const removeSavedPath = useCallback((path: string): void => {
        setSavedPaths((prev) => {
            const next = prev.filter((item) => item !== path)
            saveStoredJson(savedPathsKey, next)
            return next
        })
    }, [savedPathsKey])

    const isSavedPath = useCallback((path: string): boolean => {
        const trimmed = path.trim()
        if (!trimmed) return false
        return savedPaths.includes(trimmed)
    }, [savedPaths])

    return useMemo(() => ({
        getRecentPaths,
        addRecentPath,
        savedPaths,
        addSavedPath,
        removeSavedPath,
        isSavedPath,
    }), [getRecentPaths, addRecentPath, savedPaths, addSavedPath, removeSavedPath, isSavedPath])
}
