export type GitHubDeviceCode = {
    deviceCode: string
    userCode: string
    verificationUri: string
    verificationUriComplete?: string
    expiresIn: number
    interval: number
}

export type GitHubIdentity = {
    userId: number
    login: string
    name?: string
    accessToken: string
}

type GitHubDeviceCodeResponse = {
    device_code?: string
    user_code?: string
    verification_uri?: string
    verification_uri_complete?: string
    expires_in?: number
    interval?: number
    error?: string
    error_description?: string
}

type GitHubAccessTokenResponse = {
    access_token?: string
    error?: string
    error_description?: string
}

type GitHubUserResponse = {
    id?: number
    login?: string
    name?: string | null
}

const GITHUB_DEVICE_CODE_URL = 'https://github.com/login/device/code'
const GITHUB_ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token'
const GITHUB_USER_URL = 'https://api.github.com/user'

function buildFormBody(values: Record<string, string>): URLSearchParams {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(values)) {
        params.set(key, value)
    }
    return params
}

async function parseJsonResponse<T>(res: Response): Promise<T> {
    const body = await res.text()
    try {
        return JSON.parse(body) as T
    } catch {
        throw new Error(`Unexpected GitHub response: ${body}`)
    }
}

export async function startGitHubDeviceFlow(clientId: string): Promise<GitHubDeviceCode> {
    const res = await fetch(GITHUB_DEVICE_CODE_URL, {
        method: 'POST',
        headers: {
            accept: 'application/json',
            'content-type': 'application/x-www-form-urlencoded'
        },
        body: buildFormBody({
            client_id: clientId,
            scope: 'read:user'
        })
    })

    const payload = await parseJsonResponse<GitHubDeviceCodeResponse>(res)
    if (!res.ok) {
        throw new Error(payload.error_description || payload.error || 'Failed to start GitHub device flow')
    }
    if (!payload.device_code || !payload.user_code || !payload.verification_uri || !payload.expires_in || !payload.interval) {
        throw new Error('GitHub device flow response missing required fields')
    }

    return {
        deviceCode: payload.device_code,
        userCode: payload.user_code,
        verificationUri: payload.verification_uri,
        verificationUriComplete: payload.verification_uri_complete,
        expiresIn: payload.expires_in,
        interval: payload.interval
    }
}

export async function completeGitHubDeviceFlow(clientId: string, deviceCode: string): Promise<
    | { status: 'authorization_pending' | 'slow_down' | 'expired_token' | 'access_denied' }
    | { status: 'authorized'; identity: GitHubIdentity }
> {
    const res = await fetch(GITHUB_ACCESS_TOKEN_URL, {
        method: 'POST',
        headers: {
            accept: 'application/json',
            'content-type': 'application/x-www-form-urlencoded'
        },
        body: buildFormBody({
            client_id: clientId,
            device_code: deviceCode,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
        })
    })

    const payload = await parseJsonResponse<GitHubAccessTokenResponse>(res)
    if (payload.error === 'authorization_pending' || payload.error === 'slow_down' || payload.error === 'expired_token' || payload.error === 'access_denied') {
        return { status: payload.error }
    }
    if (!res.ok) {
        throw new Error(payload.error_description || payload.error || 'Failed to complete GitHub device flow')
    }
    if (!payload.access_token) {
        throw new Error('GitHub device flow response missing access token')
    }

    const identityRes = await fetch(GITHUB_USER_URL, {
        headers: {
            accept: 'application/vnd.github+json',
            authorization: `Bearer ${payload.access_token}`,
            'x-github-api-version': '2022-11-28'
        }
    })
    const identityPayload = await parseJsonResponse<GitHubUserResponse>(identityRes)
    if (!identityRes.ok) {
        throw new Error('Failed to fetch authenticated GitHub user')
    }
    if (typeof identityPayload.id !== 'number' || typeof identityPayload.login !== 'string') {
        throw new Error('GitHub user response missing required fields')
    }

    return {
        status: 'authorized',
        identity: {
            userId: identityPayload.id,
            login: identityPayload.login,
            name: identityPayload.name ?? undefined,
            accessToken: payload.access_token
        }
    }
}
