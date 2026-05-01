import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAppContext } from '@/lib/app-context'
import { useSession } from '@/hooks/queries/useSession'
import { useSessions } from '@/hooks/queries/useSessions'
import { getReviewBaseModeOptions, useReviewBaseMode } from '@/hooks/useReviewBaseMode'
import { useReviewAppearance } from '@/hooks/useReviewAppearance'
import { useTheme } from '@/hooks/useTheme'
import { LoadingState } from '@/components/LoadingState'
import { SplitTerminalPanel } from '@/components/SplitTerminalPanel'
import { openSessionExplorerWindow } from '@/utils/sessionExplorer'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { ReviewThreadCard } from '@/components/review/ReviewThreadCard'
import { decodeBase64, encodeBase64 } from '@/lib/utils'
import { REVIEW_FILE_PATH, countReviewCommentsByFile, countReviewCommentsByMode, createEmptyReviewFile, getReviewModeLabel, isReviewThreadOutdated, keepReviewThreadsForMode, parseReviewFile, type ReviewComment, type ReviewContext, type ReviewFile, type ReviewMode, type ReviewThread } from '@/lib/review-file'
import { parseUnifiedDiff, type ParsedDiffLine } from '@/lib/unified-diff'
import { resolveLanguageFromPath, useShikiLines } from '@/lib/shiki'
import { waitForSpawnedShellSessionReady } from '@/lib/spawn-session-ready'
import { findRespawnedSession } from '@/lib/session-respawn'

const REVIEW_SPLIT_TERMINAL_WIDTH_KEY = 'maglev:reviewSplitTerminalWidth'
const REVIEW_SPLIT_TERMINAL_DEFAULT_WIDTH = 560
const REVIEW_SPLIT_TERMINAL_MIN_WIDTH = 320
const REVIEW_SPLIT_TERMINAL_MAX_WIDTH = 1200
const REVIEW_FILE_LIST_WIDTH_KEY = 'maglev:reviewFileListWidth'
const REVIEW_FILE_LIST_DEFAULT_WIDTH = 320
const REVIEW_FILE_LIST_MIN_WIDTH = 220
const REVIEW_FILE_LIST_MAX_WIDTH = 520

function isMissingReviewFileError(message: string): boolean {
    const normalized = message.toLowerCase()
    return normalized.includes('enoent')
        || normalized.includes('enotdir')
        || normalized.includes('no such file')
        || normalized.includes('not a directory')
}

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

function TerminalIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m4 17 6-6-6-6" />
            <path d="M12 19h8" />
        </svg>
    )
}

function SunIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2" />
            <path d="M12 20v2" />
            <path d="m4.93 4.93 1.41 1.41" />
            <path d="m17.66 17.66 1.41 1.41" />
            <path d="M2 12h2" />
            <path d="M20 12h2" />
            <path d="m6.34 17.66-1.41 1.41" />
            <path d="m19.07 4.93-1.41 1.41" />
        </svg>
    )
}

function MoonIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3a6 6 0 1 0 9 9 9 9 0 1 1-9-9" />
        </svg>
    )
}

function ChevronDownIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
        </svg>
    )
}

function CheckIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
        </svg>
    )
}

function CommentIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
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

function isReviewThreadCollapsed(thread: ReviewThread, collapsedThreadIds: Record<string, boolean>, isOutdated: boolean): boolean {
    if (thread.status === 'resolved') {
        return collapsedThreadIds[thread.id] !== false
    }
    if (isOutdated) {
        return collapsedThreadIds[thread.id] === true
    }
    return false
}

function getLineAnchorPreviews(filePath: string, line: ParsedDiffLine): Array<{ key: string; preview: string }> {
    if (line.kind === 'add') {
        return [{ key: getAnchorKey(filePath, 'right', line.newLine), preview: line.text }]
    }
    if (line.kind === 'delete') {
        return [{ key: getAnchorKey(filePath, 'left', line.oldLine), preview: line.text }]
    }
    if (line.kind === 'context') {
        return [
            { key: getAnchorKey(filePath, 'left', line.oldLine), preview: line.text },
            { key: getAnchorKey(filePath, 'right', line.newLine), preview: line.text }
        ]
    }
    return []
}

function buildReviewContextComparison(context: {
    mode: ReviewMode
    baseModeLabel: string | null
    defaultBranch: string | null
    mergeBase: string | null
}): string {
    if (context.mode === 'working') {
        return 'Uncommitted changes against HEAD'
    }

    const baseRef = context.defaultBranch ?? 'resolved base branch'
    const baseCommit = context.mergeBase ?? 'resolved merge base'
    const baseMode = context.baseModeLabel ? ` using ${context.baseModeLabel}` : ''
    return `Branch diff from ${baseCommit} to HEAD against ${baseRef}${baseMode}`
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

const REVIEW_PAGE_LINE_LIMIT = 400
const REVIEW_PAGED_LINE_THRESHOLD = 600

type ReviewToolbarMenuId = 'diff' | 'review' | 'view'

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

function ReviewToolbarMenu(props: {
    id: ReviewToolbarMenuId
    label: string
    value?: string
    open: boolean
    align?: 'left' | 'right'
    onToggle: (id: ReviewToolbarMenuId) => void
    children: ReactNode
}) {
    const menuId = `review-toolbar-${props.id}-menu`

    return (
        <div className="relative">
            <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={props.open}
                aria-controls={menuId}
                onClick={() => props.onToggle(props.id)}
                className="inline-flex h-8 items-center gap-2 rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-2.5 text-xs font-medium text-[var(--app-fg)] transition-colors hover:bg-[var(--app-secondary-bg)]"
            >
                <span>{props.label}</span>
                {props.value ? <span className="max-w-32 truncate text-[var(--app-hint)]">{props.value}</span> : null}
                <ChevronDownIcon />
            </button>
            {props.open ? (
                <div
                    id={menuId}
                    role="menu"
                    className={`absolute top-full z-40 mt-1 min-w-56 rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] p-1 shadow-lg ${props.align === 'right' ? 'right-0' : 'left-0'}`}
                >
                    {props.children}
                </div>
            ) : null}
        </div>
    )
}

function ReviewToolbarMenuItem(props: {
    children: ReactNode
    active?: boolean
    disabled?: boolean
    onClick: () => void
}) {
    return (
        <button
            type="button"
            role="menuitem"
            disabled={props.disabled}
            onClick={props.onClick}
            className="flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left text-xs text-[var(--app-fg)] transition-colors hover:bg-[var(--app-secondary-bg)] disabled:cursor-not-allowed disabled:opacity-60"
        >
            <span className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center text-[var(--app-link)]">
                {props.active ? <CheckIcon /> : null}
            </span>
            <span className="min-w-0">
                <span className="block font-medium">{props.children}</span>
            </span>
        </button>
    )
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
    expanded: boolean
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
    outdatedThreadIds: Set<string>
    setComposerAnchorKey: (value: string | null) => void
    setComposerText: (value: string) => void
    setCollapsedResolvedThreadIds: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
    onToggleExpanded: () => void
    onCreateThread: (filePath: string, line: ParsedDiffLine) => Promise<void>
    onUpdateThread: (threadId: string, mutator: (thread: ReviewThread) => ReviewThread | null) => Promise<void>
    onReplyToThread: (threadId: string, body: string) => Promise<boolean>
}

function ReviewFileCard(props: ReviewFileCardProps) {
    const hunks = useMemo(() => groupDiffHunks(props.file.lines), [props.file.lines])
    const [pageIndex, setPageIndex] = useState(0)
    const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null)
    const totalRenderableLines = useMemo(
        () => hunks.reduce((count, hunk) => count + hunk.lines.length, 0),
        [hunks]
    )
    const paged = totalRenderableLines > REVIEW_PAGED_LINE_THRESHOLD
    const pageCount = Math.max(1, Math.ceil(totalRenderableLines / REVIEW_PAGE_LINE_LIMIT))
    const visibleHunks = useMemo(() => {
        if (!paged) {
            return hunks
        }

        const start = pageIndex * REVIEW_PAGE_LINE_LIMIT
        const end = start + REVIEW_PAGE_LINE_LIMIT
        let offset = 0

        return hunks.flatMap((hunk) => {
            const hunkStart = offset
            const hunkEnd = offset + hunk.lines.length
            offset = hunkEnd

            if (hunkEnd <= start || hunkStart >= end) {
                return []
            }

            const sliceStart = Math.max(0, start - hunkStart)
            const sliceEnd = Math.min(hunk.lines.length, end - hunkStart)
            return [{
                ...hunk,
                lines: hunk.lines.slice(sliceStart, sliceEnd)
            }]
        })
    }, [hunks, pageIndex, paged])
    const language = useMemo(() => resolveLanguageFromPath(props.file.filePath), [props.file.filePath])
    const sourceCodeBlock = useMemo(
        () => visibleHunks.flatMap((hunk) => hunk.lines).map((line) => line.text).join('\n'),
        [visibleHunks]
    )
    const highlightedLines = useShikiLines(sourceCodeBlock, language) ?? []
    let syntaxLineIdx = 0

    useEffect(() => {
        setPageIndex(0)
    }, [props.file.filePath, paged])

    const focusComposerTextarea = useCallback(() => {
        const focus = () => {
            const textarea = composerTextareaRef.current
            if (!textarea) {
                return
            }
            textarea.focus()
            textarea.setSelectionRange(textarea.value.length, textarea.value.length)
        }

        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(focus)
            return
        }

        focus()
    }, [])

    useEffect(() => {
        if (!props.composerAnchorKey) {
            return
        }
        focusComposerTextarea()
    }, [focusComposerTextarea, props.composerAnchorKey])

    return (
        <div className={`overflow-hidden rounded-[22px] border bg-[var(--code-bg)] shadow-[0_18px_44px_-34px_rgba(22,14,8,0.42)] ${
            props.selected
                ? 'border-[var(--review-accent)] ring-1 ring-[var(--review-accent)]/20'
                : 'border-[var(--code-border)]'
        }`}>
            <div className="flex items-start justify-between gap-3 border-b border-[var(--code-border)] bg-[var(--app-secondary-bg)] px-4 py-3">
                <div className="min-w-0 flex flex-1 items-start gap-3">
                    <button
                        type="button"
                        onClick={props.onToggleExpanded}
                        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--code-border)] bg-[var(--app-bg)] text-[var(--app-hint)] transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]"
                        aria-label={props.expanded ? 'Collapse file diff' : 'Expand file diff'}
                    >
                        <span
                            className={`transition-transform duration-150 ${props.expanded ? 'rotate-90' : ''}`}
                            aria-hidden="true"
                        >
                            ▸
                        </span>
                    </button>
                    <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-[var(--app-fg)]">{props.file.filePath}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[var(--app-hint)]">
                            <span>{totalRenderableLines} lines</span>
                            {paged ? <span>{pageCount} pages</span> : null}
                        </div>
                    </div>
                    {props.file.oldPath ? (
                        <div className="truncate text-xs text-[var(--app-hint)]">renamed from {props.file.oldPath}</div>
                    ) : null}
                </div>
                <div className="shrink-0 text-right text-xs">
                    <div className="text-[var(--app-diff-added-text)]">+{props.file.added ?? '-'}</div>
                    <div className="text-[var(--app-diff-removed-text)]">-{props.file.removed ?? '-'}</div>
                </div>
            </div>

            {!props.expanded ? (
                <div className="px-4 py-4 text-sm text-[var(--app-hint)]">
                    Diff collapsed. Expand to load and review this file.
                </div>
            ) : props.queryState.isLoading ? (
                <div className="px-4 py-6">
                    <LoadingState label="Loading patch…" className="text-sm" />
                </div>
            ) : props.queryState.data && !props.queryState.data.success ? (
                <div className="px-4 py-4 text-sm text-[var(--app-badge-error-text)]">{props.queryState.data.error}</div>
            ) : !props.file.lines.length ? (
                <div className="px-4 py-4 text-sm text-[var(--app-hint)]">No diff for this file.</div>
                    ) : (
                <div className="divide-y divide-[var(--app-divider)]">
                    {paged ? (
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--code-border)] bg-[var(--app-surface-raised)] px-4 py-2 text-xs">
                            <span className="text-[var(--app-hint)]">
                                Large diff. Showing page {pageIndex + 1} of {pageCount}.
                            </span>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => setPageIndex((current) => Math.max(0, current - 1))}
                                    disabled={pageIndex === 0}
                                    className="rounded-full border border-[var(--code-border)] px-3 py-1 font-medium text-[var(--app-fg)] disabled:opacity-50"
                                >
                                    Previous
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setPageIndex((current) => Math.min(pageCount - 1, current + 1))}
                                    disabled={pageIndex >= pageCount - 1}
                                    className="rounded-full border border-[var(--code-border)] px-3 py-1 font-medium text-[var(--app-fg)] disabled:opacity-50"
                                >
                                    Next
                                </button>
                            </div>
                        </div>
                    ) : null}

                    {visibleHunks.map((hunk, hunkIndex) => (
                        <div key={`${props.file.filePath}-${hunk.header}-${hunkIndex}`}>
                        <div className="border-b border-[var(--code-border)] bg-[var(--app-secondary-bg)]/70 px-4 py-2 font-mono text-[12px] font-normal text-[var(--app-fg)]/72">
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
                                    const diffSurfaceClass = line.kind === 'add'
                                        ? 'bg-[var(--app-diff-added-bg)]'
                                        : line.kind === 'delete'
                                            ? 'bg-[var(--app-diff-removed-bg)]'
                                            : 'bg-transparent'
                                    const contentSurfaceClass = line.kind === 'add'
                                        ? 'bg-[var(--app-diff-added-bg)]'
                                        : line.kind === 'delete'
                                            ? 'bg-[var(--app-diff-removed-bg)]'
                                            : highlighted
                                                ? 'bg-[var(--code-line-selected)]'
                                                : 'bg-[var(--code-bg)]'
                                    const lineSurfaceClass = line.kind === 'context' && highlighted
                                        ? 'bg-[var(--code-line-selected)]'
                                        : diffSurfaceClass
                                    const rowSelectionClass = highlighted
                                        ? 'shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--review-accent)_38%,transparent)]'
                                        : ''
                                    const rowInteractionClass = highlighted
                                        ? rowSelectionClass
                                        : line.kind === 'context'
                                            ? 'hover:bg-[var(--code-line-hover)]'
                                            : ''

                                    return (
                                        <div key={`${props.file.filePath}-${hunkIndex}-${lineIndex}`} className={highlighted ? 'border-l-2 border-l-[var(--review-accent)]/60' : ''}>
                                            <div className={`grid grid-cols-[28px_52px_52px_18px_minmax(0,1fr)] items-start font-mono text-[12.5px] font-normal leading-[1.6] antialiased ${
                                                lineSurfaceClass
                                            } ${
                                                rowInteractionClass
                                            }`}>
                                                <button
                                                    type="button"
                                                    disabled={!anchor}
                                                    onClick={() => {
                                                        if (anchorKey) {
                                                            props.setComposerAnchorKey(anchorKey)
                                                            focusComposerTextarea()
                                                        }
                                                    }}
                                                    className={`mx-auto mt-1.5 h-5 w-5 rounded-full border text-[10px] transition-colors disabled:opacity-30 ${
                                                        lineThreads.length > 0
                                                            ? 'border-[var(--review-thread-border)] bg-[var(--review-accent-bg)] text-[var(--review-accent)]'
                                                            : 'border-transparent text-[var(--app-hint)] hover:border-[var(--code-border)] hover:bg-[var(--app-bg)]'
                                                    }`}
                                                >
                                                    +
                                                </button>
                                                <div className={`border-r border-[var(--code-border)] px-2 py-1.5 text-right tabular-nums text-[var(--app-hint)] ${lineSurfaceClass}`}>
                                                    {'oldLine' in line ? line.oldLine : ''}
                                                </div>
                                                <div className={`border-r border-[var(--code-border)] px-2 py-1.5 text-right tabular-nums text-[var(--app-hint)] ${lineSurfaceClass}`}>
                                                    {'newLine' in line ? line.newLine : ''}
                                                </div>
                                                <div className={`px-1 py-1.5 text-center select-none ${lineSurfaceClass} ${
                                                    line.kind === 'add'
                                                        ? 'text-[var(--app-diff-added-text)]'
                                                        : line.kind === 'delete'
                                                            ? 'text-[var(--app-diff-removed-text)]'
                                                            : 'text-[var(--app-hint)]'
                                                }`}>
                                                    {changeMark}
                                                </div>
                                                <div className={`shiki min-w-0 whitespace-pre-wrap break-words px-3 py-1.5 text-[var(--app-fg)] ${contentSurfaceClass} ${
                                                    hasSyntax
                                                        ? ''
                                                        : line.kind === 'add' ? 'text-[var(--app-diff-added-text)]' : line.kind === 'delete' ? 'text-[var(--app-diff-removed-text)]' : 'text-[var(--app-fg)]'
                                                }`}>
                                                    {syntaxNode ?? (line.text || ' ')}
                                                </div>
                                            </div>
                                            {showComposer && anchor ? (
                                                <div className="border-t border-[var(--code-border)] bg-[var(--app-surface-raised)] px-4 py-3">
                                                    <textarea
                                                        ref={composerTextareaRef}
                                                        value={props.composerText}
                                                        onChange={(event) => props.setComposerText(event.target.value)}
                                                        placeholder="Add review comment"
                                                        className="min-h-24 w-full rounded-xl border border-[var(--code-border)] bg-[var(--app-bg)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--review-accent)]"
                                                    />
                                                    <div className="mt-2 flex justify-end gap-2">
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                props.setComposerAnchorKey(null)
                                                                props.setComposerText('')
                                                            }}
                                                            className="rounded-full border border-[var(--app-border)] px-3.5 py-2 text-sm"
                                                        >
                                                            Cancel
                                                        </button>
                                                        <button
                                                            type="button"
                                                            disabled={!props.composerText.trim()}
                                                            onClick={() => {
                                                                void props.onCreateThread(props.file.filePath, line)
                                                            }}
                                                            className="rounded-full bg-[var(--app-button)] px-3.5 py-2 text-sm font-semibold text-[var(--app-button-text)] disabled:cursor-not-allowed disabled:opacity-50"
                                                        >
                                                            Save comment
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : null}
                                            {lineThreads.length > 0 ? (
                                                <div className="space-y-2 border-t border-[var(--code-border)] bg-[var(--app-secondary-bg)] px-4 py-3">
                                                    {lineThreads.map((thread) => {
                                                        const isOutdated = props.outdatedThreadIds.has(thread.id)
                                                        return (
                                                            <ReviewThreadCard
                                                                key={thread.id}
                                                                thread={thread}
                                                                metaLabel={isOutdated ? 'Outdated' : null}
                                                                canCollapse={thread.status === 'resolved' || isOutdated}
                                                                collapsed={isReviewThreadCollapsed(thread, props.collapsedResolvedThreadIds, isOutdated)}
                                                                onToggleResolved={() => {
                                                                    props.setCollapsedResolvedThreadIds((current) => ({
                                                                        ...current,
                                                                        [thread.id]: !isReviewThreadCollapsed(thread, current, isOutdated)
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
                                                                onReply={(body) => props.onReplyToThread(thread.id, body)}
                                                            />
                                                        )
                                                    })}
                                                </div>
                                            ) : null}
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    ))}

                    {props.orphanedThreads.length > 0 ? (
                        <div className="border-t border-[var(--code-border)] bg-[var(--app-surface-raised)] px-4 py-4">
                            <div className="mb-2 text-sm font-medium">Orphaned threads</div>
                            <div className="space-y-2">
                                {props.orphanedThreads.map((thread) => {
                                    const isOutdated = true
                                    return (
                                        <ReviewThreadCard
                                            key={thread.id}
                                            thread={thread}
                                            metaLabel="Outdated"
                                            canCollapse
                                            collapsed={isReviewThreadCollapsed(thread, props.collapsedResolvedThreadIds, isOutdated)}
                                            onToggleResolved={() => {
                                                props.setCollapsedResolvedThreadIds((current) => ({
                                                    ...current,
                                                    [thread.id]: !isReviewThreadCollapsed(thread, current, isOutdated)
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
                                            onReply={(body) => props.onReplyToThread(thread.id, body)}
                                        />
                                    )
                                })}
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
    const queryClient = useQueryClient()
    const navigate = useNavigate()
    const { sessionId } = useParams({ from: '/sessions/$sessionId/review' })
    const search = useSearch({ from: '/sessions/$sessionId/review' })
    const { session } = useSession(api, sessionId)
    const { sessions: allSessions } = useSessions(api)
    const { copy, copied } = useCopyToClipboard()
    const { reviewBaseMode } = useReviewBaseMode()
    const { reviewAppearance, setReviewAppearance } = useReviewAppearance()
    const { colorScheme } = useTheme()
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
    const isSavingRef = useRef(false)
    const [isReloadingReviewFile, setIsReloadingReviewFile] = useState(false)
    const [composerAnchorKey, setComposerAnchorKey] = useState<string | null>(null)
    const [composerText, setComposerText] = useState('')
    const [collapsedResolvedThreadIds, setCollapsedResolvedThreadIds] = useState<Record<string, boolean>>({})
    const [expandedFilePaths, setExpandedFilePaths] = useState<Set<string>>(() => new Set())
    const [splitSessionId, setSplitSessionId] = useState<string | null>(null)
    const [pendingSplitStartupSessionId, setPendingSplitStartupSessionId] = useState<string | null>(null)
    const [closingSplitSessionId, setClosingSplitSessionId] = useState<string | null>(null)
    const [openToolbarMenu, setOpenToolbarMenu] = useState<ReviewToolbarMenuId | null>(null)
    const toolbarMenuRef = useRef<HTMLDivElement>(null)
    const [splitPanelWidth, setSplitPanelWidth] = useState(() => {
        try {
            const saved = localStorage.getItem(REVIEW_SPLIT_TERMINAL_WIDTH_KEY)
            return saved ? Math.max(REVIEW_SPLIT_TERMINAL_MIN_WIDTH, Math.min(REVIEW_SPLIT_TERMINAL_MAX_WIDTH, Number(saved))) : REVIEW_SPLIT_TERMINAL_DEFAULT_WIDTH
        } catch {
            return REVIEW_SPLIT_TERMINAL_DEFAULT_WIDTH
        }
    })
    const [sidebarWidth, setSidebarWidth] = useState(() => {
        try {
            const saved = localStorage.getItem(REVIEW_FILE_LIST_WIDTH_KEY)
            return saved ? Math.max(REVIEW_FILE_LIST_MIN_WIDTH, Math.min(REVIEW_FILE_LIST_MAX_WIDTH, Number(saved))) : REVIEW_FILE_LIST_DEFAULT_WIDTH
        } catch {
            return REVIEW_FILE_LIST_DEFAULT_WIDTH
        }
    })
    const initializedExpandedRef = useRef(false)

    const toggleToolbarMenu = useCallback((id: ReviewToolbarMenuId) => {
        setOpenToolbarMenu((current) => current === id ? null : id)
    }, [])

    useEffect(() => {
        if (!openToolbarMenu) {
            return
        }

        const handlePointerDown = (event: PointerEvent) => {
            if (toolbarMenuRef.current?.contains(event.target as Node)) {
                return
            }
            setOpenToolbarMenu(null)
        }
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setOpenToolbarMenu(null)
            }
        }

        document.addEventListener('pointerdown', handlePointerDown)
        document.addEventListener('keydown', handleKeyDown)
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown)
            document.removeEventListener('keydown', handleKeyDown)
        }
    }, [openToolbarMenu])

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
    const reviewBaseLabel = reviewBaseModeOptions.find((option) => option.value === reviewBaseMode)?.label ?? reviewBaseMode
    const workspacePath = session?.metadata?.path ?? null
    const respawnedSession = useMemo(
        () => findRespawnedSession(allSessions, sessionId),
        [allSessions, sessionId]
    )
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
            enabled: Boolean(api && session?.active && expandedFilePaths.has(file.filePath))
        }))
    })

    useEffect(() => {
        isSavingRef.current = isSaving
    }, [isSaving])

    const reloadReviewFile = useCallback(async (options?: { quiet?: boolean }) => {
        if (!api || !workspacePath) {
            return
        }
        if (isSavingRef.current) {
            return
        }

        if (!options?.quiet) {
            setIsReloadingReviewFile(true)
        }
        try {
            const result = await api.readSessionFile(sessionId, REVIEW_FILE_PATH)
            if (!result.success) {
                const errorMessage = result.error ?? 'Failed to load review file'
                if (isMissingReviewFileError(errorMessage)) {
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
        } catch (error) {
            setReviewError(error instanceof Error ? error.message : 'Failed to load review file')
        } finally {
            if (!options?.quiet) {
                setIsReloadingReviewFile(false)
            }
        }
    }, [api, sessionId, workspacePath])

    useEffect(() => {
        if (!respawnedSession || respawnedSession.id === sessionId) {
            return
        }

        void navigate({
            to: '/sessions/$sessionId/review',
            params: { sessionId: respawnedSession.id },
            search: {
                mode,
                ...(selectedPathFromSearch ? { path: selectedPathFromSearch } : {}),
                ...(highlightedThreadId ? { threadId: highlightedThreadId } : {})
            },
            replace: true
        })
    }, [highlightedThreadId, mode, navigate, respawnedSession, selectedPathFromSearch, sessionId])

    useEffect(() => {
        if (!api || !workspacePath) {
            return
        }
        void reloadReviewFile()
    }, [api, reloadReviewFile, workspacePath])

    useEffect(() => {
        if (!api || !workspacePath) {
            return
        }

        const interval = window.setInterval(() => {
            if (document.visibilityState !== 'visible') {
                return
            }
            void reloadReviewFile({ quiet: true })
        }, 5_000)

        return () => {
            window.clearInterval(interval)
        }
    }, [api, reloadReviewFile, workspacePath])

    useEffect(() => {
        if (!selectedPathFromSearch && diffFiles[0]?.filePath) {
            void navigate({
                to: '/sessions/$sessionId/review',
                params: { sessionId },
                search: { mode, path: diffFiles[0].filePath }
            })
        }
    }, [diffFiles, mode, navigate, selectedPathFromSearch, sessionId])

    useEffect(() => {
        const knownPaths = new Set(diffFiles.map((file) => file.filePath))
        setExpandedFilePaths((previous) => {
            const next = new Set(Array.from(previous).filter((path) => knownPaths.has(path)))
            if (!initializedExpandedRef.current) {
                const initialPath = selectedPathFromSearch || diffFiles[0]?.filePath
                if (initialPath) {
                    next.add(initialPath)
                }
                initializedExpandedRef.current = true
            }
            return next
        })
    }, [diffFiles, selectedPathFromSearch])

    useEffect(() => {
        if (!selectedPathFromSearch) {
            return
        }
        setExpandedFilePaths((previous) => {
            if (previous.has(selectedPathFromSearch)) {
                return previous
            }
            const next = new Set(previous)
            next.add(selectedPathFromSearch)
            return next
        })
    }, [selectedPathFromSearch])

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
    const commentCountsByFile = useMemo(
        () => countReviewCommentsByFile(relevantThreads),
        [relevantThreads]
    )

    const anchorKeysByFile = useMemo(() => {
        const map = new Map<string, Set<string>>()
        for (const file of parsedFileDiffs) {
            const keys = new Set<string>()
            for (const line of file.lines) {
                for (const anchor of getLineAnchorPreviews(file.filePath, line)) {
                    keys.add(anchor.key)
                }
            }
            map.set(file.filePath, keys)
        }
        return map
    }, [parsedFileDiffs])

    const currentPreviewByAnchor = useMemo(() => {
        const map = new Map<string, string>()
        for (const file of parsedFileDiffs) {
            for (const line of file.lines) {
                for (const anchor of getLineAnchorPreviews(file.filePath, line)) {
                    map.set(anchor.key, anchor.preview)
                }
            }
        }
        return map
    }, [parsedFileDiffs])

    const outdatedThreadIds = useMemo(() => {
        const ids = new Set<string>()
        for (const thread of relevantThreads) {
            const anchorKey = getAnchorKey(thread.filePath, thread.anchor.side, thread.anchor.line)
            const currentPreview = currentPreviewByAnchor.get(anchorKey)
            if (isReviewThreadOutdated(thread, currentPreview)) {
                ids.add(thread.id)
            }
        }
        return ids
    }, [currentPreviewByAnchor, relevantThreads])

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

    const buildCurrentReviewContext = useCallback((): ReviewContext => {
        const resolvedMode = summary?.mode ?? mode
        const currentBranch = summary?.currentBranch ?? reviewFile?.currentBranch ?? null
        const defaultBranch = resolvedMode === 'branch'
            ? summary?.defaultBranch ?? reviewFile?.defaultBranch ?? null
            : null
        const mergeBase = resolvedMode === 'branch'
            ? summary?.mergeBase ?? reviewFile?.mergeBase ?? null
            : null
        const baseMode = resolvedMode === 'branch' ? summary?.baseMode ?? reviewBaseMode : null
        const baseModeLabel = resolvedMode === 'branch' ? reviewBaseLabel : null

        return {
            mode: resolvedMode,
            modeLabel: resolvedMode === 'branch' ? 'Branch diff' : 'Uncommitted changes',
            baseMode,
            baseModeLabel,
            currentBranch,
            defaultBranch,
            mergeBase,
            comparison: buildReviewContextComparison({
                mode: resolvedMode,
                baseModeLabel,
                defaultBranch,
                mergeBase
            })
        }
    }, [
        mode,
        reviewBaseLabel,
        reviewBaseMode,
        reviewFile?.currentBranch,
        reviewFile?.defaultBranch,
        reviewFile?.mergeBase,
        summary?.baseMode,
        summary?.currentBranch,
        summary?.defaultBranch,
        summary?.mergeBase,
        summary?.mode
    ])

    const persistReviewFile = useCallback(async (next: ReviewFile) => {
        if (!api) {
            return false
        }
        setIsSaving(true)
        setSaveError(null)
        const reviewContext = buildCurrentReviewContext()
        const payload = {
            ...next,
            currentBranch: reviewContext.currentBranch,
            defaultBranch: reviewContext.defaultBranch,
            mergeBase: reviewContext.mergeBase,
            reviewContext,
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
    }, [api, buildCurrentReviewContext, sessionId])

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

    const confirmReplacingOtherModeComments = useCallback((): boolean => {
        if (!reviewFile) {
            return false
        }
        const commentsByMode = countReviewCommentsByMode(reviewFile.threads)
        const otherModes = Array.from(commentsByMode.entries())
            .filter(([threadMode, count]) => threadMode !== mode && count > 0)
        if (otherModes.length === 0) {
            return true
        }

        const total = otherModes.reduce((sum, [, count]) => sum + count, 0)
        const otherModeLabels = otherModes
            .map(([threadMode, count]) => `${count} ${count === 1 ? 'comment' : 'comments'} in ${getReviewModeLabel(threadMode)}`)
            .join(', ')
        return window.confirm(
            `There ${total === 1 ? 'is' : 'are'} already ${otherModeLabels}. `
            + `Adding a new comment in ${getReviewModeLabel(mode)} will delete comments added in another diff view. `
            + 'Do you want to proceed?'
        )
    }, [mode, reviewFile])

    const handleCreateThread = useCallback(async (filePath: string, line: ParsedDiffLine) => {
        const anchor = buildThreadAnchor(line)
        const body = composerText.trim()
        if (!reviewFile || !anchor || !body || !filePath) {
            return
        }
        if (!confirmReplacingOtherModeComments()) {
            return
        }
        await mutateReview((current) => ({
            ...current,
            threads: [
                ...keepReviewThreadsForMode(current.threads, mode),
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
    }, [composerText, confirmReplacingOtherModeComments, mode, mutateReview, reviewFile])

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

    const replyToThread = useCallback(async (threadId: string, body: string): Promise<boolean> => {
        const replyBody = body.trim()
        if (!replyBody) {
            return false
        }
        if (!reviewFile || !confirmReplacingOtherModeComments()) {
            return false
        }
        await mutateReview((current) => ({
            ...current,
            threads: keepReviewThreadsForMode(current.threads, mode).flatMap((thread) => {
                if (thread.id !== threadId) {
                    return [thread]
                }
                return [{
                    ...thread,
                    comments: [
                        ...thread.comments,
                        {
                            id: generateId(),
                            author: 'user',
                            createdAt: Date.now(),
                            body: replyBody
                        } satisfies ReviewComment
                    ]
                }]
            })
        }))
        return true
    }, [confirmReplacingOtherModeComments, mode, mutateReview, reviewFile])

    const subtitle = session?.metadata?.path ?? sessionId
    const expandedCount = expandedFilePaths.size

    useEffect(() => {
        if (splitSessionId || !session?.id) {
            return
        }
        const child = allSessions.find(
            (candidate) =>
                candidate.active
                && candidate.metadata?.parentSessionId === session.id
                && candidate.metadata?.childRole === 'review-terminal'
                && candidate.id !== closingSplitSessionId
        )
        if (child) {
            setSplitSessionId(child.id)
        }
    }, [allSessions, closingSplitSessionId, session?.id, splitSessionId])

    useEffect(() => {
        if (!pendingSplitStartupSessionId) {
            return
        }

        const pendingSession = allSessions.find((candidate) => candidate.id === pendingSplitStartupSessionId)
        if (pendingSession?.active) {
            setPendingSplitStartupSessionId(null)
        }
    }, [allSessions, pendingSplitStartupSessionId])

    useEffect(() => {
        if (!closingSplitSessionId) {
            return
        }
        const stillPresent = allSessions.some((candidate) => candidate.id === closingSplitSessionId)
        if (!stillPresent) {
            setClosingSplitSessionId(null)
        }
    }, [allSessions, closingSplitSessionId])

    useEffect(() => {
        if (!splitSessionId) {
            return
        }

        const splitSession = allSessions.find((candidate) => candidate.id === splitSessionId)
        if (splitSession?.active) {
            if (pendingSplitStartupSessionId === splitSessionId) {
                setPendingSplitStartupSessionId(null)
            }
            return
        }
        if (pendingSplitStartupSessionId === splitSessionId) {
            return
        }
        if (!splitSession || !splitSession.active) {
            setSplitSessionId(null)
            if (closingSplitSessionId === splitSessionId) {
                setClosingSplitSessionId(null)
            }
        }
    }, [allSessions, closingSplitSessionId, pendingSplitStartupSessionId, splitSessionId])

    const handleSplitResizeStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        event.preventDefault()
        const startX = event.clientX
        const startWidth = splitPanelWidth

        const onMove = (e: globalThis.PointerEvent) => {
            const delta = startX - e.clientX
            const next = Math.max(REVIEW_SPLIT_TERMINAL_MIN_WIDTH, Math.min(REVIEW_SPLIT_TERMINAL_MAX_WIDTH, startWidth + delta))
            setSplitPanelWidth(next)
            try { localStorage.setItem(REVIEW_SPLIT_TERMINAL_WIDTH_KEY, String(next)) } catch { /* ignore */ }
        }

        const onUp = () => {
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerup', onUp)
        }

        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
    }, [splitPanelWidth])

    const handleSidebarResizeStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        event.preventDefault()
        const startX = event.clientX
        const startWidth = sidebarWidth

        const onMove = (e: globalThis.PointerEvent) => {
            const delta = e.clientX - startX
            const next = Math.max(REVIEW_FILE_LIST_MIN_WIDTH, Math.min(REVIEW_FILE_LIST_MAX_WIDTH, startWidth + delta))
            setSidebarWidth(next)
            try { localStorage.setItem(REVIEW_FILE_LIST_WIDTH_KEY, String(next)) } catch { /* ignore */ }
        }

        const onUp = () => {
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerup', onUp)
        }

        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
    }, [sidebarWidth])

    const handleOpenSplitTerminal = useCallback(async () => {
        if (!api || !session?.metadata?.path) {
            return
        }
        try {
            const result = await api.spawnHubSession(
                session.metadata.path,
                'review-terminal',
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                sessionId,
                'review-terminal'
            )
            if (result.type === 'success') {
                setSplitSessionId(result.sessionId)
                setPendingSplitStartupSessionId(result.sessionId)
                await waitForSpawnedShellSessionReady({
                    api,
                    queryClient,
                    scopeKey,
                    sessionId: result.sessionId
                })
            }
        } catch {
            // ignore
        }
    }, [api, queryClient, scopeKey, session?.metadata?.name, session?.metadata?.path, sessionId])

    const handleCloseSplit = useCallback(async () => {
        if (!api || !splitSessionId || closingSplitSessionId === splitSessionId) {
            return
        }

        setClosingSplitSessionId(splitSessionId)
        try {
            await api.closeSession(splitSessionId)
            setSplitSessionId((current) => current === splitSessionId ? null : current)
            setPendingSplitStartupSessionId((current) => current === splitSessionId ? null : current)
        } catch {
            setClosingSplitSessionId(null)
        }
    }, [api, closingSplitSessionId, splitSessionId])

    const splitSessionStarting = splitSessionId !== null && pendingSplitStartupSessionId === splitSessionId
    const effectiveReviewScheme = reviewAppearance === 'system' ? colorScheme : reviewAppearance
    const reviewModeLabel = mode === 'branch' ? 'Branch diff' : 'Uncommitted'
    const reviewShellActionLabel = splitSessionId
        ? closingSplitSessionId === splitSessionId
            ? 'Closing shell'
            : splitSessionStarting
                ? 'Starting shell'
                : 'Close review shell'
        : 'Open review shell'
    const toggleReviewAppearance = useCallback(() => {
        setReviewAppearance(effectiveReviewScheme === 'dark' ? 'light' : 'dark')
    }, [effectiveReviewScheme, setReviewAppearance])

    if (!session) {
        return <div className="flex h-full items-center justify-center"><LoadingState label="Loading review…" className="text-sm" /></div>
    }

    return (
        <div
            className="review-theme-scope flex h-full min-h-0 bg-[var(--app-bg)]"
            data-review-theme={reviewAppearance === 'system' ? undefined : reviewAppearance}
        >
            <div className="flex min-w-0 flex-1 flex-col">
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
                        <div className="truncate font-semibold text-[var(--app-fg)]">Review</div>
                        <div className="truncate text-xs text-[var(--app-hint)]">{subtitle}</div>
                    </div>
                    <button
                        type="button"
                        disabled={splitSessionId !== null && closingSplitSessionId === splitSessionId}
                        onClick={() => {
                            if (splitSessionId) {
                                void handleCloseSplit()
                            } else {
                                void handleOpenSplitTerminal()
                            }
                        }}
                        className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                            splitSessionId
                                ? 'border-[var(--app-link)] bg-[var(--app-link)] text-[var(--app-bg)]'
                                : 'border-[var(--app-border)] text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)]'
                        }`}
                        title={reviewShellActionLabel}
                    >
                        <TerminalIcon />
                        <span className="hidden sm:inline">{reviewShellActionLabel}</span>
                    </button>
                </div>
                <div ref={toolbarMenuRef} className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                    <ReviewToolbarMenu
                        id="diff"
                        label="Diff"
                        value={reviewModeLabel}
                        open={openToolbarMenu === 'diff'}
                        onToggle={toggleToolbarMenu}
                    >
                        <ReviewToolbarMenuItem
                            active={mode === 'branch'}
                            onClick={() => {
                                setOpenToolbarMenu(null)
                                void navigate({
                                    to: '/sessions/$sessionId/review',
                                    params: { sessionId },
                                    search: { mode: 'branch', path: selectedPath || undefined, threadId: highlightedThreadId || undefined }
                                })
                            }}
                        >
                            Branch diff
                        </ReviewToolbarMenuItem>
                        <ReviewToolbarMenuItem
                            active={mode === 'working'}
                            onClick={() => {
                                setOpenToolbarMenu(null)
                                void navigate({
                                    to: '/sessions/$sessionId/review',
                                    params: { sessionId },
                                    search: { mode: 'working', path: selectedPath || undefined, threadId: highlightedThreadId || undefined }
                                })
                            }}
                        >
                            Uncommitted only
                        </ReviewToolbarMenuItem>
                    </ReviewToolbarMenu>
                    <ReviewToolbarMenu
                        id="review"
                        label="Review"
                        value={isReloadingReviewFile ? 'Refreshing' : undefined}
                        open={openToolbarMenu === 'review'}
                        onToggle={toggleToolbarMenu}
                    >
                        <ReviewToolbarMenuItem
                            onClick={() => {
                                setOpenToolbarMenu(null)
                                void reloadReviewFile()
                                void summaryQuery.refetch()
                                void Promise.all(patchQueries.map((query) => query.refetch()))
                            }}
                        >
                            <span className="inline-flex items-center gap-2"><RefreshIcon /> Refresh review</span>
                        </ReviewToolbarMenuItem>
                        <ReviewToolbarMenuItem
                            onClick={() => {
                                setOpenToolbarMenu(null)
                                void copy(REVIEW_FILE_PATH)
                            }}
                        >
                            {copied ? 'Copied review path' : 'Copy review file path'}
                        </ReviewToolbarMenuItem>
                        <ReviewToolbarMenuItem
                            onClick={() => {
                                setOpenToolbarMenu(null)
                                openSessionExplorerWindow(baseUrl, sessionId, { tab: 'directories', path: REVIEW_FILE_PATH })
                            }}
                        >
                            Open review file
                        </ReviewToolbarMenuItem>
                    </ReviewToolbarMenu>
                    <ReviewToolbarMenu
                        id="view"
                        label="View"
                        value={effectiveReviewScheme}
                        open={openToolbarMenu === 'view'}
                        onToggle={toggleToolbarMenu}
                    >
                        <ReviewToolbarMenuItem
                            onClick={() => {
                                setOpenToolbarMenu(null)
                                setExpandedFilePaths(new Set(diffFiles.map((file) => file.filePath)))
                            }}
                        >
                            Expand all files
                        </ReviewToolbarMenuItem>
                        <ReviewToolbarMenuItem
                            disabled={commentCountsByFile.size === 0}
                            onClick={() => {
                                setOpenToolbarMenu(null)
                                setExpandedFilePaths(new Set(
                                    diffFiles
                                        .map((file) => file.filePath)
                                        .filter((filePath) => (commentCountsByFile.get(filePath) ?? 0) > 0)
                                ))
                            }}
                        >
                            Expand files with comments
                        </ReviewToolbarMenuItem>
                        <ReviewToolbarMenuItem
                            onClick={() => {
                                setOpenToolbarMenu(null)
                                setExpandedFilePaths(new Set())
                            }}
                        >
                            Collapse all files
                        </ReviewToolbarMenuItem>
                        <ReviewToolbarMenuItem
                            onClick={() => {
                                setOpenToolbarMenu(null)
                                toggleReviewAppearance()
                            }}
                        >
                            <span className="inline-flex items-center gap-2">
                                {effectiveReviewScheme === 'dark' ? <SunIcon /> : <MoonIcon />}
                                {effectiveReviewScheme === 'dark' ? 'Light mode' : 'Dark mode'}
                            </span>
                        </ReviewToolbarMenuItem>
                    </ReviewToolbarMenu>
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
                    {isReloadingReviewFile ? <span className="text-[var(--app-hint)]">Refreshing comments…</span> : null}
                </div>
            </div>

            {reviewError ? <div className="px-3 py-2 text-sm text-[var(--app-badge-error-text)]">{reviewError}</div> : null}
            {saveError ? <div className="px-3 py-2 text-sm text-[var(--app-badge-error-text)]">{saveError}</div> : null}

            <div className="min-h-0 flex flex-1 overflow-hidden">
                <div className="relative shrink-0 border-r border-[var(--app-border)] bg-[var(--app-secondary-bg)]" style={{ width: `${sidebarWidth}px` }}>
                    <div
                        role="separator"
                        aria-orientation="vertical"
                        aria-label="Resize changed files panel"
                        onPointerDown={handleSidebarResizeStart}
                        className="absolute inset-y-0 right-0 z-10 w-3 translate-x-1/2 cursor-col-resize"
                    >
                        <div className="mx-auto h-full w-[2px] rounded-full bg-transparent transition-colors hover:bg-[var(--app-link)]" />
                    </div>
                    <div className="flex items-center justify-between gap-2 border-b border-[var(--app-border)] px-3 py-2">
                        <div className="text-sm font-medium text-[var(--app-fg)]">Changed files</div>
                        <div className="text-[11px] text-[var(--app-hint)]">{expandedCount}/{diffFiles.length} open</div>
                    </div>
                    <div className="h-full overflow-y-auto">
                        {summaryQuery.isLoading ? (
                            <div className="px-3 py-4 text-sm text-[var(--app-hint)]">Loading diff…</div>
                        ) : summaryQuery.data && !summaryQuery.data.success ? (
                            <div className="px-3 py-4 text-sm text-[var(--app-badge-error-text)]">{summaryQuery.data.error}</div>
                        ) : sidebarEntries.length ? (
                            <div className="py-1">
                                {sidebarEntries.map((entry) => {
                                    if (entry.kind === 'folder') {
                                        return (
                                            <div
                                                key={entry.key}
                                                className="flex items-center gap-2 px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-[var(--app-hint)]/85"
                                                style={{ paddingLeft: `${12 + entry.depth * 18}px` }}
                                            >
                                                <span aria-hidden="true">▾</span>
                                                <span className="truncate">{entry.name}</span>
                                            </div>
                                        )
                                    }

                                    const commentCount = commentCountsByFile.get(entry.filePath) ?? 0
                                    const commentLabel = `${commentCount} comment${commentCount === 1 ? '' : 's'}`

                                    return (
                                        <button
                                            key={entry.key}
                                            type="button"
                                            onClick={() => {
                                                setExpandedFilePaths((previous) => {
                                                    const next = new Set(previous)
                                                    next.add(entry.filePath)
                                                    return next
                                                })
                                                void navigate({
                                                    to: '/sessions/$sessionId/review',
                                                    params: { sessionId },
                                                    search: { mode, path: entry.filePath }
                                                })
                                            }}
                                            className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left hover:bg-[var(--app-subtle-bg)] ${selectedPath === entry.filePath ? 'bg-[var(--app-subtle-bg)]' : ''}`}
                                            style={{ paddingLeft: `${12 + entry.depth * 18}px` }}
                                        >
                                            <div className="min-w-0 flex-1">
                                                <div className="flex min-w-0 items-center gap-1.5">
                                                    <span className="truncate text-[13px] font-medium text-[var(--app-fg)]">{entry.name}</span>
                                                    {commentCount > 0 ? (
                                                        <span
                                                            aria-label={commentLabel}
                                                            title={commentLabel}
                                                            className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[var(--review-comment-accent)]"
                                                        >
                                                            <CommentIcon />
                                                        </span>
                                                    ) : null}
                                                </div>
                                                {entry.oldPath ? (
                                                    <div className="truncate text-[10px] text-[var(--app-hint)]">renamed from {entry.oldPath}</div>
                                                ) : null}
                                            </div>
                                            <div className="shrink-0 text-right text-[10px]">
                                                <div className="text-[var(--review-added-count)]">+{entry.added ?? '-'}</div>
                                                <div className="text-[var(--review-removed-count)]">-{entry.removed ?? '-'}</div>
                                            </div>
                                        </button>
                                    )
                                })}
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
                                            expanded={expandedFilePaths.has(file.filePath)}
                                            queryState={patchQuery}
                                            highlightedThreadId={highlightedThreadId}
                                            composerAnchorKey={composerAnchorKey}
                                            composerText={composerText}
                                            collapsedResolvedThreadIds={collapsedResolvedThreadIds}
                                            lineThreadsByAnchor={threadsByAnchor}
                                            orphanedThreads={orphanedThreads}
                                            outdatedThreadIds={outdatedThreadIds}
                                            setComposerAnchorKey={setComposerAnchorKey}
                                            setComposerText={setComposerText}
                                            setCollapsedResolvedThreadIds={setCollapsedResolvedThreadIds}
                                            onToggleExpanded={() => {
                                                setExpandedFilePaths((previous) => {
                                                    const next = new Set(previous)
                                                    if (next.has(file.filePath)) {
                                                        next.delete(file.filePath)
                                                    } else {
                                                        next.add(file.filePath)
                                                    }
                                                    return next
                                                })
                                            }}
                                            onCreateThread={handleCreateThread}
                                            onUpdateThread={updateThread}
                                            onReplyToThread={replyToThread}
                                        />
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>

            </div>
            </div>

            {splitSessionId ? (
                <div className="relative flex h-full shrink-0 border-l border-[var(--app-border)]" style={{ width: `${splitPanelWidth}px` }}>
                    <div
                        role="separator"
                        aria-orientation="vertical"
                        aria-label="Resize review terminal"
                        onPointerDown={handleSplitResizeStart}
                        className="absolute inset-y-0 left-0 z-10 w-3 -translate-x-1/2 cursor-col-resize"
                    >
                        <div className="mx-auto h-full w-[2px] rounded-full bg-transparent transition-colors hover:bg-[var(--app-link)]" />
                    </div>
                    <SplitTerminalPanel
                        sessionId={splitSessionId}
                        onClose={handleCloseSplit}
                        isClosing={closingSplitSessionId === splitSessionId}
                        starting={splitSessionStarting}
                        showScrollControl
                        title="Review terminal"
                        subtitle={session.metadata?.path ?? undefined}
                        onNavigate={(id) => {
                            setSplitSessionId(null)
                            setPendingSplitStartupSessionId((current) => current === id ? null : current)
                            void navigate({
                                to: '/sessions/$sessionId',
                                params: { sessionId: id },
                            })
                        }}
                    />
                </div>
            ) : null}
        </div>
    )
}
