import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import type { FileReviewThread } from '@/types/api'
import { useLongPress } from '@/hooks/useLongPress'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { useShikiLines, resolveLanguageFromPath } from '@/lib/shiki'
import { ReviewThreadCard } from '@/components/review/ReviewThreadCard'

function LinkIcon(props: { className?: string }) {
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
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
    )
}

function HashIcon(props: { className?: string }) {
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
            <line x1="4" x2="20" y1="9" y2="9" />
            <line x1="4" x2="20" y1="15" y2="15" />
            <line x1="10" x2="8" y1="3" y2="21" />
            <line x1="16" x2="14" y1="3" y2="21" />
        </svg>
    )
}

function SearchIcon(props: { className?: string }) {
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
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
    )
}

function ArrowDownIcon(props: { className?: string }) {
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
            <path d="M12 5v14" />
            <path d="m19 12-7 7-7-7" />
        </svg>
    )
}

type LineMenuState = {
    line: number
    x: number
    y: number
}

type CodeLinesReviewProps = {
    mode?: 'code' | 'review'
    reviewSaving?: boolean
    lineThreads?: Map<number, FileReviewThread[]>
    orphanedThreads?: FileReviewThread[]
    composerLine?: number | null
    composerText?: string
    collapsedResolvedThreadIds?: Record<string, boolean>
    onComposerLineChange?: (line: number | null) => void
    onComposerTextChange?: (text: string) => void
    onCreateThread?: (line: number) => void
    onToggleResolvedCollapse?: (threadId: string) => void
    onResolveThread?: (thread: FileReviewThread) => void
    onDeleteThread?: (thread: FileReviewThread) => void
    onReplyToThread?: (thread: FileReviewThread, body: string) => void
}

function LineActionMenu(props: {
    state: LineMenuState | null
    onClose: () => void
    onCopyReference: (line: number) => void
    onCopyLink: (line: number) => void
}) {
    const menuRef = useRef<HTMLDivElement | null>(null)
    const headingId = useId()

    useEffect(() => {
        if (!props.state) {
            return
        }

        const onPointerDown = (event: PointerEvent) => {
            const target = event.target as Node
            if (menuRef.current?.contains(target)) {
                return
            }
            props.onClose()
        }

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                props.onClose()
            }
        }

        document.addEventListener('pointerdown', onPointerDown)
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('pointerdown', onPointerDown)
            document.removeEventListener('keydown', onKeyDown)
        }
    }, [props])

    if (!props.state) {
        return null
    }

    const { line } = props.state

    return (
        <div
            ref={menuRef}
            className="fixed z-40 min-w-[180px] rounded-xl border border-[var(--code-border)] bg-[var(--app-secondary-bg)] p-1 shadow-[0_22px_44px_-28px_rgba(22,14,8,0.46)]"
            style={{ top: props.state.y, left: props.state.x }}
        >
            <div
                id={headingId}
                className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--app-hint)]"
            >
                Line {props.state.line}
            </div>
            <div role="menu" aria-labelledby={headingId} className="flex flex-col gap-1">
                <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--app-subtle-bg)]"
                    onClick={() => {
                        props.onCopyReference(line)
                        props.onClose()
                    }}
                >
                    <HashIcon className="text-[var(--app-hint)]" />
                    Copy reference
                </button>
                <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--app-subtle-bg)]"
                    onClick={() => {
                        props.onCopyLink(line)
                        props.onClose()
                    }}
                >
                    <LinkIcon className="text-[var(--app-hint)]" />
                    Copy link
                </button>
            </div>
        </div>
    )
}

function CodeComposer(props: {
    lineNumber: number
    text: string
    saving?: boolean
    onChange: (text: string) => void
    onCancel: () => void
    onSubmit: () => void
}) {
    return (
        <div className="border-t border-[var(--code-border)] bg-[var(--app-surface-raised)] px-4 py-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--app-hint)]">
                Comment on line {props.lineNumber}
            </div>
            <textarea
                value={props.text}
                onChange={(event) => props.onChange(event.target.value)}
                placeholder={`Add comment for line ${props.lineNumber}`}
                className="min-h-24 w-full rounded-xl border border-[var(--code-border)] bg-[var(--app-bg)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--review-accent)]"
            />
            <div className="mt-3 flex justify-end gap-2">
                <button
                    type="button"
                    onClick={props.onCancel}
                    className="rounded-full border border-[var(--app-border)] px-3.5 py-2 text-sm font-medium text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]"
                >
                    Cancel
                </button>
                <button
                    type="button"
                    disabled={props.saving || !props.text.trim()}
                    onClick={props.onSubmit}
                    className="rounded-full bg-[var(--app-button)] px-3.5 py-2 text-sm font-semibold text-[var(--app-button-text)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                    Save comment
                </button>
            </div>
        </div>
    )
}

function CodeLineRow(props: {
    lineNumber: number
    text: string
    highlighted: boolean
    matchState: 'none' | 'match' | 'active'
    annotated: boolean
    reviewMode: boolean
    reviewSaving?: boolean
    syntaxContent?: ReactNode
    threadCount: number
    onOpenMenu: (line: number, point: { x: number; y: number }) => void
    onCommentClick?: (line: number) => void
}) {
    const longPressHandlers = useLongPress({
        onLongPress: (point) => props.onOpenMenu(props.lineNumber, point),
        threshold: 450
    })
    const rowTone = props.matchState === 'active'
        ? 'bg-amber-400/18'
        : props.matchState === 'match'
            ? 'bg-amber-400/10'
            : props.highlighted
                ? 'bg-[var(--code-line-selected)]'
                : props.annotated
                    ? 'bg-[var(--code-line-annotated)]'
                    : 'hover:bg-[var(--code-line-hover)]'

    return (
        <div
            {...longPressHandlers}
            onContextMenu={(event) => {
                event.preventDefault()
                props.onOpenMenu(props.lineNumber, { x: event.clientX, y: event.clientY })
            }}
            data-line-number={props.lineNumber}
            className={`group grid grid-cols-[32px_60px_minmax(0,1fr)] items-start font-mono text-[12px] font-normal leading-[1.56] antialiased ${rowTone}`}
        >
            <div className="relative flex justify-center border-r border-[var(--code-border)] bg-[var(--code-gutter-bg)] px-1 py-1.5">
                {props.reviewMode ? (
                    <button
                        type="button"
                        disabled={props.reviewSaving}
                        onClick={() => props.onCommentClick?.(props.lineNumber)}
                        className={`flex h-5 w-5 items-center justify-center rounded-full border text-[10px] transition-all ${
                            props.threadCount > 0
                                ? 'border-[var(--review-thread-border)] bg-[var(--review-accent-bg)] text-[var(--review-accent)]'
                                : 'border-transparent text-[var(--app-hint)] opacity-0 group-hover:border-[var(--code-border)] group-hover:bg-[var(--app-secondary-bg)] group-hover:opacity-100'
                        } disabled:cursor-not-allowed disabled:opacity-40`}
                        title={`Add comment on line ${props.lineNumber}`}
                    >
                        +
                    </button>
                ) : null}
            </div>
            <div className="border-r border-[var(--code-border)] bg-[var(--code-gutter-bg)] px-2 py-1.5 text-right text-[11px] text-[var(--app-hint)]">
                {props.lineNumber}
            </div>
            <div className="shiki min-w-0 whitespace-pre-wrap break-words bg-[var(--code-bg)] px-3 py-1.5 text-[var(--app-fg)]">
                {props.syntaxContent ?? (props.text || ' ')}
            </div>
        </div>
    )
}

export function CodeLinesView(props: {
    content: string
    filePath: string
    highlightedLine?: number | null
    buildLink: (line: number) => string
    mode?: 'code' | 'review'
    reviewSaving?: boolean
    lineThreads?: Map<number, FileReviewThread[]>
    orphanedThreads?: FileReviewThread[]
    composerLine?: number | null
    composerText?: string
    collapsedResolvedThreadIds?: Record<string, boolean>
    onComposerLineChange?: (line: number | null) => void
    onComposerTextChange?: (text: string) => void
    onCreateThread?: (line: number) => void
    onToggleResolvedCollapse?: (threadId: string) => void
    onResolveThread?: (thread: FileReviewThread) => void
    onDeleteThread?: (thread: FileReviewThread) => void
    onReplyToThread?: (thread: FileReviewThread, body: string) => void
}) {
    const { copy } = useCopyToClipboard()
    const [menuState, setMenuState] = useState<LineMenuState | null>(null)
    const [searchQuery, setSearchQuery] = useState('')
    const [activeMatchIndex, setActiveMatchIndex] = useState(0)
    const containerRef = useRef<HTMLDivElement | null>(null)
    const rows = useMemo(() => props.content.split('\n'), [props.content])
    const language = useMemo(() => resolveLanguageFromPath(props.filePath), [props.filePath])
    const highlightedLines = useShikiLines(props.content, language)
    const reviewMode = props.mode === 'review'
    const lineThreads = props.lineThreads ?? new Map<number, FileReviewThread[]>()
    const orphanedThreads = props.orphanedThreads ?? []
    const collapsedResolvedThreadIds = props.collapsedResolvedThreadIds ?? {}

    const searchMatches = useMemo(() => {
        const query = searchQuery.trim().toLowerCase()
        if (!query) {
            return []
        }
        const matches: number[] = []
        rows.forEach((line, index) => {
            if (line.toLowerCase().includes(query)) {
                matches.push(index + 1)
            }
        })
        return matches
    }, [rows, searchQuery])
    const activeMatchLine = searchMatches.length > 0
        ? searchMatches[Math.min(activeMatchIndex, searchMatches.length - 1)]
        : null
    const matchedLineNumbers = useMemo(() => new Set(searchMatches), [searchMatches])
    const unresolvedCount = useMemo(
        () => Array.from(lineThreads.values()).flat().filter((thread) => thread.status !== 'resolved').length,
        [lineThreads]
    )

    useEffect(() => {
        setActiveMatchIndex(0)
    }, [searchQuery])

    useEffect(() => {
        const targetLine = activeMatchLine ?? props.highlightedLine
        if (!targetLine || !containerRef.current) {
            return
        }
        const lineNode = containerRef.current.querySelector<HTMLElement>(`[data-line-number="${targetLine}"]`)
        lineNode?.scrollIntoView({ block: 'center' })
    }, [activeMatchLine, props.highlightedLine, props.content])

    const scrollToBottom = () => {
        if (!containerRef.current) {
            return
        }
        containerRef.current.scrollTo({
            top: containerRef.current.scrollHeight,
            behavior: 'smooth'
        })
    }

    return (
        <div className="relative">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-full border border-[var(--code-border)] bg-[var(--app-surface-raised)] px-3 py-2">
                    <SearchIcon className="text-[var(--app-hint)]" />
                    <input
                        value={searchQuery}
                        onChange={(event) => setSearchQuery(event.target.value)}
                        placeholder="Search in file"
                        className="w-full bg-transparent text-sm text-[var(--app-fg)] placeholder:text-[var(--app-hint)] focus:outline-none"
                        autoCapitalize="none"
                        autoCorrect="off"
                    />
                </div>
                <div className="flex items-center gap-2 text-xs text-[var(--app-hint)]">
                    <span>
                        {searchQuery.trim()
                            ? (searchMatches.length ? `${Math.min(activeMatchIndex + 1, searchMatches.length)} of ${searchMatches.length}` : 'No matches')
                            : `${rows.length} lines`}
                    </span>
                    {reviewMode ? (
                        <span className="rounded-full border border-[var(--code-border)] bg-[var(--app-surface-raised)] px-2 py-1 font-medium text-[var(--app-fg)]">
                            {unresolvedCount} unresolved
                        </span>
                    ) : null}
                    <button
                        type="button"
                        onClick={() => setActiveMatchIndex((current) => Math.max(0, current - 1))}
                        disabled={!searchMatches.length || activeMatchIndex === 0}
                        className="rounded-full border border-[var(--code-border)] px-2.5 py-1 text-[11px] font-medium text-[var(--app-fg)] disabled:opacity-50"
                    >
                        Prev
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveMatchIndex((current) => Math.min(searchMatches.length - 1, current + 1))}
                        disabled={!searchMatches.length || activeMatchIndex >= searchMatches.length - 1}
                        className="rounded-full border border-[var(--code-border)] px-2.5 py-1 text-[11px] font-medium text-[var(--app-fg)] disabled:opacity-50"
                    >
                        Next
                    </button>
                    <button
                        type="button"
                        onClick={scrollToBottom}
                        className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--code-border)] bg-[var(--app-surface-raised)] text-[var(--app-hint)] transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]"
                        title="Scroll to bottom"
                        aria-label="Scroll to bottom"
                    >
                        <ArrowDownIcon />
                    </button>
                </div>
            </div>

            <div
                ref={containerRef}
                className="overflow-auto rounded-[22px] border border-[var(--code-border)] bg-[var(--code-bg)] shadow-[0_18px_44px_-36px_rgba(28,18,10,0.42)]"
            >
                {rows.map((line, index) => {
                    const lineNumber = index + 1
                    const threads = lineThreads.get(lineNumber) ?? []
                    const showComposer = props.composerLine === lineNumber
                    const annotated = showComposer || threads.length > 0

                    return (
                        <div key={`${index}:${line}`} className={annotated ? 'border-l-2 border-l-[var(--review-accent)]/50' : ''}>
                            <CodeLineRow
                                lineNumber={lineNumber}
                                text={line}
                                highlighted={props.highlightedLine === lineNumber}
                                annotated={annotated}
                                reviewMode={reviewMode}
                                reviewSaving={props.reviewSaving}
                                threadCount={threads.length}
                                matchState={
                                    activeMatchLine === lineNumber
                                        ? 'active'
                                        : matchedLineNumbers.has(lineNumber)
                                            ? 'match'
                                            : 'none'
                                }
                                syntaxContent={highlightedLines?.[index]}
                                onOpenMenu={(selectedLine, point) => setMenuState({ line: selectedLine, x: point.x, y: point.y })}
                                onCommentClick={reviewMode ? props.onComposerLineChange : undefined}
                            />

                            {showComposer && reviewMode && props.onComposerLineChange && props.onComposerTextChange && props.onCreateThread ? (
                                <CodeComposer
                                    lineNumber={lineNumber}
                                    text={props.composerText ?? ''}
                                    saving={props.reviewSaving}
                                    onChange={props.onComposerTextChange}
                                    onCancel={() => {
                                        props.onComposerLineChange?.(null)
                                        props.onComposerTextChange?.('')
                                    }}
                                    onSubmit={() => props.onCreateThread?.(lineNumber)}
                                />
                            ) : null}

                            {threads.length > 0 ? (
                                <div className="space-y-2 border-t border-[var(--code-border)] bg-[var(--app-secondary-bg)]/72 px-4 py-3">
                                    {threads.map((thread) => (
                                        <ReviewThreadCard
                                            key={thread.id}
                                            thread={thread}
                                            metaLabel={thread.orphaned ? 'orphaned' : thread.resolvedLine ? `line ${thread.resolvedLine}` : null}
                                            collapsed={thread.status === 'resolved' && collapsedResolvedThreadIds[thread.id] !== false}
                                            disabled={props.reviewSaving}
                                            onToggleResolved={() => props.onToggleResolvedCollapse?.(thread.id)}
                                            onResolve={() => props.onResolveThread?.(thread)}
                                            onDelete={() => props.onDeleteThread?.(thread)}
                                            onReply={(body) => props.onReplyToThread?.(thread, body)}
                                        />
                                    ))}
                                </div>
                            ) : null}
                        </div>
                    )
                })}

                {reviewMode && orphanedThreads.length > 0 ? (
                    <div className="border-t border-[var(--code-border)] bg-[var(--app-surface-raised)] px-4 py-4">
                        <div className="mb-3 flex items-center gap-2">
                            <span className="rounded-full bg-[var(--review-accent-bg)] px-2.5 py-1 text-[11px] font-semibold text-[var(--review-accent)]">
                                Orphaned
                            </span>
                            <span className="text-xs text-[var(--app-hint)]">
                                Threads whose original line context no longer resolves in this file.
                            </span>
                        </div>
                        <div className="space-y-2">
                            {orphanedThreads.map((thread) => (
                                <ReviewThreadCard
                                    key={thread.id}
                                    thread={thread}
                                    metaLabel="orphaned"
                                    collapsed={thread.status === 'resolved' && collapsedResolvedThreadIds[thread.id] !== false}
                                    disabled={props.reviewSaving}
                                    onToggleResolved={() => props.onToggleResolvedCollapse?.(thread.id)}
                                    onResolve={() => props.onResolveThread?.(thread)}
                                    onDelete={() => props.onDeleteThread?.(thread)}
                                    onReply={(body) => props.onReplyToThread?.(thread, body)}
                                />
                            ))}
                        </div>
                    </div>
                ) : null}
            </div>

            <LineActionMenu
                state={menuState}
                onClose={() => setMenuState(null)}
                onCopyReference={(line) => {
                    void copy(`${props.filePath}:${line}`)
                }}
                onCopyLink={(line) => {
                    void copy(props.buildLink(line))
                }}
            />
        </div>
    )
}
