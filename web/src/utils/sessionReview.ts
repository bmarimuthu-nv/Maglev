type ReviewUrlOptions = {
    mode?: 'branch' | 'working'
    path?: string | null
    threadId?: string | null
}

export function buildSessionReviewUrl(baseUrl: string, sessionId: string, options?: ReviewUrlOptions): string {
    const base = new URL(baseUrl)
    const prefix = base.pathname.replace(/\/+$/, '')
    const params = new URLSearchParams()

    if (options?.mode) {
        params.set('mode', options.mode)
    }
    if (options?.path) {
        params.set('path', options.path)
    }
    if (options?.threadId) {
        params.set('threadId', options.threadId)
    }

    const url = new URL(`${prefix}/sessions/${encodeURIComponent(sessionId)}/review`, base.origin)
    url.search = params.toString()
    return url.toString()
}

export function openSessionReviewWindow(baseUrl: string, sessionId: string, options?: ReviewUrlOptions): void {
    const url = buildSessionReviewUrl(baseUrl, sessionId, options)
    window.open(url, '_blank', 'noopener,noreferrer')
}
