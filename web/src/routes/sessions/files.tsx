import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import type { FileReadResponse, FileSearchItem } from '@/types/api'
import { FileIcon } from '@/components/FileIcon'
import { CodeLinesView } from '@/components/SessionFiles/CodeLinesView'
import { DirectoryTree } from '@/components/SessionFiles/DirectoryTree'
import { useAppContext } from '@/lib/app-context'
import { useSession } from '@/hooks/queries/useSession'
import { useSessionFileSearch } from '@/hooks/queries/useSessionFileSearch'
import { rankFiles } from '@/lib/file-search'
import { buildSessionExplorerUrl } from '@/utils/sessionExplorer'
import { decodeBase64, encodeBase64 } from '@/lib/utils'
import { decodePath, getUtf8ByteLength, isBinaryContent } from '@/lib/file-utils'
import { queryKeys } from '@/lib/query-keys'

type ExplorerTab = {
    id: string
    path: string
    fileName: string
    isEditing: boolean
    draftContent: string
    loadedContent: string
    fileHash: string | null
    binary: boolean
    loadError: string | null
}

type ExplorerHistoryEntry = {
    path?: string
    line?: number
}

type ExplorerRailView = 'files' | 'open' | 'recent'

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

function RefreshIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M21 12a9 9 0 1 1-3-6.7" />
            <polyline points="21 3 21 9 15 9" />
        </svg>
    )
}

function SearchIcon(props: { className?: string }) {
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
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
    )
}

function FolderIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        </svg>
    )
}

function CloseIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
        </svg>
    )
}

function ClockIcon(props: { className?: string }) {
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
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 3" />
        </svg>
    )
}

function PanelIcon(props: { className?: string }) {
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
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M9 4v16" />
        </svg>
    )
}

function getFileName(path: string): string {
    return path.split('/').pop() || path
}

function getCompactParentPath(path: string): string {
    const parent = path.split('/').slice(0, -1).join('/')
    if (!parent) {
        return 'project root'
    }
    const parts = parent.split('/').filter(Boolean)
    if (parts.length <= 2) {
        return parent
    }
    return `${parts.slice(-2).join('/')}`
}

function SearchResultRow(props: {
    file: {
        fileName: string
        fullPath: string
        filePath?: string
        fileType: 'file' | 'folder' | 'directory'
    }
    onOpen: () => void
    showDivider: boolean
    active?: boolean
    metaLabel?: string | null
}) {
    const subtitle = props.file.filePath || 'project root'
    const icon = props.file.fileType === 'file'
        ? <FileIcon fileName={props.file.fileName} size={22} />
        : <FolderIcon className="text-[var(--app-link)]" />

    return (
        <button
            type="button"
            onClick={props.onOpen}
            className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors ${
                props.active
                    ? 'bg-[color:rgba(228,115,83,0.10)] shadow-[0_14px_28px_-24px_rgba(228,115,83,0.5)]'
                    : 'hover:bg-[var(--app-subtle-bg)]'
            } ${props.showDivider ? 'border-b border-[var(--app-divider)]/70' : ''}`}
        >
            {icon}
            <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-[var(--app-fg)]">{props.file.fileName}</div>
                <div className="truncate text-xs text-[var(--app-hint)]">{subtitle}</div>
            </div>
            {props.metaLabel ? (
                <span className="shrink-0 rounded-full border border-[var(--app-border)] bg-[var(--app-surface-raised)] px-2 py-0.5 text-[10px] font-semibold text-[var(--app-hint)]">
                    {props.metaLabel}
                </span>
            ) : null}
        </button>
    )
}

function RailSwitch(props: {
    value: ExplorerRailView
    onChange: (next: ExplorerRailView) => void
}) {
    const options: Array<{ value: ExplorerRailView; label: string; icon: ReactNode }> = [
        { value: 'files', label: 'Files', icon: <FolderIcon className="h-4 w-4" /> },
        { value: 'open', label: 'Open', icon: <PanelIcon className="h-4 w-4" /> },
        { value: 'recent', label: 'Recent', icon: <ClockIcon className="h-4 w-4" /> }
    ]

    return (
        <div className="grid grid-cols-3 gap-1 rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface-raised)] p-1">
            {options.map((option) => {
                const active = option.value === props.value
                return (
                    <button
                        key={option.value}
                        type="button"
                        onClick={() => props.onChange(option.value)}
                        className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${
                            active
                                ? 'bg-[var(--app-button)] text-[var(--app-button-text)] shadow-[0_14px_28px_-22px_var(--app-button-shadow)]'
                                : 'text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]'
                        }`}
                    >
                        {option.icon}
                        <span>{option.label}</span>
                    </button>
                )
            })}
        </div>
    )
}

function EmptyRailState(props: {
    title: string
    body: string
}) {
    return (
        <div className="rounded-[24px] border border-dashed border-[var(--app-border)] bg-[var(--app-surface-raised)] px-4 py-8 text-center">
            <div className="text-sm font-semibold text-[var(--app-fg)]">{props.title}</div>
            <div className="mt-1 text-xs text-[var(--app-hint)]">{props.body}</div>
        </div>
    )
}

function ExplorerBreadcrumbs(props: { path: string }) {
    const parts = props.path.split('/').filter(Boolean)

    return (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--app-hint)]">
            {parts.map((part, index) => (
                <div key={`${part}-${index}`} className="inline-flex items-center gap-1.5">
                    {index > 0 ? <span className="text-[var(--app-hint)]/60">/</span> : null}
                    <span className={index === parts.length - 1 ? 'font-semibold text-[var(--app-fg)]/80' : ''}>
                        {part}
                    </span>
                </div>
            ))}
            {parts.length === 0 ? <span>project root</span> : null}
        </div>
    )
}

function DocumentEmptyState() {
    return (
        <div className="flex h-full min-h-[320px] items-center justify-center rounded-[28px] border border-dashed border-[var(--app-border)] bg-[var(--app-surface-raised)] px-8 text-center">
            <div>
                <div className="text-base font-semibold text-[var(--app-fg)]">Open a file to start reading</div>
                <div className="mt-2 text-sm text-[var(--app-hint)]">
                    Use the left rail to browse, search, revisit recent files, or reopen one of your active tabs.
                </div>
            </div>
        </div>
    )
}


function getTabId(path: string): string {
    return path
}

function createEmptyTab(path: string): ExplorerTab {
    const fileName = path.split('/').pop() || path
    return {
        id: getTabId(path),
        path,
        fileName,
        isEditing: false,
        draftContent: '',
        loadedContent: '',
        fileHash: null,
        binary: false,
        loadError: null
    }
}

function useActiveTabFile(
    api: ReturnType<typeof useAppContext>['api'],
    scopeKey: string,
    sessionId: string,
    activeTab: ExplorerTab | null
): UseQueryResult<FileReadResponse, Error> {
    return useQuery({
        queryKey: queryKeys.sessionFile(scopeKey, sessionId, activeTab?.path ?? ''),
        queryFn: async () => {
            if (!api || !activeTab?.path) {
                throw new Error('Missing active file')
            }
            return await api.readSessionFile(sessionId, activeTab.path)
        },
        enabled: Boolean(api && activeTab?.path)
    })
}

export default function FilesPage() {
    const { api, scopeKey, baseUrl } = useAppContext()
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const { sessionId } = useParams({ from: '/sessions/$sessionId/files' })
    const search = useSearch({ from: '/sessions/$sessionId/files' })
    const { session } = useSession(api, sessionId)
    const explorerHistoryRef = useRef<ExplorerHistoryEntry[]>([])
    const [railView, setRailView] = useState<ExplorerRailView>('files')
    const [searchQuery, setSearchQuery] = useState('')
    const [recentPaths, setRecentPaths] = useState<string[]>([])
    const [openTabs, setOpenTabs] = useState<ExplorerTab[]>([])
    const [activeTabId, setActiveTabId] = useState<string | null>(null)
    const [isSaving, setIsSaving] = useState(false)
    const searchPath = typeof search.path === 'string' ? decodePath(search.path) : ''
    const highlightedLine = typeof search.line === 'number' ? search.line : undefined

    const shouldSearch = Boolean(searchQuery.trim())

    useEffect(() => {
        const currentEntry: ExplorerHistoryEntry = {}
        if (searchPath) {
            currentEntry.path = searchPath
        }
        if (highlightedLine && Number.isFinite(highlightedLine) && highlightedLine > 0) {
            currentEntry.line = highlightedLine
        }

        const previousEntry = explorerHistoryRef.current[explorerHistoryRef.current.length - 1]
        if (
            previousEntry?.path === currentEntry.path
            && previousEntry?.line === currentEntry.line
        ) {
            return
        }

        explorerHistoryRef.current = [...explorerHistoryRef.current, currentEntry].slice(-50)
    }, [highlightedLine, searchPath])

    const searchInventory = useSessionFileSearch(api, sessionId, '', {
        enabled: shouldSearch,
        limit: 5000
    })

    const rankedSearchResults = useMemo(
        () => shouldSearch ? rankFiles(searchInventory.files, searchQuery).slice(0, 200) : [],
        [searchInventory.files, searchQuery, shouldSearch]
    )

    const subtitle = session?.metadata?.path ?? sessionId
    const workspaceBranch = session?.metadata?.worktree?.branch?.trim() || null
    const rootLabel = useMemo(() => {
        const base = session?.metadata?.path ?? sessionId
        const parts = base.split(/[/\\]/).filter(Boolean)
        return parts.length ? parts[parts.length - 1] : base
    }, [session?.metadata?.path, sessionId])

    const activeTab = useMemo(
        () => openTabs.find((tab) => tab.id === activeTabId) ?? null,
        [openTabs, activeTabId]
    )
    const activePath = activeTab?.path ?? (searchPath || null)
    const recentFileItems = useMemo(
        () => recentPaths.map((path) => ({
            path,
            fileName: getFileName(path),
            parentPath: getCompactParentPath(path)
        })),
        [recentPaths]
    )
    const rememberRecentPath = useCallback((path: string) => {
        setRecentPaths((previous) => [path, ...previous.filter((entry) => entry !== path)].slice(0, 12))
    }, [])

    const activeFileQuery = useActiveTabFile(api, scopeKey, sessionId, activeTab)
    const activeFileResult = activeFileQuery.data ?? null

    useEffect(() => {
        if (!searchPath) {
            return
        }

        setOpenTabs((previous) => {
            if (previous.some((tab) => tab.path === searchPath)) {
                return previous
            }
            return [...previous, createEmptyTab(searchPath)]
        })
        setActiveTabId(getTabId(searchPath))
        rememberRecentPath(searchPath)
    }, [rememberRecentPath, searchPath])

    useEffect(() => {
        if (!activeTab || !activeFileResult?.success) {
            return
        }

        const decoded = activeFileResult.content ? decodeBase64(activeFileResult.content) : { ok: true, text: '' }
        const content = decoded.ok ? decoded.text : ''
        const binary = !decoded.ok || isBinaryContent(content)
        setOpenTabs((previous) => previous.map((tab) => {
            if (tab.id !== activeTab.id) {
                return tab
            }
            if (tab.isEditing) {
                return {
                    ...tab,
                    fileHash: activeFileResult.hash ?? null,
                    binary,
                    loadError: null
                }
            }
            return {
                ...tab,
                loadedContent: content,
                draftContent: content,
                fileHash: activeFileResult.hash ?? null,
                binary,
                loadError: null
            }
        }))
    }, [activeFileResult, activeTab])

    useEffect(() => {
        if (!activeTab || !activeFileResult || activeFileResult.success) {
            return
        }

        setOpenTabs((previous) => previous.map((tab) => tab.id === activeTab.id
            ? { ...tab, loadError: activeFileResult.error ?? 'Failed to read file' }
            : tab))
    }, [activeFileResult, activeTab])

    const syncSearch = useCallback((path?: string | null, line?: number | null) => {
        const nextSearch: { path?: string; line?: number } = {}
        if (path) {
            nextSearch.path = encodeBase64(path)
        }
        if (line && Number.isFinite(line) && line > 0) {
            nextSearch.line = line
        }

        navigate({
            to: '/sessions/$sessionId/files',
            params: { sessionId },
            search: nextSearch,
            replace: true
        })
    }, [navigate, sessionId])

    const openFileTab = useCallback((path: string, line?: number | null) => {
        setOpenTabs((previous) => {
            if (previous.some((tab) => tab.path === path)) {
                return previous
            }
            return [...previous, createEmptyTab(path)]
        })
        setActiveTabId(getTabId(path))
        rememberRecentPath(path)
        syncSearch(path, line ?? undefined)
    }, [rememberRecentPath, syncSearch])

    const handleOpenFile = useCallback((path: string) => {
        openFileTab(path)
    }, [openFileTab])

    const handleExplorerBack = useCallback(() => {
        if (explorerHistoryRef.current.length <= 1) {
            return
        }

        const nextHistory = [...explorerHistoryRef.current]
        nextHistory.pop()
        const previousEntry = nextHistory[nextHistory.length - 1]
        explorerHistoryRef.current = nextHistory

        navigate({
            to: '/sessions/$sessionId/files',
            params: { sessionId },
            search: previousEntry?.path
                ? {
                    path: encodeBase64(previousEntry.path),
                    ...(previousEntry.line ? { line: previousEntry.line } : {})
                }
                : {},
            replace: true
        })
    }, [navigate, sessionId])

    const handleSelectTab = useCallback((tabId: string) => {
        const next = openTabs.find((tab) => tab.id === tabId)
        setActiveTabId(tabId)
        if (next?.path) {
            rememberRecentPath(next.path)
        }
        syncSearch(next?.path ?? null, highlightedLine ?? null)
    }, [highlightedLine, openTabs, rememberRecentPath, syncSearch])

    const handleCloseTab = useCallback((tabId: string) => {
        setOpenTabs((previous) => {
            const next = previous.filter((tab) => tab.id !== tabId)
            const wasActive = activeTabId === tabId
            if (wasActive) {
                const replacement = next[next.length - 1] ?? null
                setActiveTabId(replacement?.id ?? null)
                syncSearch(replacement?.path ?? null, null)
            }
            return next
        })
    }, [activeTabId, syncSearch])

    const handleRefresh = useCallback(() => {
        if (activeTab?.path) {
            void queryClient.invalidateQueries({
                queryKey: queryKeys.sessionFile(scopeKey, sessionId, activeTab.path)
            })
        }
        if (shouldSearch) {
            void queryClient.invalidateQueries({
                queryKey: queryKeys.sessionFiles(scopeKey, sessionId, '')
            })
        }
    }, [activeTab?.path, queryClient, scopeKey, sessionId, shouldSearch])

    const handleStartEdit = useCallback(() => {
        if (!activeTab) {
            return
        }
        setOpenTabs((previous) => previous.map((tab) => tab.id === activeTab.id
            ? { ...tab, isEditing: true, draftContent: tab.loadedContent }
            : tab))
    }, [activeTab])

    const handleDiscard = useCallback(() => {
        if (!activeTab) {
            return
        }
        setOpenTabs((previous) => previous.map((tab) => tab.id === activeTab.id
            ? { ...tab, isEditing: false, draftContent: tab.loadedContent }
            : tab))
    }, [activeTab])

    const handleDraftChange = useCallback((value: string) => {
        if (!activeTab) {
            return
        }
        setOpenTabs((previous) => previous.map((tab) => tab.id === activeTab.id
            ? { ...tab, draftContent: value }
            : tab))
    }, [activeTab])

    const handleSave = useCallback(async () => {
        if (!api || !activeTab) {
            return
        }

        setIsSaving(true)
        try {
            const result = await api.writeSessionFile(
                sessionId,
                activeTab.path,
                encodeBase64(activeTab.draftContent),
                activeTab.fileHash
            )
            if (!result.success) {
                throw new Error(result.error ?? 'Failed to save file')
            }

            setOpenTabs((previous) => previous.map((tab) => tab.id === activeTab.id
                ? {
                    ...tab,
                    isEditing: false,
                    loadedContent: tab.draftContent,
                    fileHash: result.hash ?? null,
                    loadError: null
                }
                : tab))

            void queryClient.invalidateQueries({ queryKey: queryKeys.gitStatus(scopeKey, sessionId) })
        } catch (error) {
            setOpenTabs((previous) => previous.map((tab) => tab.id === activeTab.id
                ? { ...tab, loadError: error instanceof Error ? error.message : 'Failed to save file' }
                : tab))
        } finally {
            setIsSaving(false)
        }
    }, [activeTab, api, queryClient, scopeKey, sessionId])

    const activeContent = activeTab?.isEditing ? activeTab.draftContent : activeTab?.loadedContent ?? ''
    const activeDeepLink = useCallback((line: number) => {
        if (!activeTab) {
            return buildSessionExplorerUrl(baseUrl, sessionId)
        }
        return buildSessionExplorerUrl(baseUrl, sessionId, {
            path: activeTab.path,
            line
        })
    }, [activeTab, baseUrl, sessionId])

    const isDirty = Boolean(activeTab && activeTab.isEditing && activeTab.draftContent !== activeTab.loadedContent)

    return (
        <div className="flex h-full flex-col bg-[var(--app-bg)]">
            <div className="px-3 pb-3 pt-[env(safe-area-inset-top)] md:px-4 md:pb-4">
                <div className="flex flex-wrap items-center gap-3 rounded-[28px] border border-[var(--app-border)] bg-[var(--app-secondary-bg)] px-4 py-3 shadow-[0_24px_56px_-40px_rgba(48,33,24,0.35)]">
                    <button
                        type="button"
                        onClick={handleExplorerBack}
                        className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--app-border)] bg-[var(--app-surface-raised)] text-[var(--app-hint)] transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]"
                    >
                        <BackIcon />
                    </button>
                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                            <div className="truncate text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--app-hint)]">
                                File workspace
                            </div>
                            {workspaceBranch ? (
                                <span className="rounded-full border border-[var(--app-border)] bg-[var(--app-surface-raised)] px-2 py-0.5 text-[10px] font-semibold text-[var(--app-hint)]">
                                    Branch {workspaceBranch}
                                </span>
                            ) : null}
                        </div>
                        <div className="mt-1 truncate text-base font-semibold text-[var(--app-fg)]">
                            {rootLabel}
                        </div>
                        <div className="truncate text-xs text-[var(--app-hint)]">{session?.metadata?.path ?? subtitle}</div>
                    </div>
                    <button
                        type="button"
                        onClick={handleRefresh}
                        className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--app-border)] bg-[var(--app-surface-raised)] text-[var(--app-hint)] transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]"
                        title="Refresh"
                    >
                        <RefreshIcon />
                    </button>
                </div>
            </div>

            {!session?.active ? (
                <div className="px-3 pb-3 md:px-4">
                    <div className="rounded-[22px] border border-amber-300/30 bg-amber-500/10 px-4 py-3 text-sm text-[var(--app-hint)]">
                        Session is inactive. Explorer may be unavailable until the session is resumed.
                    </div>
                </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-hidden px-3 pb-3 md:px-4 md:pb-4">
                <div className="flex h-full min-h-0 flex-col gap-3 lg:flex-row">
                    <aside className="flex min-h-0 w-full shrink-0 flex-col gap-3 lg:w-[320px] xl:w-[360px]">
                        <div className="rounded-[28px] border border-[var(--app-border)] bg-[var(--app-secondary-bg)] p-4 shadow-[0_20px_48px_-38px_rgba(48,33,24,0.35)]">
                            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--app-hint)]">
                                Navigation
                            </div>
                            <div className="mt-2 flex items-center gap-2 rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface-raised)] px-3 py-2.5">
                                <SearchIcon className="text-[var(--app-hint)]" />
                                <input
                                    value={searchQuery}
                                    onChange={(event) => setSearchQuery(event.target.value)}
                                    placeholder="Go to file"
                                    className="w-full bg-transparent text-sm text-[var(--app-fg)] placeholder:text-[var(--app-hint)] focus:outline-none"
                                    autoCapitalize="none"
                                    autoCorrect="off"
                                />
                            </div>
                            <div className="mt-3">
                                <RailSwitch value={railView} onChange={setRailView} />
                            </div>
                        </div>

                        <div className="min-h-0 flex-1 overflow-y-auto rounded-[30px] border border-[var(--app-border)] bg-[var(--app-secondary-bg)] p-3 shadow-[0_24px_56px_-42px_rgba(48,33,24,0.35)]">
                            {searchQuery ? (
                                searchInventory.isLoading ? (
                                    <EmptyRailState title="Searching files" body="Scanning the session workspace for matching files and folders." />
                                ) : searchInventory.error ? (
                                    <EmptyRailState title="Search unavailable" body={searchInventory.error} />
                                ) : rankedSearchResults.length === 0 ? (
                                    <EmptyRailState title="No matches found" body="Try a shorter file name, a different path fragment, or switch back to the tree." />
                                ) : (
                                    <div className="space-y-1">
                                        {rankedSearchResults.map((file, index) => (
                                            <SearchResultRow
                                                key={`${file.fullPath}-${index}`}
                                                file={file}
                                                active={file.fullPath === activePath}
                                                onOpen={() => openFileTab(file.fullPath)}
                                                showDivider={index < rankedSearchResults.length - 1}
                                            />
                                        ))}
                                    </div>
                                )
                            ) : railView === 'files' ? (
                                <DirectoryTree
                                    api={api}
                                    sessionId={sessionId}
                                    rootLabel={rootLabel}
                                    activePath={activePath}
                                    onOpenFile={(path) => handleOpenFile(path)}
                                />
                            ) : railView === 'open' ? (
                                openTabs.length ? (
                                    <div className="space-y-1">
                                        {openTabs.map((tab, index) => (
                                            <SearchResultRow
                                                key={tab.id}
                                                file={{
                                                    fileName: tab.fileName,
                                                    fullPath: tab.path,
                                                    filePath: getCompactParentPath(tab.path),
                                                    fileType: 'file'
                                                }}
                                                active={tab.id === activeTabId}
                                                metaLabel={tab.isEditing ? 'Editing' : null}
                                                onOpen={() => handleSelectTab(tab.id)}
                                                showDivider={index < openTabs.length - 1}
                                            />
                                        ))}
                                    </div>
                                ) : (
                                    <EmptyRailState title="No open files yet" body="Files you open stay here for quick switching while you work." />
                                )
                            ) : recentFileItems.length ? (
                                <div className="space-y-1">
                                    {recentFileItems.map((file, index) => (
                                        <SearchResultRow
                                            key={file.path}
                                            file={{
                                                fileName: file.fileName,
                                                fullPath: file.path,
                                                filePath: file.parentPath,
                                                fileType: 'file'
                                            }}
                                            active={file.path === activePath}
                                            onOpen={() => openFileTab(file.path)}
                                            showDivider={index < recentFileItems.length - 1}
                                        />
                                    ))}
                                </div>
                            ) : (
                                <EmptyRailState title="No recent files yet" body="Recent files will appear here once you start navigating the workspace." />
                            )}
                        </div>
                    </aside>

                    <section className="min-h-0 min-w-0 flex-1">
                        <div className="flex h-full min-h-0 flex-col rounded-[32px] border border-[var(--app-border)] bg-[var(--app-secondary-bg)] shadow-[0_28px_64px_-46px_rgba(48,33,24,0.38)]">
                            {activeTab ? (
                                <>
                                    <div className="border-b border-[var(--app-border)] px-4 py-4">
                                        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                                            <div className="min-w-0 flex-1">
                                                <ExplorerBreadcrumbs path={activeTab.path} />
                                                <div className="mt-3 flex items-start gap-3">
                                                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--app-surface-raised)]">
                                                        <FileIcon fileName={activeTab.fileName} size={22} />
                                                    </span>
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex flex-wrap items-center gap-2">
                                                            <div className="truncate text-lg font-semibold text-[var(--app-fg)]">
                                                                {activeTab.fileName}
                                                            </div>
                                                            {activeTab.isEditing ? (
                                                                <span className="rounded-full border border-[var(--app-border)] bg-[color:rgba(228,115,83,0.10)] px-2 py-0.5 text-[10px] font-semibold text-[var(--app-link)]">
                                                                    Editing
                                                                </span>
                                                            ) : null}
                                                        </div>
                                                        <div className="mt-1 truncate text-sm text-[var(--app-hint)]">{activeTab.path}</div>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex flex-wrap items-center gap-2">
                                                {activeTab.isEditing ? (
                                                    <>
                                                        <button
                                                            type="button"
                                                            onClick={handleDiscard}
                                                            disabled={isSaving}
                                                            className="rounded-full border border-[var(--app-border)] bg-[var(--app-surface-raised)] px-3.5 py-2 text-xs font-semibold text-[var(--app-hint)] transition-colors hover:bg-[var(--app-subtle-bg)] disabled:opacity-50"
                                                        >
                                                            Discard
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => { void handleSave() }}
                                                            disabled={!isDirty || isSaving}
                                                            className="rounded-full border border-[var(--app-border)] bg-[var(--app-button)] px-3.5 py-2 text-xs font-semibold text-[var(--app-button-text)] shadow-[0_16px_30px_-20px_var(--app-button-shadow)] transition-[transform,background-color] hover:-translate-y-px hover:bg-[var(--app-button-hover)] disabled:opacity-50"
                                                        >
                                                            {isSaving ? 'Saving…' : 'Save'}
                                                        </button>
                                                    </>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        onClick={handleStartEdit}
                                                        disabled={activeTab.binary || Boolean(activeTab.loadError)}
                                                        className="rounded-full border border-[var(--app-border)] bg-[var(--app-surface-raised)] px-3.5 py-2 text-xs font-semibold text-[var(--app-fg)] transition-colors hover:bg-[var(--app-subtle-bg)] disabled:opacity-50"
                                                    >
                                                        Edit file
                                                    </button>
                                                )}
                                            </div>
                                        </div>

                                        {openTabs.length ? (
                                            <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
                                                {openTabs.map((tab) => (
                                                    <div
                                                        key={tab.id}
                                                        className={`inline-flex max-w-[240px] items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                                                            tab.id === activeTabId
                                                                ? 'border-[var(--app-link)] bg-[color:rgba(228,115,83,0.10)] text-[var(--app-fg)]'
                                                                : 'border-[var(--app-border)] bg-[var(--app-surface-raised)] text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]'
                                                        }`}
                                                    >
                                                        <button
                                                            type="button"
                                                            onClick={() => handleSelectTab(tab.id)}
                                                            className="min-w-0 truncate text-left"
                                                        >
                                                            {tab.fileName}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleCloseTab(tab.id)}
                                                            className="shrink-0 rounded-full p-1 text-[var(--app-hint)] transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]"
                                                        >
                                                            <CloseIcon />
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : null}
                                    </div>

                                    <div className="min-h-0 flex-1 overflow-y-auto p-4">
                                        {activeFileQuery.isLoading ? (
                                            <div className="rounded-[28px] border border-[var(--app-border)] bg-[var(--app-code-bg)] px-5 py-6 text-sm text-[var(--app-hint)]">
                                                Loading file content…
                                            </div>
                                        ) : activeTab.loadError ? (
                                            <div className="rounded-[28px] border border-red-300/30 bg-red-500/10 px-5 py-4 text-sm text-red-600">
                                                {activeTab.loadError}
                                            </div>
                                        ) : activeTab.binary ? (
                                            <div className="rounded-[28px] border border-[var(--app-border)] bg-[var(--app-code-bg)] px-5 py-6 text-sm text-[var(--app-hint)]">
                                                This looks like a binary file, so Maglev keeps the document surface read-only here.
                                            </div>
                                        ) : activeTab.isEditing ? (
                                            <div className="space-y-3">
                                                <textarea
                                                    value={activeTab.draftContent}
                                                    onChange={(event) => handleDraftChange(event.target.value)}
                                                    spellCheck={false}
                                                    className="min-h-[60vh] w-full rounded-[28px] border border-[var(--app-border)] bg-[var(--app-code-bg)] p-4 font-mono text-xs text-[var(--app-fg)] outline-none focus:ring-2 focus:ring-[var(--app-link)]"
                                                />
                                                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--app-hint)]">
                                                    <span>{isDirty ? 'Unsaved changes' : 'No changes yet'}</span>
                                                    <span>{activeTab.draftContent.split('\n').length} lines</span>
                                                </div>
                                            </div>
                                        ) : activeContent ? (
                                            <CodeLinesView
                                                content={activeContent}
                                                filePath={activeTab.path}
                                                highlightedLine={highlightedLine}
                                                buildLink={activeDeepLink}
                                            />
                                        ) : (
                                            <div className="rounded-[28px] border border-[var(--app-border)] bg-[var(--app-code-bg)] px-5 py-6 text-sm text-[var(--app-hint)]">
                                                File is empty.
                                            </div>
                                        )}
                                    </div>
                                </>
                            ) : (
                                <div className="p-4">
                                    <DocumentEmptyState />
                                </div>
                            )}
                        </div>
                    </section>
                </div>
            </div>
        </div>
    )
}
