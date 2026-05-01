import type { ReactNode } from 'react'
import type { FileReviewThread } from '@/types/api'
import { CodeLinesView, type CodeLinesViewHandle } from '@/components/SessionFiles/CodeLinesView'

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
    codeViewRef?: React.Ref<CodeLinesViewHandle>
}) {
    return (
        <CodeLinesView
            ref={props.codeViewRef}
            content={props.sourceLines.join('\n')}
            filePath={props.filePath}
            mode="review"
            reviewSaving={props.reviewSaving}
            lineThreads={props.lineThreads}
            orphanedThreads={props.orphanedThreads}
            composerLine={props.composerLine}
            composerText={props.composerText}
            collapsedResolvedThreadIds={props.collapsedResolvedThreadIds}
            onComposerLineChange={props.onComposerLineChange}
            onComposerTextChange={props.onComposerTextChange}
            onCreateThread={props.onCreateThread}
            onToggleResolvedCollapse={props.onToggleResolvedCollapse}
            onResolveThread={props.onResolveThread}
            onDeleteThread={props.onDeleteThread}
            onReplyToThread={props.onReplyToThread}
            buildLink={(line) => `${window.location.href.split('#')[0]}#L${line}`}
        />
    )
}
