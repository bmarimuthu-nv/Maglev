import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

function getBrokerHome(): string {
    return join(homedir(), '.maglev')
}

export function getBrokerKeyPath(): string {
    return join(getBrokerHome(), 'server-key')
}

export function getBrokerUrlPath(): string {
    return join(getBrokerHome(), 'server-url')
}

function getLegacyBrokerKeyPath(): string {
    return join(getBrokerHome(), 'broker-key')
}

function getLegacyBrokerUrlPath(): string {
    return join(getBrokerHome(), 'broker-url')
}

export type RemoteGitHubAuthState = {
    githubOauthClientId?: string
    githubAuth?: {
        provider: 'github'
        accessToken: string
        userId: number
        login: string
        name?: string
    }
}

export function getRemoteGitHubAuthPath(): string {
    return join(getBrokerHome(), 'github-auth.json')
}

function generateBrokerKey(): string {
    return randomBytes(32).toString('base64url')
}

export async function getOrCreateBrokerKey(): Promise<{ key: string; path: string; created: boolean }> {
    const path = getBrokerKeyPath()
    if (existsSync(path)) {
        const key = (await readFile(path, 'utf8')).trim()
        if (!key) {
            throw new Error(`Server key file is empty: ${path}`)
        }
        return { key, path, created: false }
    }

    const legacyPath = getLegacyBrokerKeyPath()
    if (existsSync(legacyPath)) {
        const key = (await readFile(legacyPath, 'utf8')).trim()
        if (!key) {
            throw new Error(`Legacy broker key file is empty: ${legacyPath}`)
        }
        await mkdir(dirname(path), { recursive: true, mode: 0o700 })
        await writeFile(path, `${key}\n`, { mode: 0o600 })
        return { key, path, created: false }
    }

    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    const key = generateBrokerKey()
    await writeFile(path, `${key}\n`, { mode: 0o600 })
    return { key, path, created: true }
}

export async function writeBrokerUrl(publicUrl: string): Promise<string> {
    const path = getBrokerUrlPath()
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    await writeFile(path, `${publicUrl.trim()}\n`, { mode: 0o600 })
    return path
}

export async function readBrokerUrl(): Promise<{ url: string; path: string } | null> {
    const path = getBrokerUrlPath()
    if (!existsSync(path)) {
        const legacyPath = getLegacyBrokerUrlPath()
        if (!existsSync(legacyPath)) {
            return null
        }

        const legacyUrl = (await readFile(legacyPath, 'utf8')).trim()
        if (!legacyUrl) {
            throw new Error(`Legacy broker URL file is empty: ${legacyPath}`)
        }
        await mkdir(dirname(path), { recursive: true, mode: 0o700 })
        await writeFile(path, `${legacyUrl}\n`, { mode: 0o600 })
        return { url: legacyUrl, path }
    }

    const url = (await readFile(path, 'utf8')).trim()
    if (!url) {
        throw new Error(`Server URL file is empty: ${path}`)
    }
    return { url, path }
}

export async function readRemoteGitHubAuthState(): Promise<{ state: RemoteGitHubAuthState; path: string } | null> {
    const path = getRemoteGitHubAuthPath()
    if (!existsSync(path)) {
        return null
    }

    const content = await readFile(path, 'utf8')
    const state = JSON.parse(content) as RemoteGitHubAuthState
    return { state, path }
}

export async function writeRemoteGitHubAuthState(state: RemoteGitHubAuthState): Promise<string> {
    const path = getRemoteGitHubAuthPath()
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
    return path
}
