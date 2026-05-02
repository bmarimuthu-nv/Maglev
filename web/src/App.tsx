import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Outlet, useLocation, useRouter } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { getTelegramWebApp, isTelegramApp } from '@/hooks/useTelegram'
import { initializeTheme } from '@/hooks/useTheme'
import { useAuth } from '@/hooks/useAuth'
import { useAuthSource } from '@/hooks/useAuthSource'
import { useServerUrl } from '@/hooks/useServerUrl'
import { useSSE } from '@/hooks/useSSE'
import { useSyncingState } from '@/hooks/useSyncingState'
import { usePushNotifications } from '@/hooks/usePushNotifications'
import { useHubIdentity } from '@/hooks/queries/useHubIdentity'
import { useSessions } from '@/hooks/queries/useSessions'
import { useVisibilityReporter } from '@/hooks/useVisibilityReporter'
import { queryKeys } from '@/lib/query-keys'
import { AppContextProvider } from '@/lib/app-context'
import { readLocalStorageItem, writeLocalStorageItem } from '@/lib/storage-local'
import { useAppGoBack } from '@/hooks/useAppGoBack'
import { useTranslation } from '@/lib/use-translation'
import { requireHubUrlForLogin } from '@/lib/runtime-config'
import { getCurrentHubLabel } from '@/utils/url'
import { LoginPrompt } from '@/components/LoginPrompt'
import { InstallPrompt } from '@/components/InstallPrompt'
import { OfflineBanner } from '@/components/OfflineBanner'
import { SyncingBanner } from '@/components/SyncingBanner'
import { ReconnectingBanner } from '@/components/ReconnectingBanner'
import { LoadingState } from '@/components/LoadingState'
import { ToastContainer } from '@/components/ToastContainer'
import { ToastProvider, useToastActions } from '@/lib/toast-context'
import type { HubIdentityResponse, SyncEvent } from '@/types/api'

type ToastEvent = Extract<SyncEvent, { type: 'toast' }>

const REQUIRE_SERVER_URL = requireHubUrlForLogin()
const LAST_HUB_IDENTITY_KEY = 'maglev:lastHubIdentity'

function formatHubIdentity(identity: HubIdentityResponse): string {
    return identity.name || identity.namespace
}

export function App() {
    return (
        <ToastProvider>
            <AppInner />
        </ToastProvider>
    )
}

function AppInner() {
    const { t } = useTranslation()
    const { serverUrl, baseUrl, setServerUrl, clearServerUrl } = useServerUrl()
    const { addToast } = useToastActions()
    const { identity: publicHubIdentity, isLoading: isHubIdentityLoading } = useHubIdentity(baseUrl)
    const {
        authSource,
        isLoading: isAuthSourceLoading,
        setAccessToken,
        setJwtToken,
        persistJwtToken,
        clearJwtToken
    } = useAuthSource(baseUrl, publicHubIdentity)
    const {
        token,
        api,
        hubIdentity: authenticatedHubIdentity,
        isLoading: isAuthLoading,
        error: authError,
        needsBinding,
        bind
    } = useAuth(authSource, baseUrl)
    const effectiveHubIdentity = authenticatedHubIdentity ?? publicHubIdentity
    const goBack = useAppGoBack()
    const pathname = useLocation({ select: (location) => location.pathname })
    const router = useRouter()

    useEffect(() => {
        const tg = getTelegramWebApp()
        tg?.ready()
        tg?.expand()
        initializeTheme()
    }, [])

    useEffect(() => {
        const hubLabel = getCurrentHubLabel(baseUrl)
        const title = hubLabel || 'Maglev'
        document.title = title
        const appleTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]')
        if (appleTitle) {
            appleTitle.setAttribute('content', title)
        }
    }, [baseUrl])

    useEffect(() => {
        if (!effectiveHubIdentity) {
            return
        }

        const previousRaw = readLocalStorageItem(LAST_HUB_IDENTITY_KEY)
        if (previousRaw) {
            try {
                const previous = JSON.parse(previousRaw) as Partial<HubIdentityResponse>
                if (
                    typeof previous.namespace === 'string'
                    && previous.namespace !== effectiveHubIdentity.namespace
                ) {
                    addToast({
                        title: 'Different hub namespace',
                        body: `This URL points to ${formatHubIdentity(effectiveHubIdentity)}. Sessions from ${previous.name || previous.namespace} are separate.`,
                        sessionId: '',
                        url: ''
                    })
                }
            } catch {
                // Ignore malformed old identity snapshots.
            }
        }

        writeLocalStorageItem(LAST_HUB_IDENTITY_KEY, JSON.stringify({
            name: effectiveHubIdentity.name,
            namespace: effectiveHubIdentity.namespace,
            machineId: effectiveHubIdentity.machineId,
            identityKey: effectiveHubIdentity.identityKey
        }))
    }, [addToast, effectiveHubIdentity])

    useEffect(() => {
        const preventDefault = (event: Event) => {
            event.preventDefault()
        }

        const onWheel = (event: WheelEvent) => {
            if (event.ctrlKey) {
                event.preventDefault()
            }
        }

        const onKeyDown = (event: KeyboardEvent) => {
            const modifier = event.ctrlKey || event.metaKey
            if (!modifier) return
            if (event.key === '+' || event.key === '-' || event.key === '=' || event.key === '0') {
                event.preventDefault()
            }
        }

        document.addEventListener('gesturestart', preventDefault as EventListener, { passive: false })
        document.addEventListener('gesturechange', preventDefault as EventListener, { passive: false })
        document.addEventListener('gestureend', preventDefault as EventListener, { passive: false })

        window.addEventListener('wheel', onWheel, { passive: false })
        window.addEventListener('keydown', onKeyDown)

        return () => {
            document.removeEventListener('gesturestart', preventDefault as EventListener)
            document.removeEventListener('gesturechange', preventDefault as EventListener)
            document.removeEventListener('gestureend', preventDefault as EventListener)

            window.removeEventListener('wheel', onWheel)
            window.removeEventListener('keydown', onKeyDown)
        }
    }, [])

    useEffect(() => {
        const tg = getTelegramWebApp()
        const backButton = tg?.BackButton
        if (!backButton) return

        if (pathname === '/' || pathname === '/sessions') {
            backButton.offClick(goBack)
            backButton.hide()
            return
        }

        backButton.show()
        backButton.onClick(goBack)
        return () => {
            backButton.offClick(goBack)
            backButton.hide()
        }
    }, [goBack, pathname])
    const queryClient = useQueryClient()
    const scopeKey = effectiveHubIdentity?.identityKey ?? baseUrl
    const { isSyncing, startSync, endSync } = useSyncingState()
    const [sseDisconnected, setSseDisconnected] = useState(false)
    const [sseDisconnectReason, setSseDisconnectReason] = useState<string | null>(null)
    const syncTokenRef = useRef(0)
    const isFirstConnectRef = useRef(true)
    const baseUrlRef = useRef(baseUrl)
    const pushPromptedRef = useRef(false)
    const { isSupported: isPushSupported, permission: pushPermission, requestPermission, subscribe } = usePushNotifications(api)

    useEffect(() => {
        if (baseUrlRef.current === baseUrl) {
            return
        }
        baseUrlRef.current = baseUrl
        isFirstConnectRef.current = true
        syncTokenRef.current = 0
        queryClient.clear()
    }, [baseUrl, queryClient])

    useEffect(() => {
        if (token) {
            persistJwtToken(token)
            return
        }
        if (authError) {
            clearJwtToken()
        }
    }, [authError, clearJwtToken, persistJwtToken, token])

    // Clean up URL params after successful auth (for direct access links)
    useEffect(() => {
        if (!token || !api) return
        const { pathname, search, hash, state } = router.history.location
        const searchParams = new URLSearchParams(search)
        if (!searchParams.has('server') && !searchParams.has('hub') && !searchParams.has('token')) {
            return
        }
        searchParams.delete('server')
        searchParams.delete('hub')
        searchParams.delete('token')
        const nextSearch = searchParams.toString()
        const nextHref = `${pathname}${nextSearch ? `?${nextSearch}` : ''}${hash}`
        router.history.replace(nextHref, state)
    }, [token, api, router])

    useEffect(() => {
        if (!api || !token) {
            pushPromptedRef.current = false
            return
        }
        if (isTelegramApp() || !isPushSupported) {
            return
        }
        if (pushPromptedRef.current) {
            return
        }
        pushPromptedRef.current = true

        const run = async () => {
            if (pushPermission === 'granted') {
                await subscribe()
                return
            }
            if (pushPermission === 'default') {
                const granted = await requestPermission()
                if (granted) {
                    await subscribe()
                }
            }
        }

        void run()
    }, [api, isPushSupported, pushPermission, requestPermission, subscribe, token])

    const handleSseConnect = useCallback(() => {
        // Clear disconnected state on successful connection
        setSseDisconnected(false)
        setSseDisconnectReason(null)

        // Increment token to track this specific connection
        const token = ++syncTokenRef.current

        // Only force show banner on first connect (page load)
        // Subsequent connects (session switches) use non-forced mode
        // which only shows banner when returning from background
        if (isFirstConnectRef.current) {
            isFirstConnectRef.current = false
            startSync({ force: true })
        } else {
            startSync()
        }
        Promise.all([
            queryClient.invalidateQueries({ queryKey: queryKeys.sessions(scopeKey) })
        ])
            .catch((error) => {
                console.error('Failed to invalidate queries on SSE connect:', error)
            })
            .finally(() => {
                // Only end sync if this is still the latest connection
                if (syncTokenRef.current === token) {
                    endSync()
                }
            })
    }, [queryClient, scopeKey, startSync, endSync])

    const handleSseDisconnect = useCallback((reason: string) => {
        // Only show reconnecting banner if we've already connected once
        if (!isFirstConnectRef.current) {
            setSseDisconnected(true)
            setSseDisconnectReason(reason)
        }
    }, [])

    // Loading auth source
    if (isAuthSourceLoading || (isHubIdentityLoading && !authSource)) {
        return (
            <div className="h-full flex items-center justify-center p-4">
                <LoadingState label={t('loading')} className="text-sm" />
            </div>
        )
    }

    // No auth source (browser environment, not logged in)
    if (!authSource) {
        return (
            <LoginPrompt
                onLogin={setAccessToken}
                onGitHubLogin={setJwtToken}
                baseUrl={baseUrl}
                serverUrl={serverUrl}
                setServerUrl={setServerUrl}
                clearServerUrl={clearServerUrl}
                requireServerUrl={REQUIRE_SERVER_URL}
            />
        )
    }

    if (needsBinding) {
        return (
            <LoginPrompt
                mode="bind"
                onBind={bind}
                baseUrl={baseUrl}
                serverUrl={serverUrl}
                setServerUrl={setServerUrl}
                clearServerUrl={clearServerUrl}
                requireServerUrl={REQUIRE_SERVER_URL}
                error={authError ?? undefined}
            />
        )
    }

    // Authenticating (also covers the gap before useAuth effect starts)
    if (isAuthLoading || (authSource && !token && !authError)) {
        return (
            <div className="h-full flex items-center justify-center p-4">
                <LoadingState label={t('authorizing')} className="text-sm" />
            </div>
        )
    }

    // Auth error
    if (authError || !token || !api) {
        // If using access token and auth failed, show login again
        if (authSource.type === 'accessToken') {
            return (
                <LoginPrompt
                    onLogin={setAccessToken}
                    baseUrl={baseUrl}
                    serverUrl={serverUrl}
                    setServerUrl={setServerUrl}
                    clearServerUrl={clearServerUrl}
                    requireServerUrl={REQUIRE_SERVER_URL}
                    error={authError ?? t('login.error.authFailed')}
                />
            )
        }

        if (authSource.type === 'broker') {
            return (
                <div className="p-4 space-y-3">
                    <div className="text-base font-semibold">{t('login.title')}</div>
                    <div className="text-sm text-red-600">
                        {authError ?? 'Server session required.'}
                    </div>
                    <div className="text-xs text-[var(--app-hint)]">
                        Open the server root URL, sign in there, then reopen this hub from the server page.
                    </div>
                </div>
            )
        }

        // Telegram auth failed
        return (
            <div className="p-4 space-y-3">
                <div className="text-base font-semibold">{t('login.title')}</div>
                <div className="text-sm text-red-600">
                    {authError ?? t('login.error.authFailed')}
                </div>
                <div className="text-xs text-[var(--app-hint)]">
                    Open this page from Telegram using the bot's "Open App" button (not "Open in browser").
                </div>
            </div>
        )
    }

    return (
        <AppContextProvider value={{ api, token, baseUrl, scopeKey }}>
            <AuthenticatedAppShell
                api={api}
                token={token}
                baseUrl={baseUrl}
                isSyncing={isSyncing}
                sseDisconnected={sseDisconnected}
                sseDisconnectReason={sseDisconnectReason}
                onSseConnect={handleSseConnect}
                onSseDisconnect={handleSseDisconnect}
            />
        </AppContextProvider>
    )
}

function AuthenticatedAppShell(props: {
    api: NonNullable<ReturnType<typeof useAuth>['api']>
    token: string
    baseUrl: string
    isSyncing: boolean
    sseDisconnected: boolean
    sseDisconnectReason: string | null
    onSseConnect: () => void
    onSseDisconnect: (reason: string) => void
}) {
    const pathname = useLocation({ select: (location) => location.pathname })
    const { addToast } = useToastActions()
    const { sessions, isLoading: sessionsLoading } = useSessions(props.api)

    const handleSseEvent = useCallback(() => {}, [])
    const handleToast = useCallback((event: ToastEvent) => {
        addToast({
            title: event.data.title,
            body: event.data.body,
            sessionId: event.data.sessionId,
            url: event.data.url
        })
    }, [addToast])

    const eventSubscription = useMemo(() => {
        const match = pathname.match(/^\/sessions\/([^/]+)(?:\/|$)/)
        const sessionId = match?.[1]
        if (sessionId && sessionId !== 'new') {
            const routeSessionExists = sessions.some((session) => session.id === sessionId)
            if (!sessionsLoading && !routeSessionExists) {
                return { all: true }
            }

            const childSessionIds = sessions
                .filter((session) =>
                    session.metadata?.parentSessionId === sessionId
                    && (session.metadata?.childRole === 'split-terminal' || session.metadata?.childRole === 'review-terminal')
                )
                .map((session) => session.id)

            return {
                sessionIds: [sessionId, ...childSessionIds]
            }
        }
        return { all: true }
    }, [pathname, sessions, sessionsLoading])

    const { subscriptionId } = useSSE({
        enabled: true,
        token: props.token,
        baseUrl: props.baseUrl,
        api: props.api,
        subscription: eventSubscription,
        onConnect: props.onSseConnect,
        onDisconnect: props.onSseDisconnect,
        onEvent: handleSseEvent,
        onToast: handleToast
    })

    useVisibilityReporter({
        api: props.api,
        subscriptionId,
        enabled: true
    })

    return (
        <>
            <SyncingBanner isSyncing={props.isSyncing} />
            <ReconnectingBanner
                isReconnecting={props.sseDisconnected && !props.isSyncing}
                reason={props.sseDisconnectReason}
            />
            <OfflineBanner />
            <div className="h-full flex flex-col">
                <Outlet />
            </div>
            <ToastContainer />
            <InstallPrompt />
        </>
    )
}
