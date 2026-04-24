import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLongPress } from '@/hooks/useLongPress'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { useShikiLines, resolveLanguageFromPath } from '@/lib/shiki'

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
            className="fixed z-40 min-w-[180px] rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] p-1 shadow-lg"
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
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--app-subtle-bg)]"
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
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--app-subtle-bg)]"
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

function CodeLineRow(props: {
    lineNumber: number
    text: string
    highlighted: boolean
    matchState: 'none' | 'match' | 'active'
    syntaxContent?: ReactNode
    onOpenMenu: (line: number, point: { x: number; y: number }) => void
}) {
    const longPressHandlers = useLongPress({
        onLongPress: (point) => props.onOpenMenu(props.lineNumber, point),
        threshold: 450
    })

    return (
        <div
            {...longPressHandlers}
            onContextMenu={(event) => {
                event.preventDefault()
                props.onOpenMenu(props.lineNumber, { x: event.clientX, y: event.clientY })
            }}
            data-line-number={props.lineNumber}
            className={`group flex items-start px-0 font-mono text-[12px] leading-[1.45] ${
                props.matchState === 'active'
                    ? 'bg-amber-400/20'
                    : props.matchState === 'match'
                        ? 'bg-amber-400/10'
                        : props.highlighted
                            ? 'bg-[var(--app-link)]/10'
                            : 'hover:bg-[var(--app-subtle-bg)]'
            }`}
        >
            <div className={`sticky left-0 z-10 shrink-0 border-r border-[var(--app-border)] px-2 py-1 text-right text-[11px] text-[var(--app-hint)] ${
                props.matchState === 'active'
                    ? 'bg-amber-400/20'
                    : props.matchState === 'match'
                        ? 'bg-amber-400/10'
                        : props.highlighted
                            ? 'bg-[var(--app-link)]/10'
                            : 'bg-[var(--app-code-bg)] group-hover:bg-[var(--app-subtle-bg)]'
            } min-w-[3.75rem]`}>
                {props.lineNumber}
            </div>
            <div className="shiki min-w-0 flex-1 whitespace-pre-wrap break-words px-3 py-1 text-[var(--app-fg)]">
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
}) {
    const { copy } = useCopyToClipboard()
    const [menuState, setMenuState] = useState<LineMenuState | null>(null)
    const [searchQuery, setSearchQuery] = useState('')
    const [activeMatchIndex, setActiveMatchIndex] = useState(0)
    const containerRef = useRef<HTMLDivElement | null>(null)
    const rows = useMemo(() => props.content.split('\n'), [props.content])
    const language = useMemo(() => resolveLanguageFromPath(props.filePath), [props.filePath])
    const highlightedLines = useShikiLines(props.content, language)
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
                <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-full border border-[var(--app-border)] bg-[var(--app-surface-raised)] px-3 py-2">
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
                    <button
                        type="button"
                        onClick={() => setActiveMatchIndex((current) => Math.max(0, current - 1))}
                        disabled={!searchMatches.length || activeMatchIndex === 0}
                        className="rounded-full border border-[var(--app-border)] px-2.5 py-1 text-[11px] font-medium text-[var(--app-fg)] disabled:opacity-50"
                    >
                        Prev
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveMatchIndex((current) => Math.min(searchMatches.length - 1, current + 1))}
                        disabled={!searchMatches.length || activeMatchIndex >= searchMatches.length - 1}
                        className="rounded-full border border-[var(--app-border)] px-2.5 py-1 text-[11px] font-medium text-[var(--app-fg)] disabled:opacity-50"
                    >
                        Next
                    </button>
                    <button
                        type="button"
                        onClick={scrollToBottom}
                        className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--app-border)] bg-[var(--app-surface-raised)] text-[var(--app-hint)] transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]"
                        title="Scroll to bottom"
                        aria-label="Scroll to bottom"
                    >
                        <ArrowDownIcon />
                    </button>
                </div>
            </div>
            <div ref={containerRef} className="overflow-auto rounded-[24px] border border-[var(--app-border)] bg-[var(--app-code-bg)] py-1 shadow-[0_20px_48px_-42px_rgba(48,33,24,0.4)]">
                {rows.map((line, index) => (
                    <CodeLineRow
                        key={`${index}:${line}`}
                        lineNumber={index + 1}
                        text={line}
                        highlighted={props.highlightedLine === index + 1}
                        matchState={
                            activeMatchLine === index + 1
                                ? 'active'
                                : matchedLineNumbers.has(index + 1)
                                    ? 'match'
                                    : 'none'
                        }
                        syntaxContent={highlightedLines?.[index]}
                        onOpenMenu={(lineNumber, point) => setMenuState({ line: lineNumber, x: point.x, y: point.y })}
                    />
                ))}
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
