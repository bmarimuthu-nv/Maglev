import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import { useAppContext } from '@/lib/app-context'
import { queryKeys } from '@/lib/query-keys'
import { decodeBase64, encodeBase64 } from '@/lib/utils'
import { isBinaryContent } from '@/lib/file-utils'
import type { FileReviewThread } from '@/types/api'
import { useShikiHighlighter, useShikiLines, resolveLanguageFromPath } from '@/lib/shiki'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'

function CloseIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
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

function ReviewThreadCard(props: {
    thread: FileReviewThread
    collapsed: boolean
    onToggleResolved: () => void
    onResolve: () => void
    onDelete: () => void
    onReply: (body: string) => void
    disabled?: boolean
}) {
    const [reply, setReply] = useState('')

    return (
        <div className="rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-3">
            <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-medium uppercase tracking-wide text-[var(--app-hint)]">
                    {props.thread.status === 'resolved' ? 'Resolved thread' : 'Open thread'}
                    {props.thread.orphaned ? ' • orphaned' : props.thread.resolvedLine ? ` • line ${props.thread.resolvedLine}` : ''}
                </div>
                <div className="flex items-center gap-2">
                    {props.thread.status === 'resolved' ? (
                        <button
                            type="button"
                            onClick={props.onToggleResolved}
                            className="rounded border border-[var(--app-border)] px-2 py-1 text-xs hover:bg-[var(--app-subtle-bg)]"
                        >
                            {props.collapsed ? 'Expand' : 'Collapse'}
                        </button>
                    ) : null}
                    <button
                        type="button"
                        disabled={props.disabled}
                        onClick={props.onResolve}
                        className="rounded border border-[var(--app-border)] px-2 py-1 text-xs hover:bg-[var(--app-subtle-bg)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {props.thread.status === 'resolved' ? 'Reopen' : 'Resolve'}
                    </button>
                    <button
                        type="button"
                        disabled={props.disabled}
                        onClick={props.onDelete}
                        className="rounded border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        Delete
                    </button>
                </div>
            </div>

            {props.collapsed ? null : (
                <>
                    <div className="mt-3 space-y-3">
                        {props.thread.comments.map((comment) => (
                            <div key={comment.id} className="rounded-md bg-[var(--app-subtle-bg)] px-3 py-2">
                                <div className="flex items-center justify-between gap-3 text-xs text-[var(--app-hint)]">
                                    <span>{comment.author}</span>
                                    <span>{new Date(comment.createdAt).toLocaleString()}</span>
                                </div>
                                <div className="mt-1 whitespace-pre-wrap text-sm text-[var(--app-fg)]">{comment.body}</div>
                            </div>
                        ))}
                    </div>
                    <div className="mt-3">
                        <textarea
                            value={reply}
                            onChange={(event) => setReply(event.target.value)}
                            placeholder="Reply to thread"
                            className="min-h-20 w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)]"
                        />
                        <div className="mt-2 flex justify-end">
                            <button
                                type="button"
                                disabled={props.disabled || !reply.trim()}
                                onClick={() => {
                                    const next = reply.trim()
                                    if (!next) {
                                        return
                                    }
                                    props.onReply(next)
                                    setReply('')
                                }}
                                className="rounded-md bg-[var(--app-link)] px-3 py-2 text-sm font-medium text-[var(--app-button-text)] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                Reply
                            </button>
                        </div>
                    </div>
                </>
            )}
        </div>
    )
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
    const language = useMemo(() => resolveLanguageFromPath(filePath), [filePath])
    const highlighted = useShikiHighlighter(content, markdown ? undefined : language)
    const sourceLines = useMemo(() => normalizeSourceLines(content), [content])
    const highlightedSourceLines = useShikiLines(sourceLines.join('\n'), language)
    const fileName = filePath.split('/').pop() ?? filePath

    const [viewMode, setViewMode] = useState<'rendered' | 'source'>('rendered')
    const [panelMode, setPanelMode] = useState<'view' | 'review'>('view')
    const [isEditing, setIsEditing] = useState(false)
    const [draft, setDraft] = useState('')
    const [isSaving, setIsSaving] = useState(false)
    const [saveError, setSaveError] = useState<string | null>(null)
    const [reviewError, setReviewError] = useState<string | null>(null)
    const [reviewSaving, setReviewSaving] = useState(false)
    const [composerLine, setComposerLine] = useState<number | null>(null)
    const [composerText, setComposerText] = useState('')
    const [collapsedResolvedThreadIds, setCollapsedResolvedThreadIds] = useState<Record<string, boolean>>({})

    useEffect(() => {
        setViewMode('rendered')
        setPanelMode('view')
        setIsEditing(false)
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
        setIsEditing(false)
        setDraft('')
        setSaveError(null)
    }, [panelMode])

    const startEditing = useCallback(() => {
        setDraft(content)
        setIsEditing(true)
        setPanelMode('view')
        setViewMode('source')
        setReviewError(null)
    }, [content])

    const cancelEditing = useCallback(() => {
        setIsEditing(false)
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
            setIsEditing(false)
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

    const isDirty = isEditing && draft !== content
    const reviewThreads = reviewThreadsQuery.data?.success ? (reviewThreadsQuery.data.threads ?? []) : []
    const reviewStoreScope = reviewThreadsQuery.data?.success ? reviewThreadsQuery.data.storageScope : undefined
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

    const renderThreadCard = useCallback((thread: FileReviewThread) => (
        <ReviewThreadCard
            key={thread.id}
            thread={thread}
            collapsed={thread.status === 'resolved' && collapsedResolvedThreadIds[thread.id] !== false}
            disabled={reviewSaving}
            onToggleResolved={() => {
                setCollapsedResolvedThreadIds((current) => ({
                    ...current,
                    [thread.id]: current[thread.id] === false ? true : false
                }))
            }}
            onResolve={() => {
                void runReviewMutation(() => api?.setSessionFileReviewThreadStatus(
                    sessionId,
                    thread.id,
                    thread.status === 'resolved' ? 'open' : 'resolved'
                ) ?? Promise.resolve({ success: false, error: 'API unavailable' }))
            }}
            onDelete={() => {
                if (!window.confirm('Delete this review thread permanently?')) {
                    return
                }
                void runReviewMutation(() => api?.deleteSessionFileReviewThread(sessionId, thread.id)
                    ?? Promise.resolve({ success: false, error: 'API unavailable' }))
            }}
            onReply={(body) => {
                void runReviewMutation(() => api?.replyToSessionFileReviewThread(sessionId, thread.id, {
                    body,
                    author: 'user'
                }) ?? Promise.resolve({ success: false, error: 'API unavailable' }))
            }}
        />
    ), [api, collapsedResolvedThreadIds, reviewSaving, runReviewMutation, sessionId])

    return (
        <div className="flex h-full w-full flex-col overflow-hidden">
            <div className="flex items-center gap-2 border-b border-[var(--app-border)] px-3 py-2">
                <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium" title={filePath}>{fileName}</div>
                    <div className="truncate text-[11px] text-[var(--app-hint)]">{filePath}</div>
                </div>
                {!binary && !isEditing ? (
                    <div className="flex shrink-0 items-center rounded-md border border-[var(--app-border)] text-[11px]">
                        <button
                            type="button"
                            onClick={() => setPanelMode('view')}
                            className={`px-2 py-1 transition-colors ${panelMode === 'view' ? 'bg-[var(--app-link)] text-[var(--app-button-text)]' : 'text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]'}`}
                        >
                            View
                        </button>
                        <button
                            type="button"
                            onClick={() => setPanelMode('review')}
                            className={`px-2 py-1 transition-colors ${panelMode === 'review' ? 'bg-[var(--app-link)] text-[var(--app-button-text)]' : 'text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]'}`}
                        >
                            Review
                        </button>
                    </div>
                ) : null}
                {markdown && !isEditing && panelMode === 'view' ? (
                    <div className="flex shrink-0 items-center rounded-md border border-[var(--app-border)] text-[11px]">
                        <button
                            type="button"
                            onClick={() => setViewMode('rendered')}
                            className={`px-2 py-1 rounded-l-md transition-colors ${viewMode === 'rendered' ? 'bg-[var(--app-link)] text-[var(--app-button-text)]' : 'text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]'}`}
                        >
                            Preview
                        </button>
                        <button
                            type="button"
                            onClick={() => setViewMode('source')}
                            className={`px-2 py-1 rounded-r-md transition-colors ${viewMode === 'source' ? 'bg-[var(--app-link)] text-[var(--app-button-text)]' : 'text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]'}`}
                        >
                            Source
                        </button>
                    </div>
                ) : null}
                {!isEditing && !binary && panelMode === 'view' ? (
                    <button
                        type="button"
                        onClick={startEditing}
                        className="shrink-0 rounded-md border border-[var(--app-border)] px-2 py-1 text-[11px] text-[var(--app-fg)] transition-colors hover:bg-[var(--app-subtle-bg)]"
                    >
                        Edit
                    </button>
                ) : null}
                <button
                    type="button"
                    onClick={onClose}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                    title="Close preview"
                >
                    <CloseIcon />
                </button>
            </div>

            {isEditing ? (
                <div className="flex items-center gap-2 border-b border-[var(--app-border)] px-3 py-1.5">
                    <button
                        type="button"
                        onClick={() => void saveFile()}
                        disabled={isSaving || !isDirty}
                        className="rounded-md bg-[var(--app-link)] px-2.5 py-1 text-[11px] font-medium text-[var(--app-button-text)] disabled:opacity-50"
                    >
                        {isSaving ? 'Saving…' : 'Save'}
                    </button>
                    <button
                        type="button"
                        onClick={cancelEditing}
                        disabled={isSaving}
                        className="rounded-md border border-[var(--app-border)] px-2.5 py-1 text-[11px] text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    {saveError ? <span className="text-[11px] text-red-500">{saveError}</span> : null}
                    {isDirty ? <span className="text-[11px] text-[var(--app-hint)]">Unsaved changes</span> : null}
                </div>
            ) : panelMode === 'review' && !binary ? (
                <div className="flex flex-wrap items-center gap-2 border-b border-[var(--app-border)] px-3 py-1.5 text-[11px]">
                    <span className="rounded-full border border-[var(--app-border)] px-2 py-1 text-[var(--app-fg)]">
                        Comment threads only
                    </span>
                    <span className="text-[var(--app-hint)]">
                        {reviewStoreScope === 'git'
                            ? 'Stored in git metadata for this repo/worktree'
                            : 'Stored in a local workspace review folder'}
                    </span>
                    {reviewSaving ? <span className="text-[var(--app-hint)]">Saving…</span> : null}
                    {reviewThreadsQuery.isLoading ? <span className="text-[var(--app-hint)]">Loading threads…</span> : null}
                    {reviewError ? <span className="text-red-500">{reviewError}</span> : null}
                    {reviewThreadsQuery.data && !reviewThreadsQuery.data.success ? (
                        <span className="text-red-500">{reviewThreadsQuery.data.error ?? 'Failed to load review threads'}</span>
                    ) : null}
                </div>
            ) : null}

            <div className="flex-1 overflow-auto">
                {fileQuery.isLoading ? (
                    <div className="p-4 text-sm text-[var(--app-hint)]">Loading…</div>
                ) : fileQuery.error ? (
                    <div className="p-4 text-sm text-red-500">
                        {fileQuery.error instanceof Error ? fileQuery.error.message : 'Failed to load file'}
                    </div>
                ) : binary ? (
                    <div className="p-4 text-sm text-[var(--app-hint)]">Binary file cannot be displayed.</div>
                ) : isEditing ? (
                    <textarea
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        className="h-full w-full resize-none bg-[var(--app-code-bg)] p-4 font-mono text-xs text-[var(--app-fg)] focus:outline-none"
                        spellCheck={false}
                    />
                ) : panelMode === 'review' ? (
                    <div className="overflow-hidden rounded-none bg-[var(--app-code-bg)]">
                        {sourceLines.map((line, index) => {
                            const lineNumber = index + 1
                            const threads = lineThreads.get(lineNumber) ?? []
                            const showComposer = composerLine === lineNumber
                            const syntaxLine = highlightedSourceLines?.[index]
                            return (
                                <div key={`${lineNumber}-${line}`} className="border-b border-[var(--app-divider)] last:border-b-0">
                                    <div className={`flex items-start gap-3 px-4 py-1.5 font-mono text-[12px] leading-[1.45] ${showComposer ? 'bg-[var(--app-link)]/5' : 'hover:bg-[var(--app-subtle-bg)]'}`}>
                                        <button
                                            type="button"
                                            disabled={reviewSaving}
                                            onClick={() => {
                                                setComposerLine(lineNumber)
                                                setComposerText('')
                                            }}
                                            className="mt-0.5 h-5 w-5 shrink-0 rounded border border-[var(--app-border)] text-[10px] text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] disabled:cursor-not-allowed disabled:opacity-40"
                                            title={`Add comment on line ${lineNumber}`}
                                        >
                                            +
                                        </button>
                                        <div className="w-12 shrink-0 text-right text-[var(--app-hint)]">
                                            {lineNumber}
                                        </div>
                                        <div className="shiki min-w-0 flex-1 whitespace-pre-wrap break-words text-[var(--app-fg)]">
                                            {syntaxLine ?? (line || ' ')}
                                        </div>
                                    </div>
                                    {showComposer ? (
                                        <div className="border-t border-[var(--app-divider)] bg-[var(--app-bg)] px-4 py-3">
                                            <textarea
                                                value={composerText}
                                                onChange={(event) => setComposerText(event.target.value)}
                                                placeholder={`Add comment for line ${lineNumber}`}
                                                className="min-h-24 w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)]"
                                            />
                                            <div className="mt-2 flex justify-end gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setComposerLine(null)
                                                        setComposerText('')
                                                    }}
                                                    className="rounded-md border border-[var(--app-border)] px-3 py-2 text-sm"
                                                >
                                                    Cancel
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={reviewSaving || !composerText.trim()}
                                                    onClick={() => {
                                                        void handleCreateThread(lineNumber)
                                                    }}
                                                    className="rounded-md bg-[var(--app-link)] px-3 py-2 text-sm font-medium text-[var(--app-button-text)] disabled:cursor-not-allowed disabled:opacity-50"
                                                >
                                                    Save comment
                                                </button>
                                            </div>
                                        </div>
                                    ) : null}
                                    {threads.length > 0 ? (
                                        <div className="space-y-2 border-t border-[var(--app-divider)] bg-[var(--app-secondary-bg)] px-4 py-3">
                                            {threads.map((thread) => renderThreadCard(thread))}
                                        </div>
                                    ) : null}
                                </div>
                            )
                        })}
                        {orphanedThreads.length > 0 ? (
                            <div className="border-t border-[var(--app-border)] bg-[var(--app-bg)] px-4 py-4">
                                <div className="mb-2 text-sm font-medium">Orphaned threads</div>
                                <div className="space-y-2">
                                    {orphanedThreads.map((thread) => renderThreadCard(thread))}
                                </div>
                            </div>
                        ) : null}
                    </div>
                ) : markdown && viewMode === 'rendered' ? (
                    <div className="p-4">
                        <MarkdownRenderer content={content} />
                    </div>
                ) : (
                    <pre className="shiki overflow-auto p-4 text-xs font-mono bg-[var(--app-code-bg)]">
                        <code>{highlighted ?? content}</code>
                    </pre>
                )}
            </div>
        </div>
    )
}
