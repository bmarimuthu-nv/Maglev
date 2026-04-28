import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import { FileIcon } from '@/components/FileIcon'
import { CodeLinesView, type CodeLinesViewHandle } from '@/components/SessionFiles/CodeLinesView'
import { CodeEditSurface, type CodeEditSurfaceHandle } from '@/components/SessionFiles/CodeEditSurface'
import { useAppContext } from '@/lib/app-context'
import { queryKeys } from '@/lib/query-keys'
import { decodeBase64, encodeBase64 } from '@/lib/utils'
import { isBinaryContent } from '@/lib/file-utils'
import type { FileReviewThread } from '@/types/api'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'
import { SourceReviewFileCard } from '@/components/review/SourceReviewFileCard'

function CloseIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
    )
}

function ReloadIcon(props: { spinning?: boolean }) {
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
            className={props.spinning ? 'animate-spin' : undefined}
        >
            <path d="M21 2v6h-6" />
            <path d="M3 12a9 9 0 0 1 15.5-6.36L21 8" />
            <path d="M3 22v-6h6" />
            <path d="M21 12a9 9 0 0 1-15.5 6.36L3 16" />
        </svg>
    )
}

function ArrowDownIcon() {
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
        >
            <path d="M12 5v14" />
            <path d="m19 12-7 7-7-7" />
        </svg>
    )
}

function isMarkdownFile(filePath: string): boolean {
    return /\.(md|mdx|markdown)$/i.test(filePath)
}

function normalizeSourceLines(content: string): string[] {
    const normalized = content.replace(/\r\n/g, '\n')
    const lines = normalized.split('\n')
    return lines.length > 0 ? lines : ['']
}

export function FilePreviewPanel(props: {
    sessionId: string
    filePath: string
    api: ApiClient | null
    onClose: () => void
}) {
    const { scopeKey } = useAppContext()
    const { sessionId, filePath, api, onClose } = props
    const queryClient = useQueryClient()

    const fileQuery = useQuery({
        queryKey: queryKeys.sessionFile(scopeKey, sessionId, filePath),
        queryFn: async () => {
            if (!api) throw new Error('API unavailable')
            return await api.readSessionFile(sessionId, filePath)
        },
        enabled: Boolean(api && filePath),
        retry: false,
    })

    const reviewThreadsQuery = useQuery({
        queryKey: queryKeys.sessionFileReviewThreads(scopeKey, sessionId, filePath),
        queryFn: async () => {
            if (!api) throw new Error('API unavailable')
            return await api.getSessionFileReviewThreads(sessionId, filePath)
        },
        enabled: Boolean(api && filePath),
        retry: false
    })

    const decoded = fileQuery.data?.success && fileQuery.data.content
        ? decodeBase64(fileQuery.data.content)
        : { text: '', ok: true }
    const content = decoded.text
    const fileHash = fileQuery.data?.success ? (fileQuery.data.hash ?? null) : null
    const binary = fileQuery.data?.success ? (!decoded.ok || isBinaryContent(content)) : false
    const markdown = isMarkdownFile(filePath)
    const sourceLines = useMemo(() => normalizeSourceLines(content), [content])
    const fileName = filePath.split('/').pop() ?? filePath
    const buildPreviewLink = useCallback((line: number) => `${window.location.href.split('#')[0]}#L${line}`, [])

    const [viewMode, setViewMode] = useState<'rendered' | 'source'>('rendered')
    const [panelMode, setPanelMode] = useState<'read' | 'review' | 'edit'>('read')
    const [draft, setDraft] = useState('')
    const [isSaving, setIsSaving] = useState(false)
    const [saveError, setSaveError] = useState<string | null>(null)
    const [reviewError, setReviewError] = useState<string | null>(null)
    const [reviewSaving, setReviewSaving] = useState(false)
    const [composerLine, setComposerLine] = useState<number | null>(null)
    const [composerText, setComposerText] = useState('')
    const [collapsedResolvedThreadIds, setCollapsedResolvedThreadIds] = useState<Record<string, boolean>>({})
    const codeViewRef = useRef<CodeLinesViewHandle | null>(null)
    const reviewViewRef = useRef<CodeLinesViewHandle | null>(null)
    const editViewRef = useRef<CodeEditSurfaceHandle | null>(null)
    const isEditing = panelMode === 'edit'

    useEffect(() => {
        setViewMode('rendered')
        setPanelMode('read')
        setDraft('')
        setSaveError(null)
        setReviewError(null)
        setComposerLine(null)
        setComposerText('')
        setCollapsedResolvedThreadIds({})
    }, [filePath])

    useEffect(() => {
        if (panelMode !== 'review') {
            return
        }
        setViewMode('source')
        setDraft('')
        setSaveError(null)
    }, [panelMode])

    const startEditing = useCallback(() => {
        setDraft(content)
        setPanelMode('edit')
        setViewMode('source')
        setReviewError(null)
    }, [content])

    const cancelEditing = useCallback(() => {
        setPanelMode('read')
        setDraft('')
        setSaveError(null)
    }, [])

    const saveFile = useCallback(async () => {
        if (!api || isSaving) return
        setIsSaving(true)
        setSaveError(null)
        try {
            const result = await api.writeSessionFile(sessionId, filePath, encodeBase64(draft), fileHash)
            if (!result.success) {
                throw new Error(result.error ?? 'Failed to save file')
            }
            setPanelMode('read')
            await fileQuery.refetch()
            await reviewThreadsQuery.refetch()
        } catch (error) {
            setSaveError(error instanceof Error ? error.message : 'Failed to save')
        } finally {
            setIsSaving(false)
        }
    }, [api, draft, fileHash, filePath, fileQuery, isSaving, reviewThreadsQuery, sessionId])

    const invalidateReviewThreads = useCallback(async () => {
        await queryClient.invalidateQueries({ queryKey: queryKeys.sessionFileReviewThreads(scopeKey, sessionId, filePath) })
        await reviewThreadsQuery.refetch()
    }, [filePath, queryClient, reviewThreadsQuery, scopeKey, sessionId])

    const runReviewMutation = useCallback(async (mutate: () => Promise<{ success: boolean; error?: string }>) => {
        setReviewSaving(true)
        setReviewError(null)
        try {
            const result = await mutate()
            if (!result.success) {
                throw new Error(result.error ?? 'Failed to update review threads')
            }
            await invalidateReviewThreads()
        } catch (error) {
            setReviewError(error instanceof Error ? error.message : 'Failed to update review threads')
        } finally {
            setReviewSaving(false)
        }
    }, [invalidateReviewThreads])

    const handleRefresh = useCallback(async () => {
        if (!api || isEditing || isSaving || reviewSaving) {
            return
        }
        setSaveError(null)
        setReviewError(null)
        await Promise.all([
            fileQuery.refetch(),
            reviewThreadsQuery.refetch(),
        ])
    }, [api, fileQuery, isEditing, isSaving, reviewSaving, reviewThreadsQuery])

    const isDirty = isEditing && draft !== content
    const isRefreshing = (fileQuery.isFetching && !fileQuery.isLoading) || (reviewThreadsQuery.isFetching && !reviewThreadsQuery.isLoading)
    const reviewThreads = reviewThreadsQuery.data?.success ? (reviewThreadsQuery.data.threads ?? []) : []
    const lineThreads = useMemo(() => {
        const map = new Map<number, FileReviewThread[]>()
        for (const thread of reviewThreads) {
            if (thread.orphaned || thread.resolvedLine == null) {
                continue
            }
            const existing = map.get(thread.resolvedLine) ?? []
            existing.push(thread)
            map.set(thread.resolvedLine, existing)
        }
        return map
    }, [reviewThreads])
    const orphanedThreads = useMemo(
        () => reviewThreads.filter((thread) => thread.orphaned || thread.resolvedLine == null),
        [reviewThreads]
    )
    const unresolvedCount = useMemo(
        () => reviewThreads.filter((thread) => thread.status !== 'resolved').length,
        [reviewThreads]
    )

    const handleScrollToBottom = useCallback(() => {
        if (isEditing) {
            editViewRef.current?.scrollToBottom()
            return
        }
        if (panelMode === 'review') {
            reviewViewRef.current?.scrollToBottom()
            return
        }
        codeViewRef.current?.scrollToBottom()
    }, [isEditing, panelMode])

    const handleCreateThread = useCallback(async (line: number) => {
        const body = composerText.trim()
        if (!api || !body) {
            return
        }
        await runReviewMutation(() => api.createSessionFileReviewThread(sessionId, {
            path: filePath,
            line,
            body,
            author: 'user'
        }))
        setComposerLine(null)
        setComposerText('')
    }, [api, composerText, filePath, runReviewMutation, sessionId])

    const toggleCollapsedThread = useCallback((threadId: string) => {
        setCollapsedResolvedThreadIds((current) => ({
            ...current,
            [threadId]: current[threadId] === false ? true : false
        }))
    }, [])

    const handleResolveThread = useCallback((thread: FileReviewThread) => {
        void runReviewMutation(() => api?.setSessionFileReviewThreadStatus(
            sessionId,
            thread.id,
            thread.status === 'resolved' ? 'open' : 'resolved'
        ) ?? Promise.resolve({ success: false, error: 'API unavailable' }))
    }, [api, runReviewMutation, sessionId])

    const handleDeleteThread = useCallback((thread: FileReviewThread) => {
        if (!window.confirm('Delete this review thread permanently?')) {
            return
        }
        void runReviewMutation(() => api?.deleteSessionFileReviewThread(sessionId, thread.id)
            ?? Promise.resolve({ success: false, error: 'API unavailable' }))
    }, [api, runReviewMutation, sessionId])

    const handleReplyToThread = useCallback((thread: FileReviewThread, body: string) => {
        void runReviewMutation(() => api?.replyToSessionFileReviewThread(sessionId, thread.id, {
            body,
            author: 'user'
        }) ?? Promise.resolve({ success: false, error: 'API unavailable' }))
    }, [api, runReviewMutation, sessionId])

    return (
        <div className="flex h-full w-full flex-col overflow-hidden">
            <div className="border-b border-[var(--app-border)] px-4 py-4">
                <div className="flex items-start gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--app-surface-raised)]">
                        <FileIcon fileName={fileName} size={22} />
                    </span>
                    <div className="min-w-0 flex-1">
                        <div className="truncate text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--app-hint)]">
                            File preview
                        </div>
                        <div className="mt-1 truncate text-base font-semibold text-[var(--app-fg)]" title={filePath}>
                            {fileName}
                        </div>
                        <div className="truncate text-xs text-[var(--app-hint)]">{filePath}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                        <button
                            type="button"
                            onClick={() => void handleRefresh()}
                            disabled={!api || isEditing || isSaving || reviewSaving || fileQuery.isLoading}
                            className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--app-border)] bg-[var(--app-surface-raised)] text-[var(--app-hint)] transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)] disabled:cursor-not-allowed disabled:opacity-50"
                            title={isRefreshing ? 'Reloading file and review threads' : 'Reload file and review threads'}
                        >
                            <ReloadIcon spinning={isRefreshing} />
                        </button>
                        <button
                            type="button"
                            onClick={handleScrollToBottom}
                            disabled={fileQuery.isLoading || binary}
                            className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--app-border)] bg-[var(--app-surface-raised)] text-[var(--app-hint)] transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)] disabled:cursor-not-allowed disabled:opacity-50"
                            title="Scroll to bottom"
                        >
                            <ArrowDownIcon />
                        </button>
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--app-border)] bg-[var(--app-surface-raised)] text-[var(--app-hint)] transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]"
                            title="Close preview"
                        >
                            <CloseIcon />
                        </button>
                    </div>
                </div>

                {!binary ? (
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                        <div className="flex shrink-0 items-center rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface-raised)] p-1 text-[11px]">
                            {([
                                ['read', 'Code'],
                                ['review', 'Review'],
                                ['edit', 'Edit']
                            ] as const).map(([value, label]) => (
                                <button
                                    key={value}
                                    type="button"
                                    onClick={() => {
                                        if (value === 'edit') {
                                            if (isEditing) {
                                                return
                                            }
                                            startEditing()
                                            return
                                        }
                                        if (isEditing) {
                                            cancelEditing()
                                        }
                                        setPanelMode(value)
                                    }}
                                    className={`rounded-xl px-3 py-1.5 font-semibold transition-colors ${
                                        panelMode === value
                                            ? 'bg-[var(--app-button)] text-[var(--app-button-text)] shadow-[0_12px_24px_-18px_var(--app-button-shadow)]'
                                            : 'text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]'
                                    }`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                        {markdown && panelMode === 'read' ? (
                            <div className="flex shrink-0 items-center rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface-raised)] p-1 text-[11px]">
                                <button
                                    type="button"
                                    onClick={() => setViewMode('rendered')}
                                    className={`rounded-xl px-3 py-1.5 font-semibold transition-colors ${
                                        viewMode === 'rendered'
                                            ? 'bg-[var(--app-button)] text-[var(--app-button-text)] shadow-[0_12px_24px_-18px_var(--app-button-shadow)]'
                                            : 'text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]'
                                    }`}
                                >
                                    Rendered
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setViewMode('source')}
                                    className={`rounded-xl px-3 py-1.5 font-semibold transition-colors ${
                                        viewMode === 'source'
                                            ? 'bg-[var(--app-button)] text-[var(--app-button-text)] shadow-[0_12px_24px_-18px_var(--app-button-shadow)]'
                                            : 'text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]'
                                    }`}
                                >
                                    Source
                                </button>
                            </div>
                        ) : null}
                        {panelMode === 'review' ? (
                            <>
                                <span className="rounded-full border border-[var(--app-border)] bg-[var(--app-surface-raised)] px-2.5 py-1 text-[11px] font-semibold text-[var(--app-fg)]">
                                    {reviewThreads.length} thread{reviewThreads.length === 1 ? '' : 's'}
                                </span>
                                <span className="rounded-full border border-[var(--app-border)] bg-[var(--app-surface-raised)] px-2.5 py-1 text-[11px] font-semibold text-[var(--app-hint)]">
                                    {unresolvedCount} unresolved
                                </span>
                            </>
                        ) : null}
                    </div>
                ) : null}
            </div>

            {isEditing ? (
                <div className="flex flex-wrap items-center gap-2 border-b border-[var(--app-border)] bg-[var(--app-surface-raised)] px-4 py-2">
                    <button
                        type="button"
                        onClick={() => void saveFile()}
                        disabled={isSaving || !isDirty}
                        className="rounded-full bg-[var(--app-button)] px-3 py-1.5 text-[11px] font-semibold text-[var(--app-button-text)] disabled:opacity-50"
                    >
                        {isSaving ? 'Saving…' : 'Save'}
                    </button>
                    <button
                        type="button"
                        onClick={cancelEditing}
                        disabled={isSaving}
                        className="rounded-full border border-[var(--app-border)] px-3 py-1.5 text-[11px] font-semibold text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    {saveError ? <span className="text-[11px] text-[var(--app-badge-error-text)]">{saveError}</span> : null}
                    {isDirty ? <span className="text-[11px] text-[var(--app-hint)]">Unsaved changes</span> : null}
                </div>
            ) : panelMode === 'review' && !binary ? (
                <div className="flex flex-wrap items-center gap-2 border-b border-[var(--app-border)] bg-[var(--app-surface-raised)] px-4 py-2 text-[11px]">
                    <span className="rounded-full bg-[var(--review-accent-bg)] px-2.5 py-1 font-semibold text-[var(--review-accent)]">
                        Review annotations
                    </span>
                    <span className="text-[var(--app-hint)]">{reviewThreads.length} total threads</span>
                    <span className="text-[var(--app-hint)]">{unresolvedCount} unresolved</span>
                    {reviewSaving ? <span className="text-[var(--app-hint)]">Saving…</span> : null}
                    {reviewThreadsQuery.isLoading ? <span className="text-[var(--app-hint)]">Loading threads…</span> : null}
                    {reviewError ? <span className="text-[var(--app-badge-error-text)]">{reviewError}</span> : null}
                    {reviewThreadsQuery.data && !reviewThreadsQuery.data.success ? (
                        <span className="text-[var(--app-badge-error-text)]">{reviewThreadsQuery.data.error ?? 'Failed to load review threads'}</span>
                    ) : null}
                </div>
            ) : null}

            <div className="flex-1 overflow-auto">
                {fileQuery.isLoading ? (
                    <div className="p-4">
                        <div className="rounded-[24px] border border-[var(--app-border)] bg-[var(--app-surface-raised)] px-4 py-6 text-sm text-[var(--app-hint)]">
                            Loading preview…
                        </div>
                    </div>
                ) : fileQuery.error ? (
                    <div className="p-4">
                        <div className="rounded-[24px] border border-[var(--app-badge-error-border)] bg-[var(--app-badge-error-bg)] px-4 py-4 text-sm text-[var(--app-badge-error-text)]">
                            {fileQuery.error instanceof Error ? fileQuery.error.message : 'Failed to load file'}
                        </div>
                    </div>
                ) : binary ? (
                    <div className="p-4">
                        <div className="rounded-[24px] border border-[var(--app-border)] bg-[var(--app-surface-raised)] px-4 py-6 text-sm text-[var(--app-hint)]">
                            Binary file cannot be displayed in the inline preview.
                        </div>
                    </div>
                ) : isEditing ? (
                    <CodeEditSurface
                        ref={editViewRef}
                        draft={draft}
                        filePath={filePath}
                        onChange={setDraft}
                    />
                ) : panelMode === 'review' ? (
                    <div className="p-4">
                        <SourceReviewFileCard
                            codeViewRef={reviewViewRef}
                            filePath={filePath}
                            sourceLines={sourceLines}
                            reviewSaving={reviewSaving}
                            reviewThreads={reviewThreads}
                            lineThreads={lineThreads}
                            orphanedThreads={orphanedThreads}
                            composerLine={composerLine}
                            composerText={composerText}
                            collapsedResolvedThreadIds={collapsedResolvedThreadIds}
                            onComposerLineChange={setComposerLine}
                            onComposerTextChange={setComposerText}
                            onCreateThread={(lineNumber) => {
                                void handleCreateThread(lineNumber)
                            }}
                            onToggleResolvedCollapse={toggleCollapsedThread}
                            onResolveThread={handleResolveThread}
                            onDeleteThread={handleDeleteThread}
                            onReplyToThread={handleReplyToThread}
                        />
                    </div>
                ) : markdown && viewMode === 'rendered' ? (
                    <div className="p-4">
                        <MarkdownRenderer content={content} />
                    </div>
                ) : (
                    <div className="p-4">
                        <CodeLinesView
                            ref={codeViewRef}
                            content={content}
                            filePath={filePath}
                            buildLink={buildPreviewLink}
                        />
                    </div>
                )}
            </div>
        </div>
    )
}
