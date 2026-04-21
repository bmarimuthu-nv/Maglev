import type {
    AttachmentMetadata,
    AuthMethodsResponse,
    AuthResponse,
    DeleteUploadResponse,
    ListDirectoryResponse,
    FileReadResponse,
    FileSearchResponse,
    GitHubDevicePollResponse,
    GitHubDeviceStartResponse,
    GitCommandResponse,
    HubConfigResponse,
    MachinePathsExistsResponse,
    PushSubscriptionPayload,
    PushUnsubscribePayload,
    PushVapidPublicKeyResponse,
    SpawnResponse,
    UploadFileResponse,
    VisibilityPayload,
    WriteFileResponse,
    SessionResponse,
    SessionsResponse
    ,
    TerminalSupervisionTargetResponse,
    SpawnTerminalPairResponse
} from '@/types/api'

type ApiClientOptions = {
    baseUrl?: string
    getToken?: () => string | null
    onUnauthorized?: () => Promise<string | null>
}

type ErrorPayload = {
    error?: unknown
}

function parseErrorCode(bodyText: string): string | undefined {
    try {
        const parsed = JSON.parse(bodyText) as ErrorPayload
        return typeof parsed.error === 'string' ? parsed.error : undefined
    } catch {
        return undefined
    }
}

export class ApiError extends Error {
    status: number
    code?: string
    body?: string

    constructor(message: string, status: number, code?: string, body?: string) {
        super(message)
        this.name = 'ApiError'
        this.status = status
        this.code = code
        this.body = body
    }
}

export class ApiClient {
    private token: string
    private readonly baseUrl: string | null
    private readonly getToken: (() => string | null) | null
    private readonly onUnauthorized: (() => Promise<string | null>) | null

    constructor(token: string, options?: ApiClientOptions) {
        this.token = token
        this.baseUrl = options?.baseUrl ?? null
        this.getToken = options?.getToken ?? null
        this.onUnauthorized = options?.onUnauthorized ?? null
    }

    private buildUrl(path: string): string {
        if (!this.baseUrl) {
            return path
        }
        try {
            const base = new URL(this.baseUrl)
            const normalizedPath = path.startsWith('/')
                ? path.slice(1)
                : path
            const prefix = base.pathname.replace(/\/+$/, '')
            const joinedPath = prefix ? `${prefix}/${normalizedPath}` : `/${normalizedPath}`
            return new URL(joinedPath, base.origin).toString()
        } catch {
            return path
        }
    }

    private async request<T>(
        path: string,
        init?: RequestInit,
        attempt: number = 0,
        overrideToken?: string | null
    ): Promise<T> {
        const headers = new Headers(init?.headers)
        const liveToken = this.getToken ? this.getToken() : null
        const authToken = overrideToken !== undefined
            ? (overrideToken ?? (liveToken ?? this.token))
            : (liveToken ?? this.token)
        if (authToken) {
            headers.set('authorization', `Bearer ${authToken}`)
        }
        if (init?.body !== undefined && !headers.has('content-type')) {
            headers.set('content-type', 'application/json')
        }

        const res = await fetch(this.buildUrl(path), {
            ...init,
            headers
        })

        if (res.status === 401) {
            if (attempt === 0 && this.onUnauthorized) {
                const refreshed = await this.onUnauthorized()
                if (refreshed) {
                    this.token = refreshed
                    return await this.request<T>(path, init, attempt + 1, refreshed)
                }
            }
            throw new ApiError('Session expired. Please sign in again.', 401)
        }

        if (!res.ok) {
            const body = await res.text().catch(() => '')
            const code = parseErrorCode(body)
            throw new ApiError(`HTTP ${res.status} ${res.statusText}: ${body}`, res.status, code, body || undefined)
        }

        return await res.json() as T
    }

    async authenticate(auth: { initData: string } | { accessToken: string }): Promise<AuthResponse> {
        const res = await fetch(this.buildUrl('/api/auth'), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(auth)
        })

        if (!res.ok) {
            const body = await res.text().catch(() => '')
            const code = parseErrorCode(body)
            const detail = body ? `: ${body}` : ''
            throw new ApiError(`Auth failed: HTTP ${res.status} ${res.statusText}${detail}`, res.status, code, body || undefined)
        }

        return await res.json() as AuthResponse
    }

    async authenticateBrokerSession(): Promise<AuthResponse> {
        const res = await fetch(this.buildUrl('/api/auth/broker'), {
            method: 'POST'
        })

        if (!res.ok) {
            const body = await res.text().catch(() => '')
            const code = parseErrorCode(body)
            const detail = body ? `: ${body}` : ''
            throw new ApiError(`Broker auth failed: HTTP ${res.status} ${res.statusText}${detail}`, res.status, code, body || undefined)
        }

        return await res.json() as AuthResponse
    }

    async getAuthMethods(): Promise<AuthMethodsResponse> {
        const res = await fetch(this.buildUrl('/api/auth/methods'))
        if (!res.ok) {
            const body = await res.text().catch(() => '')
            throw new ApiError(`Auth methods failed: HTTP ${res.status} ${res.statusText}: ${body}`, res.status, parseErrorCode(body), body || undefined)
        }
        return await res.json() as AuthMethodsResponse
    }

    async startGitHubDeviceAuth(): Promise<GitHubDeviceStartResponse> {
        const res = await fetch(this.buildUrl('/api/github/device/start'), {
            method: 'POST'
        })
        if (!res.ok) {
            const body = await res.text().catch(() => '')
            throw new ApiError(`GitHub device auth start failed: HTTP ${res.status} ${res.statusText}: ${body}`, res.status, parseErrorCode(body), body || undefined)
        }
        return await res.json() as GitHubDeviceStartResponse
    }

    async pollGitHubDeviceAuth(deviceCode: string): Promise<GitHubDevicePollResponse> {
        const res = await fetch(this.buildUrl('/api/github/device/poll'), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ deviceCode })
        })
        if (!res.ok) {
            const body = await res.text().catch(() => '')
            throw new ApiError(`GitHub device auth poll failed: HTTP ${res.status} ${res.statusText}: ${body}`, res.status, parseErrorCode(body), body || undefined)
        }
        return await res.json() as GitHubDevicePollResponse
    }

    async bind(auth: { initData: string; accessToken: string }): Promise<AuthResponse> {
        const res = await fetch(this.buildUrl('/api/bind'), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(auth)
        })

        if (!res.ok) {
            const body = await res.text().catch(() => '')
            const code = parseErrorCode(body)
            const detail = body ? `: ${body}` : ''
            throw new ApiError(`Bind failed: HTTP ${res.status} ${res.statusText}${detail}`, res.status, code, body || undefined)
        }

        return await res.json() as AuthResponse
    }

    async createEventsTicket(): Promise<{ ticket: string }> {
        return await this.request<{ ticket: string }>('/api/events/ticket', {
            method: 'POST'
        })
    }

    async getSessions(): Promise<SessionsResponse> {
        return await this.request<SessionsResponse>('/api/sessions')
    }

    async getPushVapidPublicKey(): Promise<PushVapidPublicKeyResponse> {
        return await this.request<PushVapidPublicKeyResponse>('/api/push/vapid-public-key')
    }

    async subscribePushNotifications(payload: PushSubscriptionPayload): Promise<void> {
        await this.request('/api/push/subscribe', {
            method: 'POST',
            body: JSON.stringify(payload)
        })
    }

    async unsubscribePushNotifications(payload: PushUnsubscribePayload): Promise<void> {
        await this.request('/api/push/subscribe', {
            method: 'DELETE',
            body: JSON.stringify(payload)
        })
    }

    async setVisibility(payload: VisibilityPayload): Promise<void> {
        await this.request('/api/visibility', {
            method: 'POST',
            body: JSON.stringify(payload)
        })
    }

    async getSession(sessionId: string): Promise<SessionResponse> {
        return await this.request<SessionResponse>(`/api/sessions/${encodeURIComponent(sessionId)}`)
    }

    async getGitStatus(sessionId: string): Promise<GitCommandResponse> {
        return await this.request<GitCommandResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/git-status`)
    }

    async getGitDiffNumstat(sessionId: string, staged: boolean): Promise<GitCommandResponse> {
        const params = new URLSearchParams()
        params.set('staged', staged ? 'true' : 'false')
        return await this.request<GitCommandResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/git-diff-numstat?${params.toString()}`)
    }

    async getGitDiffFile(sessionId: string, path: string, staged?: boolean): Promise<GitCommandResponse> {
        const params = new URLSearchParams()
        params.set('path', path)
        if (staged !== undefined) {
            params.set('staged', staged ? 'true' : 'false')
        }
        return await this.request<GitCommandResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/git-diff-file?${params.toString()}`)
    }

    async getReviewSummary(sessionId: string, mode: 'branch' | 'working'): Promise<import('@/types/api').ReviewSummaryResponse> {
        const params = new URLSearchParams()
        params.set('mode', mode)
        return await this.request<import('@/types/api').ReviewSummaryResponse>(
            `/api/sessions/${encodeURIComponent(sessionId)}/review-summary?${params.toString()}`
        )
    }

    async getReviewFile(sessionId: string, path: string, mode: 'branch' | 'working'): Promise<GitCommandResponse> {
        const params = new URLSearchParams()
        params.set('path', path)
        params.set('mode', mode)
        return await this.request<GitCommandResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/review-file?${params.toString()}`)
    }

    async searchSessionFiles(sessionId: string, query: string, limit?: number): Promise<FileSearchResponse> {
        const params = new URLSearchParams()
        if (query) {
            params.set('query', query)
        }
        if (limit !== undefined) {
            params.set('limit', `${limit}`)
        }
        const qs = params.toString()
        return await this.request<FileSearchResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/files${qs ? `?${qs}` : ''}`)
    }

    async readSessionFile(sessionId: string, path: string): Promise<FileReadResponse> {
        const params = new URLSearchParams()
        params.set('path', path)
        return await this.request<FileReadResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/file?${params.toString()}`)
    }

    async writeSessionFile(
        sessionId: string,
        path: string,
        content: string,
        expectedHash?: string | null
    ): Promise<WriteFileResponse> {
        return await this.request<WriteFileResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/file`, {
            method: 'POST',
            body: JSON.stringify({ path, content, expectedHash })
        })
    }

    async listSessionDirectory(sessionId: string, path?: string): Promise<ListDirectoryResponse> {
        const params = new URLSearchParams()
        if (path) {
            params.set('path', path)
        }

        const qs = params.toString()
        return await this.request<ListDirectoryResponse>(
            `/api/sessions/${encodeURIComponent(sessionId)}/directory${qs ? `?${qs}` : ''}`
        )
    }

    async uploadFile(sessionId: string, filename: string, content: string, mimeType: string): Promise<UploadFileResponse> {
        return await this.request<UploadFileResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/upload`, {
            method: 'POST',
            body: JSON.stringify({ filename, content, mimeType })
        })
    }

    async deleteUploadFile(sessionId: string, path: string): Promise<DeleteUploadResponse> {
        return await this.request<DeleteUploadResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/upload/delete`, {
            method: 'POST',
            body: JSON.stringify({ path })
        })
    }

    async abortSession(sessionId: string): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/abort`, {
            method: 'POST',
            body: JSON.stringify({})
        })
    }

    async archiveSession(sessionId: string): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/archive`, {
            method: 'POST',
            body: JSON.stringify({})
        })
    }

    async switchSession(sessionId: string): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/switch`, {
            method: 'POST',
            body: JSON.stringify({})
        })
    }


    async approvePermission(
        sessionId: string,
        requestId: string,
        modeOrOptions?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | {
            mode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan'
            allowTools?: string[]
            decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort'
            answers?: Record<string, string[]> | Record<string, { answers: string[] }>
        }
    ): Promise<void> {
        const body = typeof modeOrOptions === 'string' || modeOrOptions === undefined
            ? { mode: modeOrOptions }
            : modeOrOptions
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/permissions/${encodeURIComponent(requestId)}/approve`, {
            method: 'POST',
            body: JSON.stringify(body)
        })
    }

    async denyPermission(
        sessionId: string,
        requestId: string,
        options?: {
            decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort'
        }
    ): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/permissions/${encodeURIComponent(requestId)}/deny`, {
            method: 'POST',
            body: JSON.stringify(options ?? {})
        })
    }

    async getHubConfig(): Promise<HubConfigResponse> {
        return await this.request<HubConfigResponse>('/api/hub')
    }

    async checkHubPathsExists(paths: string[]): Promise<MachinePathsExistsResponse> {
        return await this.request<MachinePathsExistsResponse>('/api/hub/paths/exists', {
            method: 'POST',
            body: JSON.stringify({ paths })
        })
    }

    async spawnHubSession(
        directory: string,
        name?: string,
        notesPath?: string,
        createNotesFile?: boolean,
        pinned?: boolean,
        autoRespawn?: boolean,
        startupCommand?: string,
        sessionType?: 'simple' | 'worktree',
        worktreeName?: string,
        parentSessionId?: string
    ): Promise<SpawnResponse> {
        return await this.request<SpawnResponse>('/api/hub/spawn', {
            method: 'POST',
            body: JSON.stringify({ directory, name, notesPath, createNotesFile, pinned, autoRespawn, startupCommand, sessionType, worktreeName, parentSessionId })
        })
    }

    async spawnTerminalPair(
        directory: string,
        name: string
    ): Promise<SpawnTerminalPairResponse> {
        return await this.request<SpawnTerminalPairResponse>('/api/hub/spawn-pair', {
            method: 'POST',
            body: JSON.stringify({ directory, name })
        })
    }

    async updateSession(sessionId: string, updates: {
        name?: string
        directory?: string
    }): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}`, {
            method: 'PATCH',
            body: JSON.stringify(updates)
        })
    }

    async deleteSession(sessionId: string): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}`, {
            method: 'DELETE'
        })
    }

    async closeSession(sessionId: string): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/close`, {
            method: 'POST'
        })
    }

    async renameSession(sessionId: string, name: string): Promise<void> {
        await this.updateSession(sessionId, { name })
    }

    async setSessionPinned(sessionId: string, pinned: boolean): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/pin`, {
            method: 'PATCH',
            body: JSON.stringify({ pinned })
        })
    }

    async readSessionNotes(sessionId: string): Promise<{ success: boolean; content: string | null; error?: string }> {
        return await this.request<{ success: boolean; content: string | null; error?: string }>(
            `/api/sessions/${encodeURIComponent(sessionId)}/notes`
        )
    }

    async writeSessionNotes(sessionId: string, content: string): Promise<{ ok?: boolean; error?: string }> {
        return await this.request<{ ok?: boolean; error?: string }>(
            `/api/sessions/${encodeURIComponent(sessionId)}/notes`,
            { method: 'POST', body: JSON.stringify({ content }) }
        )
    }

    async setShellSessionOptions(sessionId: string, options: {
        pinned?: boolean
        autoRespawn?: boolean
        startupCommand?: string | null
    }): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/shell-options`, {
            method: 'PATCH',
            body: JSON.stringify(options)
        })
    }

    async respawnPinnedShellSession(sessionId: string): Promise<{ type: 'success'; sessionId: string }> {
        return await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/respawn-pinned-shell`, {
            method: 'POST'
        })
    }

    async getTerminalSupervisionTarget(sessionId: string): Promise<TerminalSupervisionTargetResponse> {
        return await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/terminal-supervision/target`)
    }

    async attachTerminalSupervision(sessionId: string, workerSessionId: string): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/terminal-supervision/attach`, {
            method: 'POST',
            body: JSON.stringify({ workerSessionId })
        })
    }

    async setTerminalSupervisionPaused(sessionId: string, paused: boolean): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/terminal-supervision/pause`, {
            method: 'POST',
            body: JSON.stringify({ paused })
        })
    }

    async detachTerminalSupervision(sessionId: string): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/terminal-supervision/detach`, {
            method: 'POST'
        })
    }

    async writeTerminalSupervisionInput(sessionId: string, data: string): Promise<{
        delivered: boolean
        blockedReason?: 'paused' | 'human_override'
    }> {
        return await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/terminal-supervision/write`, {
            method: 'POST',
            body: JSON.stringify({ data })
        })
    }

    async restartTerminalPair(sessionId: string): Promise<SpawnTerminalPairResponse> {
        return await this.request<SpawnTerminalPairResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/terminal-pair/restart`, {
            method: 'POST'
        })
    }

    async setTerminalPairPaused(sessionId: string, paused: boolean): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/terminal-pair/pause`, {
            method: 'POST',
            body: JSON.stringify({ paused })
        })
    }

    async rebindTerminalPair(sessionId: string, replacementSessionId: string): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/terminal-pair/rebind`, {
            method: 'POST',
            body: JSON.stringify({ replacementSessionId })
        })
    }

    async addTerminalPairSupervisor(
        sessionId: string,
        options: { name: string }
    ): Promise<SpawnTerminalPairResponse> {
        return await this.request<SpawnTerminalPairResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/terminal-pair/add-supervisor`, {
            method: 'POST',
            body: JSON.stringify(options)
        })
    }

}
