import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useAppContext } from '@/lib/app-context'
import { useSession } from '@/hooks/queries/useSession'
import { LoadingState } from '@/components/LoadingState'
import { openSessionExplorerWindow } from '@/utils/sessionExplorer'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { decodeBase64, encodeBase64 } from '@/lib/utils'
import { queryKeys } from '@/lib/query-keys'
import { REVIEW_FILE_PATH, createEmptyReviewFile, parseReviewFile, type ReviewComment, type ReviewFile, type ReviewMode, type ReviewThread } from '@/lib/review-file'
import { parseUnifiedDiff, type ParsedDiffLine } from '@/lib/unified-diff'
import { useShikiLines, resolveLanguageFromPath } from '@/lib/shiki'

function BackIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
        </svg>
    )
}

function RefreshIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a9 9 0 1 1-3-6.7" />
            <polyline points="21 3 21 9 15 9" />
        </svg>
    )
}

function getAnchorKey(side: 'left' | 'right', line: number): string {
    return `${side}:${line}`
}

function buildThreadAnchor(line: ParsedDiffLine): ReviewThread['anchor'] | null {
    if (line.kind === 'add') {
        return { side: 'right', line: line.newLine, preview: line.text }
    }
    if (line.kind === 'delete') {
        return { side: 'left', line: line.oldLine, preview: line.text }
    }
    if (line.kind === 'context') {
        return { side: 'right', line: line.newLine, preview: line.text }
    }
    return null
}

function generateId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID()
    }
    return `review-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

type ReviewThreadCardProps = {
    thread: ReviewThread
    collapsed: boolean
    onToggleResolved: () => void
    onResolve: () => void
    onDelete: () => void
    onReply: (body: string) => void
}

function ReviewThreadCard(props: ReviewThreadCardProps) {
    const [reply, setReply] = useState('')

    return (
        <div className="rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-3">
            <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-medium uppercase tracking-wide text-[var(--app-hint)]">
                    {props.thread.status === 'resolved' ? 'Resolved thread' : 'Open thread'}
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
                        onClick={props.onResolve}
                        className="rounded border border-[var(--app-border)] px-2 py-1 text-xs hover:bg-[var(--app-subtle-bg)]"
                    >
                        {props.thread.status === 'resolved' ? 'Reopen' : 'Resolve'}
                    </button>
                    <button
                        type="button"
                        onClick={props.onDelete}
                        className="rounded border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
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
                                disabled={!reply.trim()}
                                onClick={() => {
                                    const next = reply.trim()
                                    if (!next) return
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

export default function ReviewPage() {
    const { api, scopeKey, baseUrl } = useAppContext()
    const navigate = useNavigate()
    const { sessionId } = useParams({ from: '/sessions/$sessionId/review' })
    const search = useSearch({ from: '/sessions/$sessionId/review' })
    const { session } = useSession(api, sessionId)
    const { copy, copied } = useCopyToClipboard()
    const mode: ReviewMode = search.mode === 'working' ? 'working' : 'branch'
    const selectedPathFromSearch = typeof search.path === 'string' ? search.path : ''
    const highlightedThreadId = typeof search.threadId === 'string' ? search.threadId : null
    const [reviewFile, setReviewFile] = useState<ReviewFile | null>(null)
    const [reviewHash, setReviewHash] = useState<string | null>(null)
    const reviewHashRef = useRef<string | null>(null)
    const mutationQueueRef = useRef<Promise<unknown>>(Promise.resolve())
    const [reviewError, setReviewError] = useState<string | null>(null)
    const [saveError, setSaveError] = useState<string | null>(null)
    const [isSaving, setIsSaving] = useState(false)
    const [composerAnchorKey, setComposerAnchorKey] = useState<string | null>(null)
    const [composerText, setComposerText] = useState('')
    const [collapsedResolvedThreadIds, setCollapsedResolvedThreadIds] = useState<Record<string, boolean>>({})

    const summaryQuery = useQuery({
        queryKey: ['review-summary', scopeKey, sessionId, mode],
        queryFn: async () => {
            if (!api) {
                throw new Error('API unavailable')
            }
            return await api.getReviewSummary(sessionId, mode)
        },
        enabled: Boolean(api && session?.active)
    })

    const summary = summaryQuery.data?.success ? summaryQuery.data : null
    const selectedPath = selectedPathFromSearch || summary?.files?.[0]?.filePath || ''
    const workspacePath = session?.metadata?.path ?? null

    const patchQuery = useQuery({
        queryKey: ['review-patch', scopeKey, sessionId, mode, selectedPath],
        queryFn: async () => {
            if (!api || !selectedPath) {
                throw new Error('No file selected')
            }
            return await api.getReviewFile(sessionId, selectedPath, mode)
        },
        enabled: Boolean(api && session?.active && selectedPath)
    })

    useEffect(() => {
        if (!api || !workspacePath) {
            return
        }
        let cancelled = false
        void api.readSessionFile(sessionId, REVIEW_FILE_PATH)
            .then((result) => {
                if (cancelled) {
                    return
                }
                if (!result.success) {
                    const errorMessage = result.error ?? 'Failed to load review file'
                    if (errorMessage.toLowerCase().includes('enoent') || errorMessage.toLowerCase().includes('no such file')) {
                        setReviewFile(createEmptyReviewFile(workspacePath))
                        setReviewHash(null)
                        reviewHashRef.current = null
                        setReviewError(null)
                        return
                    }
                    setReviewError(errorMessage)
                    return
                }
                const decoded = result.content ? decodeBase64(result.content) : { ok: true, text: '' }
                if (!decoded.ok) {
                    setReviewError('Failed to decode review file')
                    return
                }
                const parsed = parseReviewFile(decoded.text, workspacePath)
                if (!parsed.ok) {
                    setReviewError(parsed.error)
                    return
                }
                setReviewFile(parsed.value)
                setReviewHash(result.hash ?? null)
                reviewHashRef.current = result.hash ?? null
                setReviewError(null)
            })
            .catch((error) => {
                if (!cancelled) {
                    setReviewError(error instanceof Error ? error.message : 'Failed to load review file')
                }
            })
        return () => {
            cancelled = true
        }
    }, [api, sessionId, workspacePath])

    useEffect(() => {
        if (!selectedPathFromSearch && summary?.files?.[0]?.filePath) {
            void navigate({
                to: '/sessions/$sessionId/review',
                params: { sessionId },
                search: { mode, path: summary.files[0].filePath }
            })
        }
    }, [mode, navigate, selectedPathFromSearch, sessionId, summary?.files])

    const parsedLines = useMemo(() => {
        if (!patchQuery.data?.success || !patchQuery.data.stdout) {
            return []
        }
        return parseUnifiedDiff(patchQuery.data.stdout)
    }, [patchQuery.data])

    const diffLanguage = useMemo(() => resolveLanguageFromPath(selectedPath), [selectedPath])
    const diffCodeBlock = useMemo(
        () => parsedLines.filter((l) => l.kind !== 'hunk').map((l) => l.text).join('\n'),
        [parsedLines]
    )
    const highlightedDiffLines = useShikiLines(diffCodeBlock, diffLanguage)

    const relevantThreads = useMemo(
        () => reviewFile?.threads.filter((thread) => thread.filePath === selectedPath && thread.diffMode === mode) ?? [],
        [mode, reviewFile?.threads, selectedPath]
    )

    const anchorKeys = useMemo(() => {
        const next = new Set<string>()
        for (const line of parsedLines) {
            if (line.kind === 'add') {
                next.add(getAnchorKey('right', line.newLine))
            } else if (line.kind === 'delete') {
                next.add(getAnchorKey('left', line.oldLine))
            } else if (line.kind === 'context') {
                next.add(getAnchorKey('left', line.oldLine))
                next.add(getAnchorKey('right', line.newLine))
            }
        }
        return next
    }, [parsedLines])

    const threadsByAnchor = useMemo(() => {
        const map = new Map<string, ReviewThread[]>()
        for (const thread of relevantThreads) {
            const key = getAnchorKey(thread.anchor.side, thread.anchor.line)
            if (!anchorKeys.has(key)) {
                continue
            }
            const existing = map.get(key) ?? []
            existing.push(thread)
            map.set(key, existing)
        }
        return map
    }, [anchorKeys, relevantThreads])

    const orphanedThreads = useMemo(
        () => relevantThreads.filter((thread) => !anchorKeys.has(getAnchorKey(thread.anchor.side, thread.anchor.line))),
        [anchorKeys, relevantThreads]
    )

    const persistReviewFile = useCallback(async (next: ReviewFile) => {
        if (!api) {
            return false
        }
        setIsSaving(true)
        setSaveError(null)
        const payload = {
            ...next,
            currentBranch: summary?.currentBranch ?? next.currentBranch ?? null,
            defaultBranch: summary?.defaultBranch ?? next.defaultBranch ?? null,
            mergeBase: summary?.mergeBase ?? next.mergeBase ?? null,
            updatedAt: Date.now()
        }
        const encoded = encodeBase64(`${JSON.stringify(payload, null, 2)}\n`)
        const result = await api.writeSessionFile(sessionId, REVIEW_FILE_PATH, encoded, reviewHashRef.current)
        setIsSaving(false)
        if (!result.success) {
            setSaveError(result.error ?? 'Failed to save review file')
            return false
        }
        setReviewFile(payload)
        const nextHash = result.hash ?? null
        setReviewHash(nextHash)
        reviewHashRef.current = nextHash
        return true
    }, [api, sessionId, summary?.currentBranch, summary?.defaultBranch, summary?.mergeBase])

    const mutateReview = useCallback(async (mutator: (current: ReviewFile) => ReviewFile) => {
        if (!reviewFile) {
            return
        }
        const next = mutator(reviewFile)
        // Serialize mutations so each one uses the latest reviewHash
        const queued = mutationQueueRef.current.then(() => persistReviewFile(next)).catch(() => {})
        mutationQueueRef.current = queued
        await queued
    }, [persistReviewFile, reviewFile])

    const handleCreateThread = useCallback(async (line: ParsedDiffLine) => {
        const anchor = buildThreadAnchor(line)
        const body = composerText.trim()
        if (!reviewFile || !anchor || !body || !selectedPath) {
            return
        }
        await mutateReview((current) => ({
            ...current,
            threads: [
                ...current.threads,
                {
                    id: generateId(),
                    diffMode: mode,
                    filePath: selectedPath,
                    anchor: {
                        ...anchor,
                        hunkHeader: undefined
                    },
                    status: 'open',
                    comments: [{
                        id: generateId(),
                        author: 'user',
                        createdAt: Date.now(),
                        body
                    }]
                }
            ]
        }))
        setComposerAnchorKey(null)
        setComposerText('')
    }, [composerText, mode, mutateReview, reviewFile, selectedPath])

    const updateThread = useCallback(async (threadId: string, mutator: (thread: ReviewThread) => ReviewThread | null) => {
        await mutateReview((current) => ({
            ...current,
            threads: current.threads.flatMap((thread) => {
                if (thread.id !== threadId) {
                    return [thread]
                }
                const updated = mutator(thread)
                return updated ? [updated] : []
            })
        }))
    }, [mutateReview])

    const subtitle = session?.metadata?.path ?? sessionId

    if (!session) {
        return <div className="flex h-full items-center justify-center"><LoadingState label="Loading review…" className="text-sm" /></div>
    }

    return (
        <div className="flex h-full min-h-0 flex-col bg-[var(--app-bg)]">
            <div className="border-b border-[var(--app-border)] p-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => window.history.back()}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                    >
                        <BackIcon />
                    </button>
                    <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold">Review</div>
                        <div className="truncate text-xs text-[var(--app-hint)]">{subtitle}</div>
                    </div>
                    <button
                        type="button"
                        onClick={() => {
                            void summaryQuery.refetch()
                            void patchQuery.refetch()
                        }}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                        title="Refresh"
                    >
                        <RefreshIcon />
                    </button>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                    <button
                        type="button"
                        onClick={() => {
                            void navigate({
                                to: '/sessions/$sessionId/review',
                                params: { sessionId },
                                search: { mode: 'branch', path: selectedPath || undefined, threadId: highlightedThreadId || undefined }
                            })
                        }}
                        className={`rounded-full border px-3 py-1 ${mode === 'branch' ? 'border-[var(--app-link)] bg-[var(--app-link)] text-[var(--app-button-text)]' : 'border-[var(--app-border)] text-[var(--app-fg)]'}`}
                    >
                        Branch diff
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            void navigate({
                                to: '/sessions/$sessionId/review',
                                params: { sessionId },
                                search: { mode: 'working', path: selectedPath || undefined, threadId: highlightedThreadId || undefined }
                            })
                        }}
                        className={`rounded-full border px-3 py-1 ${mode === 'working' ? 'border-[var(--app-link)] bg-[var(--app-link)] text-[var(--app-button-text)]' : 'border-[var(--app-border)] text-[var(--app-fg)]'}`}
                    >
                        Uncommitted only
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            void copy(REVIEW_FILE_PATH)
                        }}
                        className="rounded-full border border-[var(--app-border)] px-3 py-1 text-[var(--app-fg)]"
                    >
                        {copied ? 'Copied review path' : 'Copy review file path'}
                    </button>
                    <button
                        type="button"
                        onClick={() => openSessionExplorerWindow(baseUrl, sessionId, { tab: 'directories', path: REVIEW_FILE_PATH })}
                        className="rounded-full border border-[var(--app-border)] px-3 py-1 text-[var(--app-fg)]"
                    >
                        Open review file
                    </button>
                    <span className="text-[var(--app-hint)]">
                        {summary?.currentBranch ? `HEAD: ${summary.currentBranch}` : 'No branch info'}
                    </span>
                    {summary?.defaultBranch ? (
                        <span className="text-[var(--app-hint)]">
                            base: {summary.defaultBranch}{summary.mergeBase ? ` @ ${summary.mergeBase.slice(0, 10)}` : ''}
                        </span>
                    ) : null}
                    {isSaving ? <span className="text-[var(--app-hint)]">Saving…</span> : null}
                </div>
            </div>

            {reviewError ? <div className="px-3 py-2 text-sm text-red-600">{reviewError}</div> : null}
            {saveError ? <div className="px-3 py-2 text-sm text-red-600">{saveError}</div> : null}

            <div className="min-h-0 flex flex-1 overflow-hidden">
                <div className="w-[320px] shrink-0 border-r border-[var(--app-border)] bg-[var(--app-secondary-bg)]">
                    <div className="border-b border-[var(--app-border)] px-3 py-2 text-sm font-medium">Changed files</div>
                    <div className="h-full overflow-y-auto">
                        {summaryQuery.isLoading ? (
                            <div className="px-3 py-4 text-sm text-[var(--app-hint)]">Loading diff…</div>
                        ) : summaryQuery.data && !summaryQuery.data.success ? (
                            <div className="px-3 py-4 text-sm text-red-600">{summaryQuery.data.error}</div>
                        ) : summary?.files?.length ? (
                            summary.files.map((file) => (
                                <button
                                    key={`${file.oldPath ?? ''}:${file.filePath}`}
                                    type="button"
                                    onClick={() => {
                                        void navigate({
                                            to: '/sessions/$sessionId/review',
                                            params: { sessionId },
                                            search: { mode, path: file.filePath }
                                        })
                                    }}
                                    className={`flex w-full items-start justify-between gap-3 border-b border-[var(--app-divider)] px-3 py-2 text-left hover:bg-[var(--app-subtle-bg)] ${selectedPath === file.filePath ? 'bg-[var(--app-subtle-bg)]' : ''}`}
                                >
                                    <div className="min-w-0 flex-1">
                                        <div className="truncate text-sm font-medium text-[var(--app-fg)]">{file.filePath}</div>
                                        {file.oldPath ? (
                                            <div className="truncate text-xs text-[var(--app-hint)]">renamed from {file.oldPath}</div>
                                        ) : null}
                                    </div>
                                    <div className="shrink-0 text-right text-xs">
                                        <div className="text-emerald-600">+{file.added ?? '-'}</div>
                                        <div className="text-red-600">-{file.removed ?? '-'}</div>
                                    </div>
                                </button>
                            ))
                        ) : (
                            <div className="px-3 py-4 text-sm text-[var(--app-hint)]">No tracked file changes</div>
                        )}
                    </div>
                </div>

                <div className="min-w-0 flex-1 overflow-auto p-4">
                    {!selectedPath ? (
                        <div className="text-sm text-[var(--app-hint)]">Select a changed file.</div>
                    ) : patchQuery.isLoading ? (
                        <LoadingState label="Loading patch…" className="text-sm" />
                    ) : patchQuery.data && !patchQuery.data.success ? (
                        <div className="text-sm text-red-600">{patchQuery.data.error}</div>
                    ) : parsedLines.length === 0 ? (
                        <div className="text-sm text-[var(--app-hint)]">No diff for this file.</div>
                    ) : (
                        <div className="overflow-hidden rounded-md border border-[var(--app-border)] bg-[var(--app-code-bg)]">
                            <div className="border-b border-[var(--app-border)] px-4 py-2 font-medium">{selectedPath}</div>
                            <div className="divide-y divide-[var(--app-divider)]">
                                {(() => {
                                    let codeLineIdx = 0
                                    return parsedLines.map((line, index) => {
                                    const anchor = buildThreadAnchor(line)
                                    const anchorKey = anchor ? getAnchorKey(anchor.side, anchor.line) : null
                                    const lineThreads = anchorKey ? (threadsByAnchor.get(anchorKey) ?? []) : []
                                    const highlighted = Boolean(highlightedThreadId && lineThreads.some((thread) => thread.id === highlightedThreadId))
                                    const showComposer = composerAnchorKey === anchorKey
                                    const syntaxNode = line.kind !== 'hunk' ? highlightedDiffLines?.[codeLineIdx++] : undefined
                                    const hasSyntax = syntaxNode !== undefined
                                    return (
                                        <div key={`${index}-${line.kind}-${line.text}`} className={highlighted ? 'bg-[var(--app-link)]/10' : ''}>
                                            {line.kind === 'hunk' ? (
                                                <div className="px-4 py-2 text-xs font-medium text-[var(--app-hint)]">{line.text}</div>
                                            ) : (
                                                <div className={`flex items-start gap-3 px-4 py-1 font-mono text-[12px] leading-[1.35] hover:bg-[var(--app-subtle-bg)] ${
                                                    line.kind === 'add' ? 'bg-emerald-500/10' : line.kind === 'delete' ? 'bg-red-500/10' : ''
                                                }`}>
                                                    <button
                                                        type="button"
                                                        disabled={!anchor}
                                                        onClick={() => {
                                                            if (anchorKey) {
                                                                setComposerAnchorKey(anchorKey)
                                                            }
                                                        }}
                                                        className="mt-0.5 h-5 w-5 shrink-0 rounded border border-[var(--app-border)] text-[10px] text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] disabled:opacity-40"
                                                    >
                                                        +
                                                    </button>
                                                    <div className="w-12 shrink-0 text-right text-[var(--app-hint)]">
                                                        {'oldLine' in line ? line.oldLine : ''}
                                                    </div>
                                                    <div className="w-12 shrink-0 text-right text-[var(--app-hint)]">
                                                        {'newLine' in line ? line.newLine : ''}
                                                    </div>
                                                    <div className={`shiki min-w-0 flex-1 whitespace-pre-wrap break-words ${
                                                        hasSyntax
                                                            ? ''
                                                            : line.kind === 'add' ? 'text-emerald-700' : line.kind === 'delete' ? 'text-red-700' : 'text-[var(--app-fg)]'
                                                    }`}>
                                                        {syntaxNode ?? (line.text || ' ')}
                                                    </div>
                                                </div>
                                            )}
                                            {showComposer && anchor ? (
                                                <div className="border-t border-[var(--app-divider)] bg-[var(--app-bg)] px-4 py-3">
                                                    <textarea
                                                        value={composerText}
                                                        onChange={(event) => setComposerText(event.target.value)}
                                                        placeholder="Add review comment"
                                                        className="min-h-24 w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)]"
                                                    />
                                                    <div className="mt-2 flex justify-end gap-2">
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setComposerAnchorKey(null)
                                                                setComposerText('')
                                                            }}
                                                            className="rounded-md border border-[var(--app-border)] px-3 py-2 text-sm"
                                                        >
                                                            Cancel
                                                        </button>
                                                        <button
                                                            type="button"
                                                            disabled={!composerText.trim()}
                                                            onClick={() => {
                                                                void handleCreateThread(line)
                                                            }}
                                                            className="rounded-md bg-[var(--app-link)] px-3 py-2 text-sm font-medium text-[var(--app-button-text)] disabled:cursor-not-allowed disabled:opacity-50"
                                                        >
                                                            Save comment
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : null}
                                            {lineThreads.length > 0 ? (
                                                <div className="space-y-2 border-t border-[var(--app-divider)] bg-[var(--app-secondary-bg)] px-4 py-3">
                                                    {lineThreads.map((thread) => (
                                                        <ReviewThreadCard
                                                            key={thread.id}
                                                            thread={thread}
                                                            collapsed={thread.status === 'resolved' && collapsedResolvedThreadIds[thread.id] !== false}
                                                            onToggleResolved={() => {
                                                                setCollapsedResolvedThreadIds((current) => ({
                                                                    ...current,
                                                                    [thread.id]: current[thread.id] === false
                                                                        ? true
                                                                        : false
                                                                }))
                                                            }}
                                                            onResolve={() => {
                                                                void updateThread(thread.id, (current) => ({
                                                                    ...current,
                                                                    status: current.status === 'resolved' ? 'open' : 'resolved'
                                                                }))
                                                            }}
                                                            onDelete={() => {
                                                                if (!window.confirm('Delete this review thread permanently?')) {
                                                                    return
                                                                }
                                                                void updateThread(thread.id, () => null)
                                                            }}
                                                            onReply={(body) => {
                                                                void updateThread(thread.id, (current) => ({
                                                                    ...current,
                                                                    comments: [
                                                                        ...current.comments,
                                                                        {
                                                                            id: generateId(),
                                                                            author: 'user',
                                                                            createdAt: Date.now(),
                                                                            body
                                                                        } satisfies ReviewComment
                                                                    ]
                                                                }))
                                                            }}
                                                        />
                                                    ))}
                                                </div>
                                            ) : null}
                                        </div>
                                    )
                                })
                                })()}
                            </div>
                        </div>
                    )}

                    {orphanedThreads.length > 0 ? (
                        <div className="mt-6">
                            <div className="mb-2 text-sm font-medium">Orphaned threads</div>
                            <div className="space-y-2">
                                {orphanedThreads.map((thread) => (
                                    <ReviewThreadCard
                                        key={thread.id}
                                        thread={thread}
                                        collapsed={false}
                                        onToggleResolved={() => {}}
                                        onResolve={() => {
                                            void updateThread(thread.id, (current) => ({
                                                ...current,
                                                status: current.status === 'resolved' ? 'open' : 'resolved'
                                            }))
                                        }}
                                        onDelete={() => {
                                            if (!window.confirm('Delete this review thread permanently?')) {
                                                return
                                            }
                                            void updateThread(thread.id, () => null)
                                        }}
                                        onReply={(body) => {
                                            void updateThread(thread.id, (current) => ({
                                                ...current,
                                                comments: [
                                                    ...current.comments,
                                                    {
                                                        id: generateId(),
                                                        author: 'user',
                                                        createdAt: Date.now(),
                                                        body
                                                    } satisfies ReviewComment
                                                ]
                                            }))
                                        }}
                                    />
                                ))}
                            </div>
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    )
}
