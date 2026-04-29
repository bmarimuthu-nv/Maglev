import { useCallback, useEffect, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
    Navigate,
    Outlet,
    createRootRoute,
    createRoute,
    createRouter,
    useLocation,
    useMatchRoute,
    useNavigate,
    useParams,
} from '@tanstack/react-router'
import { App } from '@/App'
import { SessionList } from '@/components/SessionList'
import { NewSession } from '@/components/NewSession'
import { LoadingState } from '@/components/LoadingState'
import { MaglevMark } from '@/components/MaglevBrand'
import { useAppContext } from '@/lib/app-context'
import { useAppGoBack } from '@/hooks/useAppGoBack'
import { isTelegramApp } from '@/hooks/useTelegram'
import { useHubConfig } from '@/hooks/queries/useHubConfig'
import { useSession } from '@/hooks/queries/useSession'
import { useSessions } from '@/hooks/queries/useSessions'
import { queryKeys } from '@/lib/query-keys'
import { markPendingTerminalFocus } from '@/lib/pending-terminal-focus'
import { waitForSpawnedShellSessionReady } from '@/lib/spawn-session-ready'
import {
    migrateStorageFoundation,
    sweepOrphanedSessionStorage,
} from '@/lib/storage-session'
import {
    readLocalStorageItem,
    readLocalStorageNumber,
    writeLocalStorageItem,
} from '@/lib/storage-local'
import { useTranslation } from '@/lib/use-translation'
import { getCurrentHubLabel } from '@/utils/url'
import type { AgentType } from '@/components/NewSession/types'
import FilesPage from '@/routes/sessions/files'
import FilePage from '@/routes/sessions/file'
import ReviewPage from '@/routes/sessions/review'
import TerminalPage from '@/routes/sessions/terminal'
import SettingsPage from '@/routes/settings'

const SESSIONS_SIDEBAR_COLLAPSED_KEY = 'maglev:sessionsSidebarCollapsed'
const SESSIONS_SIDEBAR_WIDTH_KEY = 'maglev:sessionsSidebarWidth'
const SESSIONS_SIDEBAR_DEFAULT_WIDTH = 360
const SESSIONS_SIDEBAR_MIN_WIDTH = 280
const SESSIONS_SIDEBAR_MAX_WIDTH = 640
type HubMenuItem = {
    key: string
    label: string
    to: '/sessions' | '/sessions/new' | '/settings'
}

function BackIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <polyline points="15 18 9 12 15 6" />
        </svg>
    )
}

function PlusIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
    )
}

function PanelLeftIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <rect width="18" height="18" x="3" y="3" rx="2" />
            <path d="M9 3v18" />
            <path d="m14 9 3 3-3 3" />
        </svg>
    )
}

function ChevronDownIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <polyline points="6 9 12 15 18 9" />
        </svg>
    )
}

function SettingsIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
    )
}

function SearchIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
        </svg>
    )
}

function SessionsPage() {
    const { api, baseUrl, scopeKey } = useAppContext()
    const navigate = useNavigate()
    const pathname = useLocation({ select: location => location.pathname })
    const matchRoute = useMatchRoute()
    const { t } = useTranslation()
    const { sessions, isLoading, error, refetch } = useSessions(api)
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
    const [sidebarWidth, setSidebarWidth] = useState(SESSIONS_SIDEBAR_DEFAULT_WIDTH)
    const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
    const [hubMenuOpen, setHubMenuOpen] = useState(false)
    const [sessionSearchVisible, setSessionSearchVisible] = useState(false)
    const hubLabel = getCurrentHubLabel(baseUrl)

    useEffect(() => {
        setSidebarCollapsed(readLocalStorageItem(SESSIONS_SIDEBAR_COLLAPSED_KEY) === 'true')
    }, [])

    useEffect(() => {
        const nextWidth = readLocalStorageNumber(SESSIONS_SIDEBAR_WIDTH_KEY)
        if (nextWidth === null) {
            setSidebarWidth(SESSIONS_SIDEBAR_DEFAULT_WIDTH)
            return
        }

        setSidebarWidth(
            Math.min(SESSIONS_SIDEBAR_MAX_WIDTH, Math.max(SESSIONS_SIDEBAR_MIN_WIDTH, nextWidth))
        )
    }, [])

    useEffect(() => {
        setMobileSidebarOpen(false)
        setHubMenuOpen(false)
    }, [pathname])

    useEffect(() => {
        if (isLoading) {
            return
        }

        const sessionIds = sessions.map((session) => session.id)
        migrateStorageFoundation({
            scopeKey,
            baseUrl,
            sessionIds,
        })
        sweepOrphanedSessionStorage({
            scopeKey,
            baseUrl,
            activeSessionIds: sessionIds,
        })
    }, [baseUrl, isLoading, scopeKey, sessions])

    const setSidebarCollapsedWithPersistence = useCallback((next: boolean) => {
        setSidebarCollapsed(next)
        writeLocalStorageItem(SESSIONS_SIDEBAR_COLLAPSED_KEY, String(next))
    }, [])

    const setSidebarWidthWithPersistence = useCallback((nextWidth: number) => {
        const clamped = Math.min(
            SESSIONS_SIDEBAR_MAX_WIDTH,
            Math.max(SESSIONS_SIDEBAR_MIN_WIDTH, Math.round(nextWidth))
        )
        setSidebarWidth(clamped)
        writeLocalStorageItem(SESSIONS_SIDEBAR_WIDTH_KEY, String(clamped))
    }, [])

    const isFileExplorerRoute = /\/sessions\/[^/]+\/files(?:\/)?(?:$|\?)/.test(pathname)
        || /\/sessions\/[^/]+\/file(?:\/)?(?:$|\?)/.test(pathname)
        || /\/sessions\/[^/]+\/review(?:\/)?(?:$|\?)/.test(pathname)
    const effectiveSidebarCollapsed = sidebarCollapsed || isFileExplorerRoute

    const handleSidebarResizeStart = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        if (effectiveSidebarCollapsed) {
            return
        }

        event.preventDefault()
        const startX = event.clientX
        const startWidth = sidebarWidth

        const handlePointerMove = (moveEvent: PointerEvent) => {
            const delta = moveEvent.clientX - startX
            setSidebarWidthWithPersistence(startWidth + delta)
        }

        const handlePointerUp = () => {
            window.removeEventListener('pointermove', handlePointerMove)
            window.removeEventListener('pointerup', handlePointerUp)
        }

        window.addEventListener('pointermove', handlePointerMove)
        window.addEventListener('pointerup', handlePointerUp)
    }, [effectiveSidebarCollapsed, sidebarWidth, setSidebarWidthWithPersistence])

    const handleRefresh = useCallback(() => {
        void refetch()
    }, [refetch])

    const projectCount = new Set(sessions.map(s => s.metadata?.worktree?.basePath ?? s.metadata?.path ?? 'Other')).size
    const sessionMatch = matchRoute({ to: '/sessions/$sessionId', fuzzy: true })
    const selectedSessionId = sessionMatch && sessionMatch.sessionId !== 'new' ? sessionMatch.sessionId : null
    const isSessionsIndex = pathname === '/sessions' || pathname === '/sessions/'
    const hubMenuItems: HubMenuItem[] = [
        { key: 'sessions', label: 'Chats', to: '/sessions' },
        { key: 'new', label: t('sessions.new'), to: '/sessions/new' },
        { key: 'settings', label: t('settings.title'), to: '/settings' },
    ]

    const handleSelectSession = useCallback((sessionId: string) => {
        setMobileSidebarOpen(false)
        navigate({
            to: '/sessions/$sessionId',
            params: { sessionId },
        })
    }, [navigate])

    const renderHubMenu = (align: 'left' | 'right' = 'left') => (
        <div className={`absolute top-full z-30 mt-2 min-w-[180px] rounded-2xl border border-[var(--app-divider)] bg-[var(--app-bg)] p-1 shadow-lg ${align === 'right' ? 'right-0' : 'left-0'}`}>
            {hubMenuItems.map((item) => (
                <button
                    key={item.key}
                    type="button"
                    onClick={() => {
                        setHubMenuOpen(false)
                        navigate({ to: item.to })
                    }}
                    className="flex w-full items-center rounded-xl px-3 py-2 text-left text-sm text-[var(--app-fg)] transition-colors hover:bg-[var(--app-secondary-bg)]"
                >
                    {item.label}
                </button>
            ))}
        </div>
    )

    const renderSidebarContent = (mode: 'desktop' | 'mobile') => (
        <>
            <div className="bg-[var(--app-bg)] pt-[env(safe-area-inset-top)]">
                <div className="px-2.5 py-2">
                    <div className="flex min-w-0 items-center gap-2.5 rounded-[18px] border border-[var(--app-border)] bg-[var(--app-surface-raised)] px-2.5 py-2">
                        <MaglevMark size="sm" className="h-8.5 w-8.5 rounded-[14px] shrink-0" />
                        <div className="min-w-0 flex-1">
                            <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-[var(--app-hint)]">
                                Maglev Hub
                            </div>
                            <div className="mt-0.5 truncate text-[12px] font-semibold text-[var(--app-fg)]">
                                {hubLabel}
                            </div>
                            <div className="text-[10px] text-[var(--app-hint)]">
                                {t('sessions.count', { n: sessions.length, m: projectCount })}
                            </div>
                        </div>
                    </div>

                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {mode === 'desktop' ? (
                            <button
                                type="button"
                                onClick={() => setSidebarCollapsedWithPersistence(true)}
                                className="hidden lg:flex rounded-full p-1 text-[var(--app-hint)] hover:text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] transition-colors"
                                title="Hide sidebar"
                            >
                                <PanelLeftIcon className="h-4 w-4" />
                            </button>
                        ) : null}
                        <button
                            type="button"
                            onClick={() => {
                                setMobileSidebarOpen(false)
                                navigate({ to: '/settings' })
                            }}
                            className="rounded-full p-1 text-[var(--app-hint)] hover:text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] transition-colors"
                            title={t('settings.title')}
                        >
                            <SettingsIcon className="h-4 w-4" />
                        </button>
                        <button
                            type="button"
                            onClick={() => setSessionSearchVisible((visible) => !visible)}
                            className={`rounded-full p-1 transition-colors ${
                                sessionSearchVisible
                                    ? 'bg-[var(--app-subtle-bg)] text-[var(--app-fg)]'
                                    : 'text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]'
                            }`}
                            title="Search sessions"
                            aria-label="Search sessions"
                            aria-pressed={sessionSearchVisible}
                        >
                            <SearchIcon className="h-4 w-4" />
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setMobileSidebarOpen(false)
                                navigate({ to: '/sessions/new' })
                            }}
                            className={mode === 'desktop'
                                ? 'hidden lg:inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--app-border)] bg-[var(--app-subtle-bg)]/55 px-2.5 text-[12px] font-medium text-[var(--app-fg)] transition-colors duration-150 hover:bg-[var(--app-subtle-bg)]'
                                : 'session-list-new-button rounded-full p-1.5 text-[var(--app-link)] transition-colors'}
                            title={t('sessions.new')}
                        >
                            <PlusIcon className="h-4 w-4" />
                            {mode === 'desktop' ? <span className="hidden xl:inline">New</span> : null}
                        </button>
                    </div>
                </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto desktop-scrollbar-left">
                {error ? (
                    <div className="w-full px-3 py-2">
                        <div className="text-sm text-red-600">{error}</div>
                    </div>
                ) : null}
                <SessionList
                    sessions={sessions}
                    selectedSessionId={selectedSessionId}
                    onSelect={handleSelectSession}
                    onClone={(newSessionId) => {
                        setMobileSidebarOpen(false)
                        navigate({
                            to: '/sessions/$sessionId/terminal',
                            params: { sessionId: newSessionId },
                        })
                    }}
                    onNewSession={() => {
                        setMobileSidebarOpen(false)
                        navigate({ to: '/sessions/new' })
                    }}
                    onRefresh={handleRefresh}
                    isLoading={isLoading}
                    renderHeader={false}
                    searchVisible={sessionSearchVisible}
                    api={api}
                />
            </div>
        </>
    )

    return (
        <div className="flex h-full min-h-0">
            <div
                className={`${isFileExplorerRoute ? 'hidden' : isSessionsIndex ? 'flex' : 'hidden lg:flex'} ${effectiveSidebarCollapsed ? 'lg:hidden' : 'lg:flex'} relative w-full shrink-0 flex-col bg-[var(--app-bg)] lg:border-r lg:border-[var(--app-divider)]`}
                style={!effectiveSidebarCollapsed ? { width: `${sidebarWidth}px` } : undefined}
            >
                {renderSidebarContent('desktop')}
                {!effectiveSidebarCollapsed ? (
                    <div
                        role="separator"
                        aria-orientation="vertical"
                        aria-label="Resize sidebar"
                        onPointerDown={handleSidebarResizeStart}
                        className="absolute inset-y-0 right-0 hidden w-3 translate-x-1/2 cursor-col-resize lg:block"
                    >
                        <div className="mx-auto h-full w-[2px] rounded-full bg-transparent transition-colors hover:bg-[var(--app-link)]" />
                    </div>
                ) : null}
            </div>

            {mobileSidebarOpen && !isSessionsIndex && !isFileExplorerRoute ? (
                <div className="fixed inset-0 z-40 flex lg:hidden">
                    <button
                        type="button"
                        className="flex-1 bg-black/35"
                        aria-label="Close chats"
                        onClick={() => setMobileSidebarOpen(false)}
                    />
                    <div className="flex h-full w-[min(88vw,380px)] flex-col border-l border-[var(--app-divider)] bg-[var(--app-bg)] shadow-2xl">
                        {renderSidebarContent('mobile')}
                    </div>
                </div>
            ) : null}

            <div className={`${isSessionsIndex ? 'hidden lg:flex' : 'flex'} relative min-w-0 flex-1 flex-col bg-[var(--app-bg)]`}>
                {!isSessionsIndex && !isFileExplorerRoute ? (
                    <div className="flex items-center justify-between gap-2 border-b border-[var(--app-divider)] px-3 py-2 pt-[calc(0.5rem+env(safe-area-inset-top))] lg:hidden">
                        <button
                            type="button"
                            onClick={() => setMobileSidebarOpen(true)}
                            className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                            title="Open chats"
                        >
                            <PanelLeftIcon className="h-5 w-5" />
                        </button>
                        <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
                            <MaglevMark size="sm" className="h-8 w-8 rounded-[14px] shrink-0" />
                            <div className="relative min-w-0">
                                <button
                                    type="button"
                                    onClick={() => setHubMenuOpen((value) => !value)}
                                    className="flex min-w-0 items-center gap-2 rounded-full px-2 py-1 text-sm font-semibold text-[var(--app-fg)] transition-colors hover:bg-[var(--app-subtle-bg)]"
                                >
                                    <span className="truncate">{hubLabel}</span>
                                    <ChevronDownIcon className={`h-4 w-4 shrink-0 text-[var(--app-hint)] transition-transform ${hubMenuOpen ? 'rotate-180' : ''}`} />
                                </button>
                                {hubMenuOpen ? renderHubMenu('right') : null}
                            </div>
                        </div>
                        <div className="w-9 shrink-0" />
                    </div>
                ) : null}
                {effectiveSidebarCollapsed && !isFileExplorerRoute ? (
                    <div className="hidden lg:flex absolute left-3 top-[calc(env(safe-area-inset-top)+0.75rem)] z-20">
                        <button
                            type="button"
                            onClick={() => setSidebarCollapsedWithPersistence(false)}
                            className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--app-divider)] bg-[var(--app-bg)] text-[var(--app-hint)] shadow-sm transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                            title="Show sidebar"
                        >
                            <PanelLeftIcon className="h-5 w-5 rotate-180" />
                        </button>
                    </div>
                ) : null}
                <div className="flex-1 min-h-0">
                    <Outlet />
                </div>
            </div>
        </div>
    )
}

function SessionsIndexPage() {
    return null
}

function SessionDetailRoute() {
    const pathname = useLocation({ select: location => location.pathname })
    const { sessionId } = useParams({ from: '/sessions/$sessionId' })
    const { api } = useAppContext()
    const basePath = `/sessions/${sessionId}`
    const isChat = pathname === basePath || pathname === `${basePath}/`
    const { session, isLoading } = useSession(api, sessionId)

    if (isChat && isLoading) {
        return (
            <div className="h-full flex items-center justify-center p-4">
                <LoadingState className="text-sm" />
            </div>
        )
    }

    if (isChat && session) {
        return <Navigate to="/sessions/$sessionId/terminal" params={{ sessionId }} replace />
    }

    return isChat ? <Navigate to="/sessions/$sessionId/terminal" params={{ sessionId }} replace /> : <Outlet />
}

function NewSessionPage() {
    const { api, scopeKey } = useAppContext()
    const navigate = useNavigate()
    const goBack = useAppGoBack()
    const queryClient = useQueryClient()
    const { machine, isLoading: hubLoading, error: hubError } = useHubConfig(api)
    const { t } = useTranslation()

    const handleCancel = useCallback(() => {
        navigate({ to: '/sessions' })
    }, [navigate])

    const handleSuccess = useCallback((sessionId: string, _agent: AgentType) => {
        const openSpawnedSession = async () => {
            markPendingTerminalFocus(sessionId)
            if (document.activeElement instanceof HTMLElement) {
                document.activeElement.blur()
            }

            await waitForSpawnedShellSessionReady({
                api,
                queryClient,
                scopeKey,
                sessionId
            })

            navigate({
                to: '/sessions/$sessionId/terminal',
                params: { sessionId },
                replace: true
            })
        }

        void openSpawnedSession()
    }, [api, navigate, queryClient, scopeKey])

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-center gap-2 border-b border-[var(--app-border)] bg-[var(--app-bg)] p-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
                {!isTelegramApp() && (
                    <button
                        type="button"
                        onClick={goBack}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                    >
                        <BackIcon />
                    </button>
                )}
                <div className="flex-1 font-semibold">{t('newSession.title')}</div>
            </div>

            {hubError ? (
                <div className="p-3 text-sm text-red-600">
                    {hubError}
                </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="mx-auto w-full max-w-[720px]">
                    <NewSession
                        api={api}
                        machine={machine}
                        isLoading={hubLoading}
                        onCancel={handleCancel}
                        onSuccess={handleSuccess}
                    />
                </div>
            </div>
        </div>
    )
}

const rootRoute = createRootRoute({
    component: App,
})

const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <Navigate to="/sessions" replace />,
})

const sessionsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/sessions',
    component: SessionsPage,
})

const sessionsIndexRoute = createRoute({
    getParentRoute: () => sessionsRoute,
    path: '/',
    component: SessionsIndexPage,
})

const sessionDetailRoute = createRoute({
    getParentRoute: () => sessionsRoute,
    path: '$sessionId',
    component: SessionDetailRoute,
})

const sessionFilesRoute = createRoute({
    getParentRoute: () => sessionDetailRoute,
    path: 'files',
    validateSearch: (search: Record<string, unknown>): { path?: string; staged?: boolean; line?: number } => {
        const path = typeof search.path === 'string' ? search.path : undefined
        const staged = search.staged === true || search.staged === 'true'
            ? true
            : search.staged === false || search.staged === 'false'
                ? false
                : undefined
        const lineValue = typeof search.line === 'number'
            ? search.line
            : typeof search.line === 'string'
                ? Number.parseInt(search.line, 10)
                : undefined
        const line = Number.isFinite(lineValue) && lineValue && lineValue > 0
            ? lineValue
            : undefined

        return {
            ...(path ? { path } : {}),
            ...(staged !== undefined ? { staged } : {}),
            ...(line !== undefined ? { line } : {})
        }
    },
    component: FilesPage,
})

const sessionTerminalRoute = createRoute({
    getParentRoute: () => sessionDetailRoute,
    path: 'terminal',
    component: TerminalPage,
})

type SessionReviewSearch = {
    mode?: 'branch' | 'working'
    path?: string
    threadId?: string
}

const sessionReviewRoute = createRoute({
    getParentRoute: () => sessionDetailRoute,
    path: 'review',
    validateSearch: (search: Record<string, unknown>): SessionReviewSearch => {
        const mode = search.mode === 'working' ? 'working' : search.mode === 'branch' ? 'branch' : undefined
        const path = typeof search.path === 'string' ? search.path : undefined
        const threadId = typeof search.threadId === 'string' ? search.threadId : undefined
        return {
            ...(mode ? { mode } : {}),
            ...(path ? { path } : {}),
            ...(threadId ? { threadId } : {}),
        }
    },
    component: ReviewPage,
})

type SessionFileSearch = {
    path: string
    staged?: boolean
}

const sessionFileRoute = createRoute({
    getParentRoute: () => sessionDetailRoute,
    path: 'file',
    validateSearch: (search: Record<string, unknown>): SessionFileSearch => {
        const path = typeof search.path === 'string' ? search.path : ''
        const staged = search.staged === true || search.staged === 'true'
            ? true
            : search.staged === false || search.staged === 'false'
                ? false
                : undefined

        const result: SessionFileSearch = { path }
        if (staged !== undefined) {
            result.staged = staged
        }
        return result
    },
    component: FilePage,
})

const newSessionRoute = createRoute({
    getParentRoute: () => sessionsRoute,
    path: 'new',
    component: NewSessionPage,
})

const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/settings',
    component: SettingsPage,
})

export const routeTree = rootRoute.addChildren([
    indexRoute,
    sessionsRoute.addChildren([
        sessionsIndexRoute,
        newSessionRoute,
        sessionDetailRoute.addChildren([
            sessionTerminalRoute,
            sessionFilesRoute,
            sessionFileRoute,
            sessionReviewRoute,
        ]),
    ]),
    settingsRoute,
])

type RouterHistory = Parameters<typeof createRouter>[0]['history']

export function createAppRouter(history?: RouterHistory, basepath?: string) {
    return createRouter({
        routeTree,
        history,
        basepath,
        scrollRestoration: true,
    })
}

export type AppRouter = ReturnType<typeof createAppRouter>

declare module '@tanstack/react-router' {
    interface Register {
        router: AppRouter
    }
}
