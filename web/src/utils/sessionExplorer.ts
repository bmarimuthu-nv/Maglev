import { encodeBase64 } from '@/lib/utils'

type ExplorerUrlOptions = {
    tab?: 'changes' | 'directories'
    path?: string | null
    staged?: boolean
    line?: number | null
}

export function buildSessionExplorerUrl(baseUrl: string, sessionId: string, options?: ExplorerUrlOptions): string {
    const base = new URL(baseUrl)
    const prefix = base.pathname.replace(/\/+$/, '')
    const params = new URLSearchParams()

    const tab = options?.tab ?? 'directories'
    params.set('tab', tab)

    if (options?.path) {
        params.set('path', encodeBase64(options.path))
    }
    if (options?.staged !== undefined) {
        params.set('staged', options.staged ? 'true' : 'false')
    }
    if (options?.line && Number.isFinite(options.line) && options.line > 0) {
        params.set('line', `${Math.floor(options.line)}`)
    }

    const url = new URL(`${prefix}/sessions/${encodeURIComponent(sessionId)}/files`, base.origin)
    url.search = params.toString()
    return url.toString()
}

export function openSessionExplorerWindow(baseUrl: string, sessionId: string, options?: ExplorerUrlOptions): void {
    const url = buildSessionExplorerUrl(baseUrl, sessionId, options)
    window.open(url, '_blank', 'noopener,noreferrer')
}
