export const REVIEW_FOLDER_PATH = '.maglev-review'
export const REVIEW_FILE_PATH = '.maglev-review/review.json'

export type ReviewMode = 'branch' | 'working'

export type ReviewComment = {
    id: string
    author: 'user' | 'agent'
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

export type ReviewFile = {
    version: 1
    workspacePath: string
    currentBranch: string | null
    defaultBranch: string | null
    mergeBase: string | null
    updatedAt: number
    threads: ReviewThread[]
}

function isComment(value: unknown): value is ReviewComment {
    if (!value || typeof value !== 'object') return false
    const candidate = value as Record<string, unknown>
    return typeof candidate.id === 'string'
        && (candidate.author === 'user' || candidate.author === 'agent')
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

function isReviewFile(value: unknown): value is ReviewFile {
    if (!value || typeof value !== 'object') return false
    const candidate = value as Record<string, unknown>
    return candidate.version === 1
        && typeof candidate.workspacePath === 'string'
        && (candidate.currentBranch === null || typeof candidate.currentBranch === 'string' || candidate.currentBranch === undefined)
        && (candidate.defaultBranch === null || typeof candidate.defaultBranch === 'string' || candidate.defaultBranch === undefined)
        && (candidate.mergeBase === null || typeof candidate.mergeBase === 'string' || candidate.mergeBase === undefined)
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
        updatedAt: Date.now(),
        threads: []
    }
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
                mergeBase: parsed.mergeBase ?? null
            }
        }
    } catch {
        return { ok: false, error: 'Invalid review file JSON' }
    }
}
