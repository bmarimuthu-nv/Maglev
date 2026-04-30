export const REVIEW_FOLDER_PATH = '.maglev-review'
export const REVIEW_FILE_PATH = '.maglev-review/review.json'

export type ReviewMode = 'branch' | 'working'
export type ReviewBaseMode = 'origin' | 'upstream' | 'fork-point'

export type ReviewComment = {
    id: string
    author: string
    createdAt: number
    body: string
}

export type ReviewThread = {
    id: string
    diffMode: ReviewMode
    filePath: string
    anchor: {
        side: 'left' | 'right'
        line: number
        hunkHeader?: string
        preview?: string
    }
    status: 'open' | 'resolved'
    comments: ReviewComment[]
}

export type ReviewContext = {
    mode: ReviewMode
    modeLabel: string
    baseMode: ReviewBaseMode | null
    baseModeLabel: string | null
    currentBranch: string | null
    defaultBranch: string | null
    mergeBase: string | null
    comparison: string
}

export type ReviewFile = {
    version: 1
    workspacePath: string
    currentBranch: string | null
    defaultBranch: string | null
    mergeBase: string | null
    reviewContext: ReviewContext | null
    updatedAt: number
    threads: ReviewThread[]
}

function isComment(value: unknown): value is ReviewComment {
    if (!value || typeof value !== 'object') return false
    const candidate = value as Record<string, unknown>
    return typeof candidate.id === 'string'
        && typeof candidate.author === 'string'
        && candidate.author.trim().length > 0
        && typeof candidate.createdAt === 'number'
        && typeof candidate.body === 'string'
}

function isThread(value: unknown): value is ReviewThread {
    if (!value || typeof value !== 'object') return false
    const candidate = value as Record<string, unknown>
    const anchor = candidate.anchor as Record<string, unknown> | undefined
    return typeof candidate.id === 'string'
        && (candidate.diffMode === 'branch' || candidate.diffMode === 'working')
        && typeof candidate.filePath === 'string'
        && !!anchor
        && (anchor.side === 'left' || anchor.side === 'right')
        && typeof anchor.line === 'number'
        && (candidate.status === 'open' || candidate.status === 'resolved')
        && Array.isArray(candidate.comments)
        && candidate.comments.every(isComment)
}

function isReviewContext(value: unknown): value is ReviewContext {
    if (!value || typeof value !== 'object') return false
    const candidate = value as Record<string, unknown>
    return (candidate.mode === 'branch' || candidate.mode === 'working')
        && typeof candidate.modeLabel === 'string'
        && (candidate.baseMode === null || candidate.baseMode === 'origin' || candidate.baseMode === 'upstream' || candidate.baseMode === 'fork-point')
        && (candidate.baseModeLabel === null || typeof candidate.baseModeLabel === 'string')
        && (candidate.currentBranch === null || typeof candidate.currentBranch === 'string')
        && (candidate.defaultBranch === null || typeof candidate.defaultBranch === 'string')
        && (candidate.mergeBase === null || typeof candidate.mergeBase === 'string')
        && typeof candidate.comparison === 'string'
}

function isReviewFile(value: unknown): value is ReviewFile {
    if (!value || typeof value !== 'object') return false
    const candidate = value as Record<string, unknown>
    return candidate.version === 1
        && typeof candidate.workspacePath === 'string'
        && (candidate.currentBranch === null || typeof candidate.currentBranch === 'string' || candidate.currentBranch === undefined)
        && (candidate.defaultBranch === null || typeof candidate.defaultBranch === 'string' || candidate.defaultBranch === undefined)
        && (candidate.mergeBase === null || typeof candidate.mergeBase === 'string' || candidate.mergeBase === undefined)
        && (candidate.reviewContext === null || candidate.reviewContext === undefined || isReviewContext(candidate.reviewContext))
        && typeof candidate.updatedAt === 'number'
        && Array.isArray(candidate.threads)
        && candidate.threads.every(isThread)
}

export function createEmptyReviewFile(workspacePath: string): ReviewFile {
    return {
        version: 1,
        workspacePath,
        currentBranch: null,
        defaultBranch: null,
        mergeBase: null,
        reviewContext: null,
        updatedAt: Date.now(),
        threads: []
    }
}

export function countReviewCommentsByFile(threads: ReviewThread[]): Map<string, number> {
    const counts = new Map<string, number>()

    for (const thread of threads) {
        const commentCount = thread.comments.length
        if (commentCount === 0) {
            continue
        }
        counts.set(thread.filePath, (counts.get(thread.filePath) ?? 0) + commentCount)
    }

    return counts
}

export function getReviewModeLabel(mode: ReviewMode): string {
    return mode === 'branch' ? 'Branch diff' : 'Uncommitted changes'
}

export function countReviewCommentsByMode(threads: ReviewThread[]): Map<ReviewMode, number> {
    const counts = new Map<ReviewMode, number>()

    for (const thread of threads) {
        const commentCount = thread.comments.length
        if (commentCount === 0) {
            continue
        }
        counts.set(thread.diffMode, (counts.get(thread.diffMode) ?? 0) + commentCount)
    }

    return counts
}

export function keepReviewThreadsForMode(threads: ReviewThread[], mode: ReviewMode): ReviewThread[] {
    return threads.filter((thread) => thread.diffMode === mode)
}

export function isReviewThreadOutdated(thread: ReviewThread, currentPreview: string | undefined): boolean {
    if (currentPreview === undefined) {
        return true
    }
    if (typeof thread.anchor.preview !== 'string') {
        return false
    }
    return thread.anchor.preview !== currentPreview
}

export function parseReviewFile(content: string, workspacePath: string): { ok: true; value: ReviewFile } | { ok: false; error: string } {
    if (!content.trim()) {
        return { ok: true, value: createEmptyReviewFile(workspacePath) }
    }

    try {
        const parsed = JSON.parse(content) as unknown
        if (!isReviewFile(parsed)) {
            return { ok: false, error: 'Invalid review file format' }
        }
        return {
            ok: true,
            value: {
                ...parsed,
                currentBranch: parsed.currentBranch ?? null,
                defaultBranch: parsed.defaultBranch ?? null,
                mergeBase: parsed.mergeBase ?? null,
                reviewContext: parsed.reviewContext ?? null
            }
        }
    } catch {
        return { ok: false, error: 'Invalid review file JSON' }
    }
}
