import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

function SearchResultRow(props: {
    file: FileSearchItem
    onOpen: () => void
    showDivider: boolean
}) {
    const subtitle = props.file.filePath || 'project root'
    const icon = props.file.fileType === 'file'
        ? <FileIcon fileName={props.file.fileName} size={22} />
        : <FolderIcon className="text-[var(--app-link)]" />

    return (
        <button
            type="button"
            onClick={props.onOpen}
            className={`flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-[var(--app-subtle-bg)] transition-colors ${props.showDivider ? 'border-b border-[var(--app-divider)]' : ''}`}
        >
            {icon}
            <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{props.file.fileName}</div>
                <div className="truncate text-xs text-[var(--app-hint)]">{subtitle}</div>
            </div>
        </button>
    )
}

function decodePath(value: string): string {
    if (!value) return ''
    const decoded = decodeBase64(value)
    return decoded.ok ? decoded.text : value
}

function getUtf8ByteLength(value: string): number {
    return new TextEncoder().encode(value).length
}

function isBinaryContent(content: string): boolean {
    if (!content) return false
    if (content.includes('\0')) return true
    const nonPrintable = content.split('').filter((char) => {
        const code = char.charCodeAt(0)
        return code < 32 && code !== 9 && code !== 10 && code !== 13
    }).length
    return nonPrintable / content.length > 0.1
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
    const [searchQuery, setSearchQuery] = useState('')
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
    const rootLabel = useMemo(() => {
        const base = session?.metadata?.path ?? sessionId
        const parts = base.split(/[/\\]/).filter(Boolean)
        return parts.length ? parts[parts.length - 1] : base
    }, [session?.metadata?.path, sessionId])

    const activeTab = useMemo(
        () => openTabs.find((tab) => tab.id === activeTabId) ?? null,
        [openTabs, activeTabId]
    )

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
    }, [searchPath])

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
        syncSearch(path, line ?? undefined)
    }, [syncSearch])

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
        syncSearch(next?.path ?? null, highlightedLine ?? null)
    }, [openTabs, syncSearch, highlightedLine])

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
        <div className="flex h-full flex-col">
            <div className="bg-[var(--app-bg)] pt-[env(safe-area-inset-top)]">
                <div className="flex w-full items-center gap-2 p-3 border-b border-[var(--app-border)]">
                    <button
                        type="button"
                        onClick={handleExplorerBack}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                    >
                        <BackIcon />
                    </button>
                    <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold">Explorer</div>
                        <div className="truncate text-xs text-[var(--app-hint)]">{session?.metadata?.path ?? subtitle}</div>
                    </div>
                    <button
                        type="button"
                        onClick={handleRefresh}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                        title="Refresh"
                    >
                        <RefreshIcon />
                    </button>
                </div>
            </div>

            {!session?.active ? (
                <div className="border-b border-[var(--app-divider)] bg-amber-500/10 px-3 py-2 text-sm text-[var(--app-hint)]">
                    Session is inactive. Explorer may be unavailable until the session is resumed.
                </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-x-auto">
                <div className="flex h-full min-h-0 min-w-[980px] flex-row">
                    <div className="flex w-[360px] shrink-0 flex-col border-r border-[var(--app-divider)] bg-[var(--app-bg)]">
                    <div className="p-3 border-b border-[var(--app-border)]">
                        <div className="flex items-center gap-2 rounded-md bg-[var(--app-subtle-bg)] px-3 py-2">
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
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto">
                        {searchQuery ? (
                            searchInventory.isLoading ? (
                                <div className="p-6 text-sm text-[var(--app-hint)]">Loading files…</div>
                            ) : searchInventory.error ? (
                                <div className="p-6 text-sm text-[var(--app-hint)]">{searchInventory.error}</div>
                            ) : rankedSearchResults.length === 0 ? (
                                <div className="p-6 text-sm text-[var(--app-hint)]">No files match your search.</div>
                            ) : (
                                <div className="border-t border-[var(--app-divider)]">
                                    {rankedSearchResults.map((file, index) => (
                                        <SearchResultRow
                                            key={`${file.fullPath}-${index}`}
                                            file={file}
                                            onOpen={() => openFileTab(file.fullPath)}
                                            showDivider={index < rankedSearchResults.length - 1}
                                        />
                                    ))}
                                </div>
                            )
                        ) : (
                            <DirectoryTree
                                api={api}
                                sessionId={sessionId}
                                rootLabel={rootLabel}
                                onOpenFile={(path) => handleOpenFile(path)}
                            />
                        )}
                    </div>
                    </div>

                    <div className="min-h-0 min-w-0 flex-1 bg-[var(--app-bg)]">
                        <div className="flex h-full min-h-0 flex-col">
                        <div className="border-b border-[var(--app-divider)] bg-[var(--app-bg)]">
                            <div className="flex min-h-[44px] items-end gap-1 overflow-x-auto px-2 pt-2">
                                {openTabs.map((tab) => (
                                    <div
                                        key={tab.id}
                                        className={`flex max-w-[240px] items-center gap-2 rounded-t-md border border-b-0 px-3 py-2 text-sm ${tab.id === activeTabId ? 'border-[var(--app-divider)] bg-[var(--app-secondary-bg)]' : 'border-transparent bg-[var(--app-subtle-bg)]'}`}
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
                                            className="shrink-0 rounded p-0.5 text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]"
                                        >
                                            <CloseIcon />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {activeTab ? (
                            <>
                                <div className="flex items-center gap-2 border-b border-[var(--app-divider)] px-3 py-2">
                                    <FileIcon fileName={activeTab.fileName} size={20} />
                                    <div className="min-w-0 flex-1">
                                        <div className="truncate text-sm font-medium">{activeTab.fileName}</div>
                                        <div className="truncate text-xs text-[var(--app-hint)]">{activeTab.path}</div>
                                    </div>
                                    {activeTab.isEditing ? (
                                        <>
                                            <button
                                                type="button"
                                                onClick={handleDiscard}
                                                disabled={isSaving}
                                                className="rounded px-3 py-1 text-xs font-semibold bg-[var(--app-subtle-bg)] text-[var(--app-hint)] disabled:opacity-50"
                                            >
                                                Discard
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => { void handleSave() }}
                                                disabled={!isDirty || isSaving}
                                                className="rounded px-3 py-1 text-xs font-semibold bg-[var(--app-button)] text-[var(--app-button-text)] disabled:opacity-50"
                                            >
                                                {isSaving ? 'Saving…' : 'Save'}
                                            </button>
                                        </>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={handleStartEdit}
                                            disabled={activeTab.binary || Boolean(activeTab.loadError)}
                                            className="rounded px-3 py-1 text-xs font-semibold bg-[var(--app-subtle-bg)] text-[var(--app-fg)] disabled:opacity-50"
                                        >
                                            Edit
                                        </button>
                                    )}
                                </div>

                                <div className="min-h-0 flex-1 overflow-y-auto p-4">
                                    {activeFileQuery.isLoading ? (
                                        <div className="rounded-md border border-[var(--app-border)] bg-[var(--app-code-bg)] p-4 text-sm text-[var(--app-hint)]">
                                            Loading file…
                                        </div>
                                    ) : activeTab.loadError ? (
                                        <div className="rounded-md bg-red-500/10 p-3 text-sm text-red-600">
                                            {activeTab.loadError}
                                        </div>
                                    ) : activeTab.binary ? (
                                        <div className="rounded-md border border-[var(--app-border)] bg-[var(--app-code-bg)] p-4 text-sm text-[var(--app-hint)]">
                                            This looks like a binary file. It cannot be displayed.
                                        </div>
                                    ) : activeTab.isEditing ? (
                                        <div className="space-y-2">
                                            <textarea
                                                value={activeTab.draftContent}
                                                onChange={(event) => handleDraftChange(event.target.value)}
                                                spellCheck={false}
                                                className="min-h-[60vh] w-full rounded-md border border-[var(--app-border)] bg-[var(--app-code-bg)] p-3 font-mono text-xs text-[var(--app-fg)] outline-none focus:ring-2 focus:ring-[var(--app-link)]"
                                            />
                                            <div className="flex items-center justify-between text-xs text-[var(--app-hint)]">
                                                <span>{isDirty ? 'Unsaved changes' : 'No changes'}</span>
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
                                        <div className="rounded-md border border-[var(--app-border)] bg-[var(--app-code-bg)] p-4 text-sm text-[var(--app-hint)]">
                                            File is empty.
                                        </div>
                                    )}
                                </div>
                            </>
                        ) : (
                            <div className="flex flex-1 items-center justify-center p-6 text-sm text-[var(--app-hint)]">
                                Select a file from the explorer to open it here.
                            </div>
                        )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
