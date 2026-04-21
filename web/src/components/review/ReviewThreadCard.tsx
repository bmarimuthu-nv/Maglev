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

    return (
        <div className="rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-3">
            <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-medium uppercase tracking-wide text-[var(--app-hint)]">
                    {props.thread.status === 'resolved' ? 'Resolved thread' : 'Open thread'}
                    {props.metaLabel ? ` • ${props.metaLabel}` : ''}
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
