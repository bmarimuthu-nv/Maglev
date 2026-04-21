import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { useQueries, useQuery } from '@tanstack/react-query'
import { useAppContext } from '@/lib/app-context'
import { useSession } from '@/hooks/queries/useSession'
import { getReviewBaseModeOptions, useReviewBaseMode } from '@/hooks/useReviewBaseMode'
import { LoadingState } from '@/components/LoadingState'
import { openSessionExplorerWindow } from '@/utils/sessionExplorer'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { ReviewThreadCard } from '@/components/review/ReviewThreadCard'
import { decodeBase64, encodeBase64 } from '@/lib/utils'
import { REVIEW_FILE_PATH, createEmptyReviewFile, parseReviewFile, type ReviewComment, type ReviewFile, type ReviewMode, type ReviewThread } from '@/lib/review-file'
import { parseUnifiedDiff, type ParsedDiffLine } from '@/lib/unified-diff'
import { resolveLanguageFromPath, useShikiLines } from '@/lib/shiki'

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

function getAnchorKey(filePath: string, side: 'left' | 'right', line: number): string {
    return `${filePath}:${side}:${line}`
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

type ParsedFileDiff = {
    filePath: string
    oldPath?: string
    added: number | null
    removed: number | null
    lines: ParsedDiffLine[]
}

type ParsedDiffHunk = {
    header: string
    lines: ParsedDiffLine[]
}

type ReviewSidebarFile = {
    kind: 'file'
    key: string
    name: string
    filePath: string
    oldPath?: string
    added: number | null
    removed: number | null
    depth: number
}

type ReviewSidebarFolder = {
    kind: 'folder'
    key: string
    name: string
    depth: number
}

type ReviewSidebarEntry = ReviewSidebarFolder | ReviewSidebarFile

type ReviewSidebarTreeNode = {
    name: string
    path: string
    folders: Map<string, ReviewSidebarTreeNode>
    files: ParsedFileDiff[]
}

function groupDiffHunks(lines: ParsedDiffLine[]): ParsedDiffHunk[] {
    const hunks: ParsedDiffHunk[] = []
    let current: ParsedDiffHunk | null = null

    for (const line of lines) {
        if (line.kind === 'hunk') {
            current = {
                header: line.header,
                lines: []
            }
            hunks.push(current)
            continue
        }

        if (!current) {
            current = {
                header: '@@',
                lines: []
            }
            hunks.push(current)
        }

        current.lines.push(line)
    }

    return hunks
}

function normalizeReviewFiles(files: Array<{
    filePath: string
    oldPath?: string
    added: number | null
    removed: number | null
}>): Array<{
    filePath: string
    oldPath?: string
    added: number | null
    removed: number | null
}> {
    const byPath = new Map<string, {
        filePath: string
        oldPath?: string
        added: number | null
        removed: number | null
    }>()

    for (const file of files) {
        const existing = byPath.get(file.filePath)
        if (!existing) {
            byPath.set(file.filePath, { ...file })
            continue
        }

        existing.oldPath = existing.oldPath ?? file.oldPath
        existing.added = existing.added == null || file.added == null
            ? null
            : existing.added + file.added
        existing.removed = existing.removed == null || file.removed == null
            ? null
            : existing.removed + file.removed
    }

    return Array.from(byPath.values()).sort((left, right) => left.filePath.localeCompare(right.filePath))
}

function buildReviewSidebarEntries(files: ParsedFileDiff[]): ReviewSidebarEntry[] {
    const root: ReviewSidebarTreeNode = {
        name: '',
        path: '',
        folders: new Map(),
        files: []
    }

    for (const file of files) {
        const parts = file.filePath.split('/').filter(Boolean)
        let node = root
        for (const segment of parts.slice(0, -1)) {
            const nextPath = node.path ? `${node.path}/${segment}` : segment
            let child = node.folders.get(segment)
            if (!child) {
                child = {
                    name: segment,
                    path: nextPath,
                    folders: new Map(),
                    files: []
                }
                node.folders.set(segment, child)
            }
            node = child
        }
        node.files.push(file)
    }

    const entries: ReviewSidebarEntry[] = []

    function walk(node: ReviewSidebarTreeNode, depth: number): void {
        const folders = Array.from(node.folders.values()).sort((left, right) => left.name.localeCompare(right.name))
        const filesInNode = [...node.files].sort((left, right) => left.filePath.localeCompare(right.filePath))

        for (const folder of folders) {
            entries.push({
                kind: 'folder',
                key: `folder:${folder.path}`,
                name: folder.name,
                depth
            })
            walk(folder, depth + 1)
        }

        for (const file of filesInNode) {
            entries.push({
                kind: 'file',
                key: `file:${file.filePath}`,
                name: file.filePath.split('/').pop() ?? file.filePath,
                filePath: file.filePath,
                oldPath: file.oldPath,
                added: file.added,
                removed: file.removed,
                depth
            })
        }
    }

    walk(root, 0)
    return entries
}

type ReviewFileCardProps = {
    file: ParsedFileDiff
    selected: boolean
    queryState: {
        isLoading: boolean
        data?: { success: boolean; error?: string } | undefined
    }
    highlightedThreadId: string | null
    composerAnchorKey: string | null
    composerText: string
    collapsedResolvedThreadIds: Record<string, boolean>
    lineThreadsByAnchor: Map<string, ReviewThread[]>
    orphanedThreads: ReviewThread[]
    setComposerAnchorKey: (value: string | null) => void
    setComposerText: (value: string) => void
    setCollapsedResolvedThreadIds: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
    onCreateThread: (filePath: string, line: ParsedDiffLine) => Promise<void>
    onUpdateThread: (threadId: string, mutator: (thread: ReviewThread) => ReviewThread | null) => Promise<void>
}

function ReviewFileCard(props: ReviewFileCardProps) {
    const hunks = useMemo(() => groupDiffHunks(props.file.lines), [props.file.lines])
    const language = useMemo(() => resolveLanguageFromPath(props.file.filePath), [props.file.filePath])
    const sourceCodeBlock = useMemo(
        () => props.file.lines.filter((line) => line.kind !== 'hunk').map((line) => line.text).join('\n'),
        [props.file.lines]
    )
    const highlightedLines = useShikiLines(sourceCodeBlock, language) ?? []
    let syntaxLineIdx = 0

    return (
        <div className={`overflow-hidden rounded-lg border bg-[var(--app-code-bg)] shadow-sm ${
            props.selected
                ? 'border-[var(--app-link)] ring-1 ring-[var(--app-link)]/25'
                : 'border-[var(--app-border)]'
        }`}>
            <div className="flex items-start justify-between gap-3 border-b border-[var(--app-border)] bg-[var(--app-secondary-bg)] px-4 py-3">
                <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-[var(--app-fg)]">{props.file.filePath}</div>
                    {props.file.oldPath ? (
                        <div className="truncate text-xs text-[var(--app-hint)]">renamed from {props.file.oldPath}</div>
                    ) : null}
                </div>
                <div className="shrink-0 text-right text-xs">
                    <div className="text-emerald-600">+{props.file.added ?? '-'}</div>
                    <div className="text-red-600">-{props.file.removed ?? '-'}</div>
                </div>
            </div>

            {props.queryState.isLoading ? (
                <div className="px-4 py-6">
                    <LoadingState label="Loading patch…" className="text-sm" />
                </div>
            ) : props.queryState.data && !props.queryState.data.success ? (
                <div className="px-4 py-4 text-sm text-red-600">{props.queryState.data.error}</div>
            ) : !props.file.lines.length ? (
                <div className="px-4 py-4 text-sm text-[var(--app-hint)]">No diff for this file.</div>
            ) : (
                <div className="divide-y divide-[var(--app-divider)]">
                    {hunks.map((hunk, hunkIndex) => (
                        <div key={`${props.file.filePath}-${hunk.header}-${hunkIndex}`}>
                            <div className="border-b border-[var(--app-divider)] bg-[var(--app-secondary-bg)]/70 px-4 py-2 font-mono text-xs text-[var(--app-hint)]">
                                {hunk.header}
                            </div>
                            <div>
                                {hunk.lines.map((line, lineIndex) => {
                                    const anchor = buildThreadAnchor(line)
                                    const anchorKey = anchor ? getAnchorKey(props.file.filePath, anchor.side, anchor.line) : null
                                    const lineThreads = anchorKey ? (props.lineThreadsByAnchor.get(anchorKey) ?? []) : []
                                    const highlighted = Boolean(props.highlightedThreadId && lineThreads.some((thread) => thread.id === props.highlightedThreadId))
                                    const showComposer = props.composerAnchorKey === anchorKey
                                    const syntaxNode = highlightedLines[syntaxLineIdx++]
                                    const hasSyntax = syntaxNode !== undefined
                                    const changeMark = line.kind === 'add' ? '+' : line.kind === 'delete' ? '-' : ' '

                                    return (
                                        <div key={`${props.file.filePath}-${hunkIndex}-${lineIndex}`} className={highlighted ? 'bg-[var(--app-link)]/10' : ''}>
                                            <div className={`grid grid-cols-[28px_52px_52px_18px_minmax(0,1fr)] items-start font-mono text-[12px] leading-[1.45] hover:bg-[var(--app-subtle-bg)] ${
                                                line.kind === 'add' ? 'bg-emerald-500/10' : line.kind === 'delete' ? 'bg-red-500/10' : ''
                                            }`}>
                                                <button
                                                    type="button"
                                                    disabled={!anchor}
                                                    onClick={() => {
                                                        if (anchorKey) {
                                                            props.setComposerAnchorKey(anchorKey)
                                                        }
                                                    }}
                                                    className="mx-auto mt-1.5 h-5 w-5 rounded border border-transparent text-[10px] text-[var(--app-hint)] hover:border-[var(--app-border)] hover:bg-[var(--app-bg)] disabled:opacity-30"
                                                >
                                                    +
                                                </button>
                                                <div className="px-2 py-1.5 text-right tabular-nums text-[var(--app-hint)]">
                                                    {'oldLine' in line ? line.oldLine : ''}
                                                </div>
                                                <div className="px-2 py-1.5 text-right tabular-nums text-[var(--app-hint)]">
                                                    {'newLine' in line ? line.newLine : ''}
                                                </div>
                                                <div className={`px-1 py-1.5 text-center select-none ${
                                                    line.kind === 'add'
                                                        ? 'text-emerald-700'
                                                        : line.kind === 'delete'
                                                            ? 'text-red-700'
                                                            : 'text-[var(--app-hint)]'
                                                }`}>
                                                    {changeMark}
                                                </div>
                                                <div className={`shiki min-w-0 whitespace-pre-wrap break-words px-3 py-1.5 text-[var(--app-fg)] ${
                                                    hasSyntax
                                                        ? ''
                                                        : line.kind === 'add' ? 'text-emerald-700' : line.kind === 'delete' ? 'text-red-700' : 'text-[var(--app-fg)]'
                                                }`}>
                                                    {syntaxNode ?? (line.text || ' ')}
                                                </div>
                                            </div>
                                            {showComposer && anchor ? (
                                                <div className="border-t border-[var(--app-divider)] bg-[var(--app-bg)] px-4 py-3">
                                                    <textarea
                                                        value={props.composerText}
                                                        onChange={(event) => props.setComposerText(event.target.value)}
                                                        placeholder="Add review comment"
                                                        className="min-h-24 w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)]"
                                                    />
                                                    <div className="mt-2 flex justify-end gap-2">
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                props.setComposerAnchorKey(null)
                                                                props.setComposerText('')
                                                            }}
                                                            className="rounded-md border border-[var(--app-border)] px-3 py-2 text-sm"
                                                        >
                                                            Cancel
                                                        </button>
                                                        <button
                                                            type="button"
                                                            disabled={!props.composerText.trim()}
                                                            onClick={() => {
                                                                void props.onCreateThread(props.file.filePath, line)
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
                                                            collapsed={thread.status === 'resolved' && props.collapsedResolvedThreadIds[thread.id] !== false}
                                                            onToggleResolved={() => {
                                                                props.setCollapsedResolvedThreadIds((current) => ({
                                                                    ...current,
                                                                    [thread.id]: current[thread.id] === false ? true : false
                                                                }))
                                                            }}
                                                            onResolve={() => {
                                                                void props.onUpdateThread(thread.id, (current) => ({
                                                                    ...current,
                                                                    status: current.status === 'resolved' ? 'open' : 'resolved'
                                                                }))
                                                            }}
                                                            onDelete={() => {
                                                                if (!window.confirm('Delete this review thread permanently?')) {
                                                                    return
                                                                }
                                                                void props.onUpdateThread(thread.id, () => null)
                                                            }}
                                                            onReply={(body) => {
                                                                void props.onUpdateThread(thread.id, (current) => ({
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
                                })}
                            </div>
                        </div>
                    ))}

                    {props.orphanedThreads.length > 0 ? (
                        <div className="border-t border-[var(--app-divider)] bg-[var(--app-bg)] px-4 py-4">
                            <div className="mb-2 text-sm font-medium">Orphaned threads</div>
                            <div className="space-y-2">
                                {props.orphanedThreads.map((thread) => (
                                    <ReviewThreadCard
                                        key={thread.id}
                                        thread={thread}
                                        collapsed={false}
                                        onToggleResolved={() => {}}
                                        onResolve={() => {
                                            void props.onUpdateThread(thread.id, (current) => ({
                                                ...current,
                                                status: current.status === 'resolved' ? 'open' : 'resolved'
                                            }))
                                        }}
                                        onDelete={() => {
                                            if (!window.confirm('Delete this review thread permanently?')) {
                                                return
                                            }
                                            void props.onUpdateThread(thread.id, () => null)
                                        }}
                                        onReply={(body) => {
                                            void props.onUpdateThread(thread.id, (current) => ({
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
    const { reviewBaseMode } = useReviewBaseMode()
    const reviewBaseModeOptions = getReviewBaseModeOptions()
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
        queryKey: ['review-summary', scopeKey, sessionId, mode, reviewBaseMode],
        queryFn: async () => {
            if (!api) {
                throw new Error('API unavailable')
            }
            return await api.getReviewSummary(sessionId, mode, reviewBaseMode)
        },
        enabled: Boolean(api && session?.active)
    })

    const summary = summaryQuery.data?.success ? summaryQuery.data : null
    const workspacePath = session?.metadata?.path ?? null
    const fileCardRefs = useRef<Record<string, HTMLDivElement | null>>({})
    const diffFiles = useMemo(() => normalizeReviewFiles(summary?.files ?? []), [summary?.files])
    const selectedPath = selectedPathFromSearch || diffFiles[0]?.filePath || ''

    const patchQueries = useQueries({
        queries: diffFiles.map((file) => ({
            queryKey: ['review-patch', scopeKey, sessionId, mode, reviewBaseMode, file.filePath],
            queryFn: async () => {
                if (!api) {
                    throw new Error('API unavailable')
                }
                return await api.getReviewFile(sessionId, file.filePath, mode, reviewBaseMode)
            },
            enabled: Boolean(api && session?.active)
        }))
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
        if (!selectedPathFromSearch && diffFiles[0]?.filePath) {
            void navigate({
                to: '/sessions/$sessionId/review',
                params: { sessionId },
                search: { mode, path: diffFiles[0].filePath }
            })
        }
    }, [diffFiles, mode, navigate, selectedPathFromSearch, sessionId])

    const parsedFileDiffs = useMemo<ParsedFileDiff[]>(() => diffFiles.map((file, index) => {
        const query = patchQueries[index]
        const lines = query?.data?.success && query.data.stdout
            ? parseUnifiedDiff(query.data.stdout)
            : []
        return {
            filePath: file.filePath,
            oldPath: file.oldPath,
            added: file.added,
            removed: file.removed,
            lines
        }
    }), [diffFiles, patchQueries])

    const sidebarEntries = useMemo(() => buildReviewSidebarEntries(parsedFileDiffs), [parsedFileDiffs])

    const relevantThreads = useMemo(
        () => reviewFile?.threads.filter((thread) => thread.diffMode === mode) ?? [],
        [mode, reviewFile?.threads]
    )

    const anchorKeysByFile = useMemo(() => {
        const map = new Map<string, Set<string>>()
        for (const file of parsedFileDiffs) {
            const keys = new Set<string>()
            for (const line of file.lines) {
                if (line.kind === 'add') {
                    keys.add(getAnchorKey(file.filePath, 'right', line.newLine))
                } else if (line.kind === 'delete') {
                    keys.add(getAnchorKey(file.filePath, 'left', line.oldLine))
                } else if (line.kind === 'context') {
                    keys.add(getAnchorKey(file.filePath, 'left', line.oldLine))
                    keys.add(getAnchorKey(file.filePath, 'right', line.newLine))
                }
            }
            map.set(file.filePath, keys)
        }
        return map
    }, [parsedFileDiffs])

    const threadsByAnchor = useMemo(() => {
        const map = new Map<string, ReviewThread[]>()
        for (const thread of relevantThreads) {
            const anchorKey = getAnchorKey(thread.filePath, thread.anchor.side, thread.anchor.line)
            if (!(anchorKeysByFile.get(thread.filePath)?.has(anchorKey))) {
                continue
            }
            const existing = map.get(anchorKey) ?? []
            existing.push(thread)
            map.set(anchorKey, existing)
        }
        return map
    }, [anchorKeysByFile, relevantThreads])

    const orphanedThreadsByFile = useMemo(() => {
        const map = new Map<string, ReviewThread[]>()
        for (const thread of relevantThreads) {
            const anchorKey = getAnchorKey(thread.filePath, thread.anchor.side, thread.anchor.line)
            if (anchorKeysByFile.get(thread.filePath)?.has(anchorKey)) {
                continue
            }
            const existing = map.get(thread.filePath) ?? []
            existing.push(thread)
            map.set(thread.filePath, existing)
        }
        return map
    }, [anchorKeysByFile, relevantThreads])

    useEffect(() => {
        if (!selectedPath) {
            return
        }
        const node = fileCardRefs.current[selectedPath]
        if (!node) {
            return
        }
        node.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }, [selectedPath, parsedFileDiffs.length])

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

    const handleCreateThread = useCallback(async (filePath: string, line: ParsedDiffLine) => {
        const anchor = buildThreadAnchor(line)
        const body = composerText.trim()
        if (!reviewFile || !anchor || !body || !filePath) {
            return
        }
        await mutateReview((current) => ({
            ...current,
            threads: [
                ...current.threads,
                {
                    id: generateId(),
                    diffMode: mode,
                    filePath,
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
    }, [composerText, mode, mutateReview, reviewFile])

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
    const reviewBaseLabel = reviewBaseModeOptions.find((option) => option.value === reviewBaseMode)?.label ?? reviewBaseMode

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
                            void Promise.all(patchQueries.map((query) => query.refetch()))
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
                    {mode === 'branch' ? (
                        <span className="text-[var(--app-hint)]">
                            compare mode: {reviewBaseLabel}
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
                        ) : sidebarEntries.length ? (
                            <div className="py-1">
                                {sidebarEntries.map((entry) => (
                                    entry.kind === 'folder' ? (
                                        <div
                                            key={entry.key}
                                            className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-[var(--app-hint)]"
                                            style={{ paddingLeft: `${12 + entry.depth * 18}px` }}
                                        >
                                            <span aria-hidden="true">▾</span>
                                            <span className="truncate">{entry.name}</span>
                                        </div>
                                    ) : (
                                        <button
                                            key={entry.key}
                                            type="button"
                                            onClick={() => {
                                                void navigate({
                                                    to: '/sessions/$sessionId/review',
                                                    params: { sessionId },
                                                    search: { mode, path: entry.filePath }
                                                })
                                            }}
                                            className={`flex w-full items-start justify-between gap-3 px-3 py-2 text-left hover:bg-[var(--app-subtle-bg)] ${selectedPath === entry.filePath ? 'bg-[var(--app-subtle-bg)]' : ''}`}
                                            style={{ paddingLeft: `${12 + entry.depth * 18}px` }}
                                        >
                                            <div className="min-w-0 flex-1">
                                                <div className="truncate text-sm font-medium text-[var(--app-fg)]">{entry.name}</div>
                                                <div className="truncate text-[11px] text-[var(--app-hint)]">{entry.filePath}</div>
                                                {entry.oldPath ? (
                                                    <div className="truncate text-[11px] text-[var(--app-hint)]">renamed from {entry.oldPath}</div>
                                                ) : null}
                                            </div>
                                            <div className="shrink-0 text-right text-[11px]">
                                                <div className="text-emerald-600">+{entry.added ?? '-'}</div>
                                                <div className="text-red-600">-{entry.removed ?? '-'}</div>
                                            </div>
                                        </button>
                                    )
                                ))}
                            </div>
                        ) : (
                            <div className="px-3 py-4 text-sm text-[var(--app-hint)]">No tracked file changes</div>
                        )}
                    </div>
                </div>

                <div className="min-w-0 flex-1 overflow-auto p-4">
                    {!diffFiles.length ? (
                        <div className="text-sm text-[var(--app-hint)]">No tracked file changes.</div>
                    ) : (
                        <div className="space-y-5">
                            {parsedFileDiffs.map((file, fileIndex) => {
                                const patchQuery = patchQueries[fileIndex]
                                const isSelected = selectedPath === file.filePath
                                const orphanedThreads = orphanedThreadsByFile.get(file.filePath) ?? []

                                return (
                                    <div
                                        key={`${file.oldPath ?? ''}:${file.filePath}`}
                                        ref={(node) => {
                                            fileCardRefs.current[file.filePath] = node
                                        }}
                                    >
                                        <ReviewFileCard
                                            file={file}
                                            selected={isSelected}
                                            queryState={patchQuery}
                                            highlightedThreadId={highlightedThreadId}
                                            composerAnchorKey={composerAnchorKey}
                                            composerText={composerText}
                                            collapsedResolvedThreadIds={collapsedResolvedThreadIds}
                                            lineThreadsByAnchor={threadsByAnchor}
                                            orphanedThreads={orphanedThreads}
                                            setComposerAnchorKey={setComposerAnchorKey}
                                            setComposerText={setComposerText}
                                            setCollapsedResolvedThreadIds={setCollapsedResolvedThreadIds}
                                            onCreateThread={handleCreateThread}
                                            onUpdateThread={updateThread}
                                        />
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
