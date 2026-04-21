import type { ReactNode } from 'react'
import type { FileReviewThread } from '@/types/api'
import { ReviewThreadCard } from '@/components/review/ReviewThreadCard'

export function SourceReviewFileCard(props: {
    filePath: string
    sourceLines: string[]
    highlightedSourceLines?: ReactNode[] | null
    reviewSaving: boolean
    reviewThreads: FileReviewThread[]
    lineThreads: Map<number, FileReviewThread[]>
    orphanedThreads: FileReviewThread[]
    composerLine: number | null
    composerText: string
    collapsedResolvedThreadIds: Record<string, boolean>
    onComposerLineChange: (line: number | null) => void
    onComposerTextChange: (text: string) => void
    onCreateThread: (line: number) => void
    onToggleResolvedCollapse: (threadId: string) => void
    onResolveThread: (thread: FileReviewThread) => void
    onDeleteThread: (thread: FileReviewThread) => void
    onReplyToThread: (thread: FileReviewThread, body: string) => void
}) {
    const openThreads = props.reviewThreads.filter((thread) => thread.status === 'open').length
    const resolvedThreads = props.reviewThreads.length - openThreads

    return (
        <div className="p-4">
            <div className="overflow-hidden rounded-lg border border-[var(--app-border)] bg-[var(--app-code-bg)] shadow-sm">
                <div className="flex items-start justify-between gap-3 border-b border-[var(--app-border)] bg-[var(--app-secondary-bg)] px-4 py-3">
                    <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-[var(--app-fg)]">{props.filePath}</div>
                        <div className="truncate text-xs text-[var(--app-hint)]">Source review with shared comment threads</div>
                    </div>
                    <div className="shrink-0 text-right text-xs">
                        <div className="text-[var(--app-fg)]">{props.reviewThreads.length} threads</div>
                        <div className="text-[var(--app-hint)]">{openThreads} open • {resolvedThreads} resolved</div>
                    </div>
                </div>

                <div className="divide-y divide-[var(--app-divider)]">
                    {props.sourceLines.map((line, index) => {
                        const lineNumber = index + 1
                        const threads = props.lineThreads.get(lineNumber) ?? []
                        const showComposer = props.composerLine === lineNumber
                        const syntaxLine = props.highlightedSourceLines?.[index]
                        const highlighted = showComposer || threads.length > 0

                        return (
                            <div key={`${lineNumber}-${line}`} className={highlighted ? 'bg-[var(--app-link)]/5' : ''}>
                                <div className="grid grid-cols-[28px_52px_18px_minmax(0,1fr)] items-start font-mono text-[12px] leading-[1.45] hover:bg-[var(--app-subtle-bg)]">
                                    <button
                                        type="button"
                                        disabled={props.reviewSaving}
                                        onClick={() => {
                                            props.onComposerLineChange(lineNumber)
                                            props.onComposerTextChange('')
                                        }}
                                        className="mx-auto mt-1.5 h-5 w-5 rounded border border-transparent text-[10px] text-[var(--app-hint)] hover:border-[var(--app-border)] hover:bg-[var(--app-bg)] disabled:cursor-not-allowed disabled:opacity-40"
                                        title={`Add comment on line ${lineNumber}`}
                                    >
                                        +
                                    </button>
                                    <div className="px-2 py-1.5 text-right tabular-nums text-[var(--app-hint)]">
                                        {lineNumber}
                                    </div>
                                    <div className="px-1 py-1.5 text-center text-[var(--app-hint)] select-none">
                                        ·
                                    </div>
                                    <div className="shiki min-w-0 whitespace-pre-wrap break-words px-3 py-1.5 text-[var(--app-fg)]">
                                        {syntaxLine ?? (line || ' ')}
                                    </div>
                                </div>

                                {showComposer ? (
                                    <div className="border-t border-[var(--app-divider)] bg-[var(--app-bg)] px-4 py-3">
                                        <textarea
                                            value={props.composerText}
                                            onChange={(event) => props.onComposerTextChange(event.target.value)}
                                            placeholder={`Add comment for line ${lineNumber}`}
                                            className="min-h-24 w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)]"
                                        />
                                        <div className="mt-2 flex justify-end gap-2">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    props.onComposerLineChange(null)
                                                    props.onComposerTextChange('')
                                                }}
                                                className="rounded-md border border-[var(--app-border)] px-3 py-2 text-sm"
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                type="button"
                                                disabled={props.reviewSaving || !props.composerText.trim()}
                                                onClick={() => props.onCreateThread(lineNumber)}
                                                className="rounded-md bg-[var(--app-link)] px-3 py-2 text-sm font-medium text-[var(--app-button-text)] disabled:cursor-not-allowed disabled:opacity-50"
                                            >
                                                Save comment
                                            </button>
                                        </div>
                                    </div>
                                ) : null}

                                {threads.length > 0 ? (
                                    <div className="space-y-2 border-t border-[var(--app-divider)] bg-[var(--app-secondary-bg)] px-4 py-3">
                                        {threads.map((thread) => (
                                            <ReviewThreadCard
                                                key={thread.id}
                                                thread={thread}
                                                metaLabel={thread.orphaned ? 'orphaned' : thread.resolvedLine ? `line ${thread.resolvedLine}` : null}
                                                collapsed={thread.status === 'resolved' && props.collapsedResolvedThreadIds[thread.id] !== false}
                                                disabled={props.reviewSaving}
                                                onToggleResolved={() => props.onToggleResolvedCollapse(thread.id)}
                                                onResolve={() => props.onResolveThread(thread)}
                                                onDelete={() => props.onDeleteThread(thread)}
                                                onReply={(body) => props.onReplyToThread(thread, body)}
                                            />
                                        ))}
                                    </div>
                                ) : null}
                            </div>
                        )
                    })}

                    {props.orphanedThreads.length > 0 ? (
                        <div className="border-t border-[var(--app-divider)] bg-[var(--app-bg)] px-4 py-4">
                            <div className="mb-2 text-sm font-medium">Orphaned threads</div>
                            <div className="space-y-2">
                                {props.orphanedThreads.map((thread) => (
                                    <ReviewThreadCard
                                        key={thread.id}
                                        thread={thread}
                                        metaLabel="orphaned"
                                        collapsed={thread.status === 'resolved' && props.collapsedResolvedThreadIds[thread.id] !== false}
                                        disabled={props.reviewSaving}
                                        onToggleResolved={() => props.onToggleResolvedCollapse(thread.id)}
                                        onResolve={() => props.onResolveThread(thread)}
                                        onDelete={() => props.onDeleteThread(thread)}
                                        onReply={(body) => props.onReplyToThread(thread, body)}
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
