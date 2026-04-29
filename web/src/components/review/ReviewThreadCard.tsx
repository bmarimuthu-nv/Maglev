import { useState } from 'react'

type ReviewThreadComment = {
    id: string
    author: string
    createdAt: number
    body: string
}

type ReviewThreadLike = {
    id: string
    status: 'open' | 'resolved'
    comments: ReviewThreadComment[]
}

export function ReviewThreadCard(props: {
    thread: ReviewThreadLike
    collapsed: boolean
    onToggleResolved: () => void
    onResolve: () => void
    onDelete: () => void
    onReply: (body: string) => void
    disabled?: boolean
    metaLabel?: string | null
}) {
    const [reply, setReply] = useState('')
    const rootComment = props.thread.comments[0]
    const replies = props.thread.comments.slice(1)

    return (
        <div className="rounded-2xl border border-[var(--review-thread-border)] bg-[var(--review-thread-bg)] shadow-[0_18px_34px_-28px_rgba(116,74,22,0.46)]">
            <div className="flex items-start justify-between gap-3 border-b border-[var(--code-border)] px-4 py-3">
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                        <span className={`rounded-full px-2.5 py-1 font-semibold ${
                            props.thread.status === 'resolved'
                                ? 'border border-[var(--app-border)] bg-[var(--app-subtle-bg)] text-[var(--app-hint)]'
                                : 'bg-[var(--review-accent-bg)] text-[var(--review-accent)]'
                        }`}>
                            {props.thread.status === 'resolved' ? 'Resolved' : 'Open'}
                        </span>
                        {props.metaLabel ? (
                            <span className="rounded-full border border-[var(--app-border)] bg-transparent px-2.5 py-1 font-medium text-[var(--app-hint)]">
                                {props.metaLabel}
                            </span>
                        ) : null}
                    </div>
                    {rootComment ? (
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--app-hint)]">
                            <span className="font-semibold text-[var(--app-fg)]">{rootComment.author}</span>
                            <span>{new Date(rootComment.createdAt).toLocaleString()}</span>
                        </div>
                    ) : null}
                </div>
                <div className="flex items-center gap-1">
                    {props.thread.status === 'resolved' ? (
                        <button
                            type="button"
                            onClick={props.onToggleResolved}
                            className="rounded-full border border-[var(--app-border)] px-2.5 py-1 text-[11px] font-medium text-[var(--app-hint)] transition-colors hover:bg-[var(--app-subtle-bg)]"
                        >
                            {props.collapsed ? 'Expand' : 'Collapse'}
                        </button>
                    ) : null}
                    <button
                        type="button"
                        disabled={props.disabled}
                        onClick={props.onResolve}
                        className="rounded-full border border-[var(--app-border)] px-2.5 py-1 text-[11px] font-medium text-[var(--app-fg)] transition-colors hover:bg-[var(--app-subtle-bg)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {props.thread.status === 'resolved' ? 'Reopen' : 'Resolve'}
                    </button>
                    <button
                        type="button"
                        disabled={props.disabled}
                        onClick={props.onDelete}
                        className="rounded-full border border-[var(--app-badge-error-border)] px-2.5 py-1 text-[11px] font-medium text-[var(--app-badge-error-text)] transition-colors hover:bg-[var(--app-badge-error-bg)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        Delete
                    </button>
                </div>
            </div>

            {props.collapsed ? null : (
                <>
                    <div className="px-4 py-4">
                        {rootComment ? (
                            <div className="whitespace-pre-wrap text-sm leading-6 text-[var(--app-fg)]">
                                {rootComment.body}
                            </div>
                        ) : null}

                        {replies.length > 0 ? (
                            <div className="mt-4 space-y-3 border-t border-[var(--code-border)] pt-4">
                                {replies.map((comment) => (
                                    <div key={comment.id} className="rounded-xl border border-[var(--review-thread-border)] bg-[var(--review-thread-inner-bg)] px-3 py-2.5">
                                        <div className="flex items-center justify-between gap-3 text-xs text-[var(--app-hint)]">
                                            <span className="font-medium text-[var(--app-fg)]">{comment.author}</span>
                                            <span>{new Date(comment.createdAt).toLocaleString()}</span>
                                        </div>
                                        <div className="mt-1.5 whitespace-pre-wrap text-sm text-[var(--app-fg)]">{comment.body}</div>
                                    </div>
                                ))}
                            </div>
                        ) : null}
                    </div>

                    <div className="border-t border-[var(--review-thread-border)] bg-[var(--review-thread-inner-bg)] px-4 py-3">
                        <textarea
                            value={reply}
                            onChange={(event) => setReply(event.target.value)}
                            placeholder="Reply to thread"
                            className="min-h-20 w-full rounded-xl border border-[var(--code-border)] bg-[var(--app-bg)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--review-accent)]"
                        />
                        <div className="mt-3 flex justify-end">
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
                                className="rounded-full bg-[var(--app-button)] px-3.5 py-2 text-sm font-semibold text-[var(--app-button-text)] disabled:cursor-not-allowed disabled:opacity-50"
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
