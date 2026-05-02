import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getTelegramWebApp, isTelegramEnvironment } from './useTelegram'
import type { AuthSource } from './useAuth'
import type { HubIdentityResponse } from '@/types/api'
import {
    clearStoredAccessToken,
    clearStoredJwtToken,
    readStoredAccessToken,
    readStoredJwtToken,
    storeAccessToken,
    storeJwtToken,
} from '@/lib/auth-storage'

function getTelegramInitData(): string | null {
    const tg = getTelegramWebApp()
    if (tg?.initData) {
        return tg.initData
    }

    // Fallback: check URL parameters (for testing or alternative flows)
    const query = new URLSearchParams(window.location.search)
    const tgWebAppData = query.get('tgWebAppData')
    if (tgWebAppData) {
        return tgWebAppData
    }

    const initData = query.get('initData')
    return initData || null
}

function getTokenFromUrlParams(): string | null {
    if (typeof window === 'undefined') return null
    const query = new URLSearchParams(window.location.search)
    return query.get('token')
}

function isBrokerHostedPath(): boolean {
    if (typeof window === 'undefined') return false
    return /^\/h\/[^/]+(?:\/|$)/.test(window.location.pathname)
}

export function useAuthSource(baseUrl: string, hubIdentity: HubIdentityResponse | null): {
    authSource: AuthSource | null
    isLoading: boolean
    isTelegram: boolean
    setAccessToken: (token: string) => void
    setJwtToken: (token: string) => void
    persistJwtToken: (token: string) => void
    clearJwtToken: () => void
    clearAuth: () => void
} {
    const [authSource, setAuthSource] = useState<AuthSource | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [isTelegram, setIsTelegram] = useState(false)
    const retryCountRef = useRef(0)
    const identityKey = useMemo(() => hubIdentity?.identityKey ?? null, [hubIdentity])

    // Initialize auth source on mount, with retry for delayed Telegram initData
    useEffect(() => {
        retryCountRef.current = 0
        setAuthSource(null)
        setIsTelegram(false)
        setIsLoading(true)

        const telegramInitData = getTelegramInitData()

        if (telegramInitData) {
            // Telegram Mini App environment
            setAuthSource({ type: 'telegram', initData: telegramInitData })
            setIsTelegram(true)
            setIsLoading(false)
            return
        }

        // Check for URL token parameter (for direct access links)
        const urlToken = getTokenFromUrlParams()
        if (urlToken) {
            storeAccessToken(baseUrl, hubIdentity, urlToken) // Save to localStorage for refresh
            setAuthSource({ type: 'accessToken', token: urlToken })
            setIsLoading(false)
            return
        }

        const storedJwtToken = readStoredJwtToken(baseUrl, hubIdentity)

        if (isBrokerHostedPath()) {
            clearStoredAccessToken(baseUrl, hubIdentity)
            setAuthSource({ type: 'broker', bootstrapToken: storedJwtToken ?? undefined })
            setIsLoading(false)
            return
        }

        // Check for stored access token as fallback
        if (storedJwtToken) {
            setAuthSource({ type: 'jwt', token: storedJwtToken })
            setIsLoading(false)
            return
        }

        const storedToken = readStoredAccessToken(baseUrl, hubIdentity)
        if (storedToken) {
            setAuthSource({ type: 'accessToken', token: storedToken })
            setIsLoading(false)
            return
        }

        // Check if we're in a Telegram environment before polling
        if (!isTelegramEnvironment()) {
            // Plain browser - show login prompt immediately
            setIsLoading(false)
            return
        }

        // Telegram environment detected - poll for delayed initData
        // Telegram WebApp SDK may initialize slightly after page mount
        const maxRetries = 20
        const retryInterval = 250 // ms

        const interval = setInterval(() => {
            retryCountRef.current += 1
            const initData = getTelegramInitData()

            if (initData) {
                setAuthSource({ type: 'telegram', initData })
                setIsTelegram(true)
                setIsLoading(false)
                clearInterval(interval)
            } else if (retryCountRef.current >= maxRetries) {
                // Give up - show login prompt for browser access
                setIsLoading(false)
                clearInterval(interval)
            }
        }, retryInterval)

        return () => {
            clearInterval(interval)
        }
    }, [baseUrl, hubIdentity, identityKey])

    const setAccessToken = useCallback((token: string) => {
        clearStoredJwtToken(baseUrl, hubIdentity)
        storeAccessToken(baseUrl, hubIdentity, token)
        setAuthSource({ type: 'accessToken', token })
    }, [baseUrl, hubIdentity])

    const setJwtToken = useCallback((token: string) => {
        clearStoredAccessToken(baseUrl, hubIdentity)
        storeJwtToken(baseUrl, hubIdentity, token)
        setAuthSource({ type: 'jwt', token })
    }, [baseUrl, hubIdentity])

    const persistJwtToken = useCallback((token: string) => {
        storeJwtToken(baseUrl, hubIdentity, token)
    }, [baseUrl, hubIdentity])

    const clearJwtToken = useCallback(() => {
        clearStoredJwtToken(baseUrl, hubIdentity)
    }, [baseUrl, hubIdentity])

    const clearAuth = useCallback(() => {
        clearStoredAccessToken(baseUrl, hubIdentity)
        clearStoredJwtToken(baseUrl, hubIdentity)
        setAuthSource(null)
    }, [baseUrl, hubIdentity])

    return {
        authSource,
        isLoading,
        isTelegram,
        setAccessToken,
        setJwtToken,
        persistJwtToken,
        clearJwtToken,
        clearAuth
    }
}
