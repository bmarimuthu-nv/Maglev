import { randomUUID } from 'node:crypto'
import { createServer } from 'node:net'
import { hostname as getHostname } from 'node:os'
import type { ServerWebSocket } from 'bun'
import { readRemoteGitHubAuthState, getOrCreateBrokerKey, writeBrokerUrl } from './key'
import { GitHubDeviceAuthService } from '../github/deviceAuth'
import { BROKER_SESSION_HEADER, signBrokerSessionToken, verifyBrokerSessionToken } from '../web/brokerSession'
import type { HubLaunchFolder } from '../hubConfig'

type BrokerConfig = {
    host: string
    port: number
    publicUrl: string
    token: string | null
    tokenPath: string | null
    tokenCreated: boolean
}

type BrokerAuthConfig = {
    gitHubDeviceAuth: GitHubDeviceAuthService | null
}

type BrokerUserSession = {
    uid: number
    login: string
    token: string
}

const DEFAULT_GITHUB_OAUTH_CLIENT_ID = 'Ov23liS6nujzeYeDnZxL'
const BROKER_SESSION_COOKIE = 'maglev_broker_session'

type RegisterHubMessage = {
    type: 'register'
    hubId: string
    owner: string
    jobId?: string | null
    jobName?: string | null
    hostname?: string | null
    localUrl: string
    launchFolders?: HubLaunchFolder[]
    configError?: string | null
}

type PingMessage = {
    type: 'ping'
}

type ProxyRequestMessage = {
    type: 'proxy-request'
    requestId: string
    method: string
    path: string
    query: string
    headers: Record<string, string>
    bodyBase64?: string
}

type ProxyResponseMessage = {
    type: 'proxy-response'
    requestId: string
    status: number
    headers: Record<string, string>
    bodyBase64?: string
}

type ProxyStreamStartMessage = {
    type: 'proxy-stream-start'
    requestId: string
    status: number
    headers: Record<string, string>
}

type ProxyStreamChunkMessage = {
    type: 'proxy-stream-chunk'
    requestId: string
    chunkBase64: string
}

type ProxyStreamEndMessage = {
    type: 'proxy-stream-end'
    requestId: string
}

type ProxyWsOpenMessage = {
    type: 'proxy-ws-open'
    wsId: string
    path: string
    query: string
    headers: Record<string, string>
}

type ProxyWsDataMessage = {
    type: 'proxy-ws-data'
    wsId: string
    dataBase64: string
    isText?: boolean
}

type ProxyWsCloseMessage = {
    type: 'proxy-ws-close'
    wsId: string
}

type HubSocketData = {
    role: 'hub' | 'browser'
    clientId: string
    hubId: string | null
    wsId: string | null
}

type RegisteredHub = {
    hubId: string
    owner: string
    jobId: string | null
    jobName: string | null
    hostname: string | null
    localUrl: string
    createdAt: number
    lastSeenAt: number
    publicUrl: string
    socket: ServerWebSocket<HubSocketData> | null
    launchFolders: HubLaunchFolder[]
    configError: string | null
}

const HUB_TTL_MS = 120_000
const RECENT_HUB_RETENTION_MS = 24 * 60 * 60 * 1000
const REQUEST_TIMEOUT_MS = 30_000
const registry = new Map<string, RegisteredHub>()
const recentRegistry = new Map<string, RegisteredHub>()
const socketHubMap = new Map<string, string>()
const browserWsMap = new Map<string, ServerWebSocket<HubSocketData>>()
const pendingRequests = new Map<string, {
    targetClientId?: string
    resolve: (response: ProxyResponseMessage | ProxyStreamStartMessage) => void
    reject: (error: Error) => void
}>()
const pendingStreams = new Map<string, ReadableStreamDefaultController<Uint8Array>>()

function getEnv(name: string): string | undefined {
    const value = process.env[name]?.trim()
    return value ? value : undefined
}

async function findFreePort(): Promise<number> {
    return await new Promise<number>((resolve, reject) => {
        const server = createServer()
        server.listen(0, '0.0.0.0', () => {
            const address = server.address()
            if (!address || typeof address === 'string') {
                server.close(() => reject(new Error('Failed to determine an available broker port')))
                return
            }
            const { port } = address
            server.close((error) => {
                if (error) {
                    reject(error)
                    return
                }
                resolve(port)
            })
        })
        server.on('error', reject)
    })
}

async function getBrokerConfig(): Promise<BrokerConfig> {
    const host = getEnv('MAGLEV_BROKER_LISTEN_HOST') ?? '0.0.0.0'
    const portValue = getEnv('MAGLEV_BROKER_LISTEN_PORT')
    let port: number

    if (portValue) {
        port = Number.parseInt(portValue, 10)
        if (!Number.isFinite(port) || port <= 0 || port > 65535) {
            throw new Error(`Invalid MAGLEV_BROKER_LISTEN_PORT: ${portValue}`)
        }
    } else {
        port = await findFreePort()
    }

    const publicUrl = getEnv('MAGLEV_BROKER_PUBLIC_URL') ?? `http://${getHostname()}:${port}`
    const configuredToken = getEnv('MAGLEV_BROKER_TOKEN')
    if (configuredToken) {
        return {
            host,
            port,
            publicUrl,
            token: configuredToken,
            tokenPath: null,
            tokenCreated: false
        }
    }

    const { key, path, created } = await getOrCreateBrokerKey()
    return {
        host,
        port,
        publicUrl,
        token: key,
        tokenPath: path,
        tokenCreated: created
    }
}

function parseAllowedUsers(raw: string): string[] {
    return Array.from(new Set(
        raw
            .split(',')
            .map((item) => item.trim().toLowerCase())
            .filter(Boolean)
    ))
}

async function getBrokerAuthConfig(): Promise<BrokerAuthConfig> {
    const bootstrapped = await readRemoteGitHubAuthState()
    const clientId = getEnv('MAGLEV_GITHUB_OAUTH_CLIENT_ID')
        ?? bootstrapped?.state.githubOauthClientId
        ?? DEFAULT_GITHUB_OAUTH_CLIENT_ID
    const owner = getEnv('MAGLEV_GITHUB_OWNER')?.toLowerCase() ?? bootstrapped?.state.githubAuth?.login?.toLowerCase() ?? null
    const allowlist = getEnv('MAGLEV_GITHUB_ALLOWED_USERS')
        ? parseAllowedUsers(getEnv('MAGLEV_GITHUB_ALLOWED_USERS')!)
        : []
    const allowedUsers = owner
        ? [owner]
        : allowlist

    if (!clientId || allowedUsers.length === 0) {
        return { gitHubDeviceAuth: null }
    }

    return {
        gitHubDeviceAuth: new GitHubDeviceAuthService({
            clientId,
            allowedUsers
        })
    }
}

function getCookieValue(req: Request, name: string): string | null {
    const cookie = req.headers.get('cookie')
    if (!cookie) {
        return null
    }
    const prefix = `${name}=`
    for (const part of cookie.split(';')) {
        const trimmed = part.trim()
        if (trimmed.startsWith(prefix)) {
            return decodeURIComponent(trimmed.slice(prefix.length))
        }
    }
    return null
}

async function getBrokerSession(req: Request): Promise<BrokerUserSession | null> {
    const token = getCookieValue(req, BROKER_SESSION_COOKIE)
    if (!token) {
        return null
    }
    const verified = await verifyBrokerSessionToken(token)
    if (!verified) {
        return null
    }
    return {
        ...verified,
        token
    }
}

function buildBrokerSessionCookie(token: string): string {
    return `${BROKER_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}`
}

function buildClearedBrokerSessionCookie(): string {
    return `${BROKER_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
}

function rememberHub(hub: RegisteredHub): void {
    recentRegistry.set(hub.hubId, { ...hub, socket: null })
}

function pruneExpiredHubs(): void {
    const cutoff = Date.now() - HUB_TTL_MS
    for (const [hubId, hub] of registry.entries()) {
        if (hub.lastSeenAt < cutoff) {
            rememberHub(hub)
            registry.delete(hubId)
        }
    }
}

function pruneRecentHubs(): void {
    const cutoff = Date.now() - RECENT_HUB_RETENTION_MS
    for (const [hubId, hub] of recentRegistry.entries()) {
        if (hub.lastSeenAt < cutoff) {
            recentRegistry.delete(hubId)
        }
    }
}

function listActiveHubs(): RegisteredHub[] {
    pruneExpiredHubs()
    return Array.from(registry.values())
        .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
}

function listRecentHubs(): RegisteredHub[] {
    pruneExpiredHubs()
    pruneRecentHubs()
    const activeHubIds = new Set(registry.keys())
    return Array.from(recentRegistry.values())
        .filter((hub) => !activeHubIds.has(hub.hubId))
        .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
}

function htmlEscape(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
}

function decodeBase64(value?: string): Uint8Array {
    if (!value) {
        return new Uint8Array()
    }
    return new Uint8Array(Buffer.from(value, 'base64'))
}

function encodeBase64(value: Uint8Array): string {
    return Buffer.from(value).toString('base64')
}

function rewriteHtmlForHubPrefix(html: string, hubId: string): string {
    const prefix = `/h/${encodeURIComponent(hubId)}`
    return html
        .replace(/(src|href)=["']\/(?!\/)/g, `$1="${prefix}/`)
        .replace(/content=["']\/(?!\/)/g, `content="${prefix}/`)
}

function validateRegisterHubMessage(value: unknown): RegisterHubMessage {
    if (!value || typeof value !== 'object') {
        throw new Error('Message must be an object')
    }

    const record = value as Record<string, unknown>
    const type = record.type
    const hubId = typeof record.hubId === 'string' ? record.hubId.trim() : ''
    const owner = typeof record.owner === 'string' ? record.owner.trim().toLowerCase() : ''
    const localUrl = typeof record.localUrl === 'string' ? record.localUrl.trim() : ''
    const jobId = typeof record.jobId === 'string' && record.jobId.trim() ? record.jobId.trim() : null
    const jobName = typeof record.jobName === 'string' && record.jobName.trim() ? record.jobName.trim() : null
    const hostname = typeof record.hostname === 'string' && record.hostname.trim() ? record.hostname.trim() : null
    const configError = typeof record.configError === 'string' && record.configError.trim()
        ? record.configError.trim()
        : null
    const launchFolders = Array.isArray(record.launchFolders)
        ? record.launchFolders
            .filter((entry): entry is HubLaunchFolder => {
                if (!entry || typeof entry !== 'object') {
                    return false
                }
                const candidate = entry as Record<string, unknown>
                return typeof candidate.label === 'string'
                    && typeof candidate.path === 'string'
                    && (candidate.branch === undefined || typeof candidate.branch === 'string')
                    && (candidate.source === 'path' || candidate.source === 'wt')
            })
            .map((entry) => ({
                label: entry.label.trim(),
                path: entry.path.trim(),
                branch: entry.branch?.trim() || undefined,
                source: entry.source
            }))
            .filter((entry) => entry.label.length > 0 && entry.path.length > 0)
        : []

    if (type !== 'register') {
        throw new Error('Message type must be register')
    }
    if (!hubId) {
        throw new Error('hubId is required')
    }
    if (!owner) {
        throw new Error('owner is required')
    }
    if (!localUrl) {
        throw new Error('localUrl is required')
    }

    return {
        type: 'register',
        hubId,
        owner,
        jobId,
        jobName,
        hostname,
        localUrl,
        launchFolders,
        configError
    }
}

function isProxyResponseMessage(value: unknown): value is ProxyResponseMessage {
    if (!value || typeof value !== 'object') {
        return false
    }
    const record = value as Record<string, unknown>
    return record.type === 'proxy-response'
        && typeof record.requestId === 'string'
        && typeof record.status === 'number'
        && typeof record.headers === 'object'
}

function isProxyStreamStartMessage(value: unknown): value is ProxyStreamStartMessage {
    if (!value || typeof value !== 'object') {
        return false
    }
    const record = value as Record<string, unknown>
    return record.type === 'proxy-stream-start'
        && typeof record.requestId === 'string'
        && typeof record.status === 'number'
        && typeof record.headers === 'object'
}

function isProxyStreamChunkMessage(value: unknown): value is ProxyStreamChunkMessage {
    if (!value || typeof value !== 'object') {
        return false
    }
    const record = value as Record<string, unknown>
    return record.type === 'proxy-stream-chunk'
        && typeof record.requestId === 'string'
        && typeof record.chunkBase64 === 'string'
}

function isProxyStreamEndMessage(value: unknown): value is ProxyStreamEndMessage {
    if (!value || typeof value !== 'object') {
        return false
    }
    const record = value as Record<string, unknown>
    return record.type === 'proxy-stream-end'
        && typeof record.requestId === 'string'
}

function isProxyWsDataMessage(value: unknown): value is ProxyWsDataMessage {
    if (!value || typeof value !== 'object') {
        return false
    }
    const record = value as Record<string, unknown>
    return record.type === 'proxy-ws-data'
        && typeof record.wsId === 'string'
        && typeof record.dataBase64 === 'string'
}

function isProxyWsCloseMessage(value: unknown): value is ProxyWsCloseMessage {
    if (!value || typeof value !== 'object') {
        return false
    }
    const record = value as Record<string, unknown>
    return record.type === 'proxy-ws-close'
        && typeof record.wsId === 'string'
}

function renderFolderSummary(folders: HubLaunchFolder[]): string {
    if (folders.length === 0) {
        return 'No launch folders'
    }

    const branches = Array.from(new Set(
        folders
            .map((folder) => folder.branch?.trim())
            .filter((value): value is string => Boolean(value))
    ))

    if (branches.length === 0) {
        return `${folders.length} folder${folders.length === 1 ? '' : 's'}`
    }

    const preview = branches.slice(0, 3).join(', ')
    const suffix = branches.length > 3 ? ` +${branches.length - 3}` : ''
    return `${folders.length} folder${folders.length === 1 ? '' : 's'} · ${preview}${suffix}`
}

function renderFolderRows(folders: HubLaunchFolder[]): string {
    if (folders.length === 0) {
        return '<div class="hub-folders-empty">No configured launch folders.</div>'
    }

    return folders.map((folder) => {
        const badge = folder.branch
            ? `<span class="hub-folder-branch">${htmlEscape(folder.branch)}</span>`
            : ''
        return `<div class="hub-folder-row">
  <div class="hub-folder-label-row">
    <span class="hub-folder-label">${htmlEscape(folder.label)}</span>
    ${badge}
  </div>
  <div class="hub-folder-path">${htmlEscape(folder.path)}</div>
</div>`
    }).join('\n')
}

function renderHubCard(hub: RegisteredHub, options?: { link?: boolean }): string {
    const link = options?.link !== false
    const details = [
        `owner=${hub.owner}`,
        hub.jobId ? `job=${hub.jobId}` : null,
        hub.jobName ? `name=${hub.jobName}` : null,
        hub.hostname ? `host=${hub.hostname}` : null,
        hub.socket ? 'connected' : 'disconnected'
    ].filter(Boolean).join(' | ')

    const destination = htmlEscape(hub.publicUrl)
    const title = link
        ? `<a class="hub-url" href="${destination}">${destination}</a>`
        : `<code class="hub-url-code">${destination}</code>`

    const configWarning = hub.configError
        ? `<div class="hub-config-warning">${htmlEscape(hub.configError)}</div>`
        : ''

    return `<article class="hub-card">
  <div class="hub-card-header">
    <div>
      <div class="hub-id">${htmlEscape(hub.hubId)}</div>
      <div class="hub-details">${htmlEscape(details)}</div>
    </div>
    <div class="hub-last-seen">last seen ${new Date(hub.lastSeenAt).toLocaleString()}</div>
  </div>
  <div class="hub-link-row">${title}</div>
  ${configWarning}
  <details class="hub-folders">
    <summary>${htmlEscape(renderFolderSummary(hub.launchFolders))}</summary>
    <div class="hub-folders-list">
      ${renderFolderRows(hub.launchFolders)}
    </div>
  </details>
</article>`
}

function renderHubListItems(hubs: RegisteredHub[], emptyText: string, options?: { link?: boolean }): string {
    return hubs.length > 0
        ? hubs.map((hub) => renderHubCard(hub, options)).join('\n')
        : `<div class="hub-empty">${htmlEscape(emptyText)}</div>`
}

function renderBrokerIndex(config: BrokerConfig, activeHubs: RegisteredHub[], recentHubs: RegisteredHub[]): string {
    const activeHubItems = renderHubListItems(activeHubs, 'No active hubs registered.')
    const recentHubItems = renderHubListItems(recentHubs, 'No recent hubs recorded.', { link: false })
    const brokerHost = (() => {
        try {
            return new URL(config.publicUrl).hostname
        } catch {
            return config.publicUrl
        }
    })()

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>maglev server · ${htmlEscape(brokerHost)}</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0a1220;
      --panel: rgba(10, 18, 32, 0.86);
      --card: #111d33;
      --card-2: #16233c;
      --border: rgba(140, 168, 209, 0.18);
      --text: #ecf3ff;
      --muted: #97aac7;
      --accent: #7dd3fc;
      --accent-2: #8b5cf6;
      --warn-bg: rgba(245, 158, 11, 0.12);
      --warn-border: rgba(245, 158, 11, 0.28);
      --warn-text: #f6c86e;
    }
    body {
      font-family: ui-sans-serif, system-ui, sans-serif;
      margin: 0;
      min-height: 100vh;
      padding: 2rem;
      background:
        radial-gradient(circle at top left, rgba(125, 211, 252, 0.12), transparent 32%),
        radial-gradient(circle at top right, rgba(139, 92, 246, 0.14), transparent 24%),
        linear-gradient(180deg, #08101d 0%, #0b1424 100%);
      color: var(--text);
    }
    main {
      max-width: 1080px;
      margin: 0 auto;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 24px;
      padding: 2rem;
      box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35);
      backdrop-filter: blur(14px);
    }
    h1 {
      margin-top: 0;
      margin-bottom: 0.4rem;
      font-size: 2rem;
      letter-spacing: -0.03em;
    }
    p {
      color: var(--muted);
    }
    code {
      background: rgba(125, 211, 252, 0.08);
      border-radius: 8px;
      padding: 0.15rem 0.35rem;
    }
    .hero {
      padding: 0.4rem 0 1.25rem;
      border-bottom: 1px solid var(--border);
      margin-bottom: 1.5rem;
    }
    .hero-grid {
      display: grid;
      gap: 0.75rem;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      margin-top: 1.25rem;
    }
    .hero-stat {
      border: 1px solid var(--border);
      background: linear-gradient(180deg, rgba(22, 35, 60, 0.92), rgba(17, 29, 51, 0.88));
      border-radius: 18px;
      padding: 1rem;
    }
    .hero-stat-label {
      color: var(--muted);
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-bottom: 0.35rem;
    }
    .hero-stat-value {
      font-weight: 700;
      line-height: 1.4;
      word-break: break-word;
    }
    .sections {
      display: grid;
      gap: 1.5rem;
    }
    .section-title {
      margin: 0 0 0.85rem;
      font-size: 1rem;
      letter-spacing: 0.02em;
      color: var(--text);
    }
    .hub-grid {
      display: grid;
      gap: 1rem;
    }
    .hub-card {
      border: 1px solid var(--border);
      border-radius: 18px;
      background: linear-gradient(180deg, rgba(17, 29, 51, 0.98), rgba(12, 21, 37, 0.98));
      padding: 1rem;
    }
    .hub-card-header {
      display: flex;
      justify-content: space-between;
      gap: 1rem;
      align-items: flex-start;
    }
    .hub-id {
      font-size: 1.05rem;
      font-weight: 700;
      margin-bottom: 0.3rem;
      word-break: break-word;
    }
    .hub-details, .hub-last-seen {
      color: var(--muted);
      font-size: 0.85rem;
    }
    .hub-link-row {
      margin-top: 0.8rem;
      margin-bottom: 0.8rem;
    }
    .hub-url, .hub-url-code {
      color: var(--accent);
      text-decoration: none;
      word-break: break-word;
    }
    .hub-url:hover {
      text-decoration: underline;
    }
    .hub-config-warning {
      margin-bottom: 0.8rem;
      border: 1px solid var(--warn-border);
      background: var(--warn-bg);
      color: var(--warn-text);
      border-radius: 12px;
      padding: 0.75rem 0.85rem;
      font-size: 0.85rem;
    }
    .hub-folders {
      border-top: 1px solid var(--border);
      padding-top: 0.8rem;
    }
    .hub-folders summary {
      cursor: pointer;
      color: var(--muted);
      font-size: 0.9rem;
      user-select: none;
    }
    .hub-folders-list {
      display: grid;
      gap: 0.6rem;
      margin-top: 0.8rem;
    }
    .hub-folder-row {
      border: 1px solid var(--border);
      background: rgba(255, 255, 255, 0.02);
      border-radius: 14px;
      padding: 0.75rem 0.85rem;
    }
    .hub-folder-label-row {
      display: flex;
      align-items: center;
      gap: 0.55rem;
      flex-wrap: wrap;
      margin-bottom: 0.35rem;
    }
    .hub-folder-label {
      font-weight: 600;
    }
    .hub-folder-branch {
      display: inline-flex;
      align-items: center;
      border: 1px solid rgba(125, 211, 252, 0.26);
      background: rgba(125, 211, 252, 0.08);
      color: var(--accent);
      border-radius: 999px;
      padding: 0.15rem 0.5rem;
      font-size: 0.78rem;
      font-weight: 600;
    }
    .hub-folder-path {
      color: var(--muted);
      font-size: 0.84rem;
      word-break: break-word;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .hub-folders-empty, .hub-empty {
      color: var(--muted);
      font-size: 0.9rem;
      padding: 0.4rem 0;
    }
    @media (max-width: 720px) {
      body {
        padding: 1rem;
      }
      main {
        padding: 1.2rem;
        border-radius: 18px;
      }
      .hub-card-header {
        flex-direction: column;
      }
    }
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <h1>maglev server · ${htmlEscape(brokerHost)}</h1>
      <p>Self-hosted control plane for remote hubs. Active cards show the launch folders and branch layout each hub was started with.</p>
      <div class="hero-grid">
        <div class="hero-stat">
          <div class="hero-stat-label">Public URL</div>
          <div class="hero-stat-value"><code>${htmlEscape(config.publicUrl)}</code></div>
        </div>
        <div class="hero-stat">
          <div class="hero-stat-label">Health</div>
          <div class="hero-stat-value"><code>/health</code></div>
        </div>
        <div class="hero-stat">
          <div class="hero-stat-label">Hub API</div>
          <div class="hero-stat-value"><code>/api/hubs</code></div>
        </div>
      </div>
    </section>
    <section class="sections">
      <div>
        <h2 class="section-title">Active hubs</h2>
        <div class="hub-grid">${activeHubItems}</div>
      </div>
      <div>
        <h2 class="section-title">Recent hubs</h2>
        <div class="hub-grid">${recentHubItems}</div>
      </div>
    </section>
  </main>
</body>
</html>`
}

function renderBrokerLogin(config: BrokerConfig, errorMessage?: string): string {
    const escapedError = errorMessage ? `<p style="color:#b91c1c;">${htmlEscape(errorMessage)}</p>` : ''
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>maglev server login</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; background: #f4f7fb; color: #102038; margin: 0; }
    main { max-width: 34rem; margin: 8vh auto; background: white; border-radius: 16px; box-shadow: 0 20px 70px rgba(16,32,56,.12); padding: 2rem; }
    button { border: 0; border-radius: 999px; padding: .8rem 1.2rem; background: #102038; color: white; cursor: pointer; font-weight: 600; }
    code { background: #eef3fb; border-radius: 6px; padding: 0.15rem 0.35rem; }
    #status { color: #42526b; white-space: pre-wrap; }
  </style>
</head>
<body>
  <main>
    <h1>Sign in to broker</h1>
    <p>Broker URL: <code>${htmlEscape(config.publicUrl)}</code></p>
    ${escapedError}
    <button id="login">Continue with GitHub</button>
    <p id="status"></p>
  </main>
  <script>
    const statusEl = document.getElementById('status');
    const button = document.getElementById('login');
    async function login() {
      button.disabled = true;
      statusEl.textContent = 'Starting GitHub device flow...';
      try {
        const startedRes = await fetch('/api/github/device/start', { method: 'POST' });
        const started = await startedRes.json();
        if (!startedRes.ok) throw new Error(started.error || 'Failed to start device auth');
        const url = started.verificationUriComplete || started.verificationUri;
        statusEl.textContent = 'Code: ' + started.userCode + '\\nOpen: ' + url;
        window.open(url, '_blank', 'noopener,noreferrer');
        let intervalMs = Math.max(started.interval || 5, 1) * 1000;
        const deadline = Date.now() + (started.expiresIn || 900) * 1000;
        while (Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, intervalMs));
          const pollRes = await fetch('/api/github/device/poll', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ deviceCode: started.deviceCode })
          });
          const polled = await pollRes.json();
          if (!pollRes.ok) throw new Error(polled.error || 'GitHub sign-in failed');
          if (polled.status === 'authorization_pending') continue;
          if (polled.status === 'slow_down') { intervalMs += 5000; continue; }
          if (polled.status === 'authorized') { window.location.reload(); return; }
          throw new Error('GitHub sign-in failed: ' + polled.status);
        }
        throw new Error('GitHub sign-in timed out');
      } catch (error) {
        statusEl.textContent = error instanceof Error ? error.message : String(error);
        button.disabled = false;
      }
    }
    button.addEventListener('click', () => { void login(); });
  </script>
</body>
</html>`
}

function rejectPendingRequestsForClient(clientId: string, reason: string): void {
    for (const [requestId, pending] of Array.from(pendingRequests.entries())) {
        if (pending.targetClientId !== clientId) {
            continue
        }
        pending.reject(new Error(`${reason} (${requestId})`))
    }
}

function createTimeoutPromise(requestId: string, targetClientId?: string): Promise<ProxyResponseMessage | ProxyStreamStartMessage> {
    return new Promise<ProxyResponseMessage | ProxyStreamStartMessage>((resolve, reject) => {
        const timeout = setTimeout(() => {
            pendingRequests.delete(requestId)
            reject(new Error(`Timed out waiting for hub response (${requestId})`))
        }, REQUEST_TIMEOUT_MS)

        pendingRequests.set(requestId, {
            targetClientId,
            resolve: (response) => {
                clearTimeout(timeout)
                pendingRequests.delete(requestId)
                resolve(response)
            },
            reject: (error) => {
                clearTimeout(timeout)
                pendingRequests.delete(requestId)
                reject(error)
            }
        })
    })
}

async function proxyHttpRequest(config: BrokerConfig, hub: RegisteredHub, req: Request, tailPath: string, session: BrokerUserSession): Promise<Response> {
    if (!hub.socket) {
        return new Response('Hub is not connected to the broker', { status: 503 })
    }

    const url = new URL(req.url)
    const requestId = randomUUID()
    const headers: Record<string, string> = {}
    for (const [key, value] of req.headers.entries()) {
        headers[key] = value
    }
    headers[BROKER_SESSION_HEADER] = session.token

    const bodyBytes = req.method === 'GET' || req.method === 'HEAD'
        ? new Uint8Array()
        : new Uint8Array(await req.arrayBuffer())

    const brokerPath = `/${tailPath}`
    const message: ProxyRequestMessage = {
        type: 'proxy-request',
        requestId,
        method: req.method,
        path: brokerPath,
        query: url.search,
        headers,
        bodyBase64: bodyBytes.length > 0 ? encodeBase64(bodyBytes) : undefined
    }

    // Register the pending request before sending so a fast hub response cannot race past us.
    const responsePromise = createTimeoutPromise(requestId, hub.socket.data.clientId)
    try {
        hub.socket.send(JSON.stringify(message))
    } catch (error) {
        const pending = pendingRequests.get(requestId)
        if (pending) {
            pending.reject(error instanceof Error ? error : new Error(String(error)))
        }
        throw error
    }
    const response = await responsePromise
    const responseHeaders = new Headers(response.headers)

    if (response.type === 'proxy-stream-start') {
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                pendingStreams.set(requestId, controller)
            },
            cancel() {
                pendingStreams.delete(requestId)
            }
        })

        return new Response(stream, {
            status: response.status,
            headers: responseHeaders
        })
    }

    let body = response.bodyBase64 ? decodeBase64(response.bodyBase64) : undefined
    const contentType = response.headers['content-type'] ?? response.headers['Content-Type'] ?? ''
    if (body && contentType.includes('text/html')) {
        body = new TextEncoder().encode(rewriteHtmlForHubPrefix(Buffer.from(body).toString('utf8'), hub.hubId))
    }
    return new Response(body, {
        status: response.status,
        headers: responseHeaders
    })
}

export async function startBroker(): Promise<void> {
    const config = await getBrokerConfig()
    const authConfig = await getBrokerAuthConfig()
    const brokerUrlPath = await writeBrokerUrl(config.publicUrl)

    console.log('Maglev Broker starting...')
    console.log(`[Broker] Listen host: ${config.host}`)
    console.log(`[Broker] Listen port: ${config.port}`)
    console.log(`[Broker] Public URL: ${config.publicUrl}`)
    console.log(`[Broker] URL file: ${brokerUrlPath}`)
    if (config.tokenPath) {
        console.log(`[Broker] Registration key: ${config.tokenCreated ? 'created' : 'loaded'} from ${config.tokenPath}`)
    } else {
        console.log('[Broker] Registration key: loaded from MAGLEV_BROKER_TOKEN')
    }
    console.log('[Broker] Mode: self-hosted control plane')

    const pruneInterval = setInterval(pruneExpiredHubs, 5_000)

    const server = Bun.serve<HubSocketData>({
        hostname: config.host,
        port: config.port,
        idleTimeout: 255, // seconds; max value — keeps SSE streams alive
        async fetch(req, serverRef) {
            const url = new URL(req.url)
            const brokerSession = await getBrokerSession(req)

            if (url.pathname === '/api/hubs/connect') {
                if (config.token) {
                    const providedToken = url.searchParams.get('token')?.trim() || null
                    if (providedToken !== config.token) {
                        return new Response('Broker token mismatch', { status: 401 })
                    }
                }
                const clientId = randomUUID()
                const upgraded = serverRef.upgrade(req, {
                    data: {
                        role: 'hub',
                        clientId,
                        hubId: null
                        ,
                        wsId: null
                    }
                })
                if (upgraded) {
                    return undefined
                }
                return new Response('WebSocket upgrade failed', { status: 500 })
            }

            if (url.pathname === '/health') {
                const activeHubs = listActiveHubs()
                return Response.json({
                    status: 'ok',
                    service: 'maglev-broker',
                    requestId: randomUUID(),
                    activeHubs: activeHubs.length,
                    recentHubs: listRecentHubs().length
                })
            }

            if (url.pathname === '/api/github/device/start' && req.method === 'POST') {
                if (!authConfig.gitHubDeviceAuth) {
                    return Response.json({ error: 'GitHub device auth is not configured for the broker' }, { status: 503 })
                }
                try {
                    return Response.json(await authConfig.gitHubDeviceAuth.start())
                } catch (error) {
                    return Response.json({ error: error instanceof Error ? error.message : 'Failed to start GitHub device flow' }, { status: 502 })
                }
            }

            if (url.pathname === '/api/github/device/poll' && req.method === 'POST') {
                if (!authConfig.gitHubDeviceAuth) {
                    return Response.json({ error: 'GitHub device auth is not configured for the broker' }, { status: 503 })
                }
                const body = await req.json().catch(() => null) as { deviceCode?: unknown } | null
                const deviceCode = typeof body?.deviceCode === 'string' ? body.deviceCode.trim() : ''
                if (!deviceCode) {
                    return Response.json({ error: 'Invalid body' }, { status: 400 })
                }
                try {
                    const result = await authConfig.gitHubDeviceAuth.poll(deviceCode)
                    if (result.status !== 'authorized') {
                        return Response.json(result)
                    }
                    const token = await signBrokerSessionToken({
                        uid: result.identity.id,
                        login: result.identity.login
                    })
                    return new Response(JSON.stringify({
                        status: 'authorized',
                        githubUser: result.identity
                    }), {
                        status: 200,
                        headers: {
                            'content-type': 'application/json',
                            'set-cookie': buildBrokerSessionCookie(token)
                        }
                    })
                } catch (error) {
                    return Response.json({ error: error instanceof Error ? error.message : 'Failed to complete GitHub device flow' }, { status: 502 })
                }
            }

            if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
                return new Response(JSON.stringify({ ok: true }), {
                    headers: {
                        'content-type': 'application/json',
                        'set-cookie': buildClearedBrokerSessionCookie()
                    }
                })
            }

            if (url.pathname === '/api/hubs' && req.method === 'GET') {
                if (!brokerSession) {
                    return Response.json({ error: 'Broker session required' }, { status: 401 })
                }
                const activeHubs = listActiveHubs()
                return Response.json({
                    hubs: activeHubs.map((hub) => ({
                        ...hub,
                        socket: hub.socket ? 'connected' : null
                    })),
                    recentHubs: listRecentHubs().map((hub) => ({
                        ...hub,
                        socket: hub.socket ? 'connected' : null
                    }))
                })
            }

            if (url.pathname.startsWith('/api/hubs/') && req.method === 'GET') {
                if (!brokerSession) {
                    return Response.json({ error: 'Broker session required' }, { status: 401 })
                }
                const hubId = decodeURIComponent(url.pathname.slice('/api/hubs/'.length))
                const hub = registry.get(hubId)
                if (hub && hub.lastSeenAt >= Date.now() - HUB_TTL_MS) {
                    return Response.json({
                        ...hub,
                        socket: hub.socket ? 'connected' : null
                    })
                }

                if (hub) {
                    rememberHub(hub)
                    registry.delete(hubId)
                }

                const recentHub = recentRegistry.get(hubId)
                if (recentHub) {
                    return Response.json({
                        ...recentHub,
                        socket: null
                    })
                }

                return Response.json({ error: 'Hub not found' }, { status: 404 })
            }

            if (url.pathname.startsWith('/h/')) {
                if (!brokerSession) {
                    return new Response('Broker session required', { status: 401 })
                }
                const tail = url.pathname.slice('/h/'.length)
                const slashIndex = tail.indexOf('/')
                const rawHubId = slashIndex === -1 ? tail : tail.slice(0, slashIndex)
                const tailPath = slashIndex === -1 ? '' : tail.slice(slashIndex + 1)
                const hubId = decodeURIComponent(rawHubId)
                const hub = registry.get(hubId)
                if (!hub || hub.lastSeenAt < Date.now() - HUB_TTL_MS) {
                    registry.delete(hubId)
                    return new Response('Hub not found', { status: 404 })
                }

                if (req.headers.get('upgrade')) {
                    if (!hub.socket) {
                        return new Response('Hub is not connected to the broker', { status: 503 })
                    }
                    const wsId = randomUUID()
                    const upgraded = serverRef.upgrade(req, {
                        data: {
                            role: 'browser',
                            clientId: randomUUID(),
                            hubId,
                            wsId
                        }
                    })
                    if (!upgraded) {
                        return new Response('WebSocket upgrade failed', { status: 500 })
                    }
                    const headers: Record<string, string> = {}
                    for (const [key, value] of req.headers.entries()) {
                        headers[key] = value
                    }
                    hub.socket.send(JSON.stringify({
                        type: 'proxy-ws-open',
                        wsId,
                        path: `/${tailPath}`,
                        query: url.search,
                        headers
                    } satisfies ProxyWsOpenMessage))
                    return undefined
                }

                return proxyHttpRequest(config, hub, req, tailPath, brokerSession).catch((error) => {
                    return new Response(
                        error instanceof Error ? error.message : 'Broker proxy error',
                        { status: 502 }
                    )
                })
            }

            if (url.pathname === '/' || url.pathname === '/index.html') {
                if (!brokerSession) {
                    return new Response(renderBrokerLogin(config, authConfig.gitHubDeviceAuth ? undefined : 'Broker GitHub auth is not configured.'), {
                        headers: {
                            'content-type': 'text/html; charset=utf-8'
                        }
                    })
                }
                return new Response(renderBrokerIndex(config, listActiveHubs(), listRecentHubs()), {
                    headers: {
                        'content-type': 'text/html; charset=utf-8'
                    }
                })
            }

            return new Response('Not found', { status: 404 })
        },
        websocket: {
            open(ws) {
                if (ws.data.role === 'hub') {
                    ws.send(JSON.stringify({ type: 'ping' } satisfies PingMessage))
                    return
                }

                if (ws.data.role === 'browser' && ws.data.wsId) {
                    browserWsMap.set(ws.data.wsId, ws)
                }
            },
            message(ws, rawMessage) {
                if (ws.data.role === 'browser') {
                    if (!ws.data.hubId || !ws.data.wsId) {
                        return
                    }
                    const hub = registry.get(ws.data.hubId)
                    if (!hub?.socket) {
                        ws.close(1011, 'Hub disconnected')
                        return
                    }

                    const payload = typeof rawMessage === 'string'
                        ? Buffer.from(rawMessage, 'utf8')
                        : Buffer.from(rawMessage)
                    hub.socket.send(JSON.stringify({
                        type: 'proxy-ws-data',
                        wsId: ws.data.wsId,
                        dataBase64: payload.toString('base64'),
                        isText: typeof rawMessage === 'string'
                    } satisfies ProxyWsDataMessage))
                    return
                }

                const text = typeof rawMessage === 'string'
                    ? rawMessage
                    : Buffer.from(rawMessage).toString('utf8')

                let parsed: unknown
                try {
                    parsed = JSON.parse(text)
                } catch {
                    ws.close(1003, 'Invalid JSON')
                    return
                }

                if ((parsed as { type?: string }).type === 'register') {
                    try {
                        const payload = validateRegisterHubMessage(parsed)
                        const now = Date.now()
                        const existing = registry.get(payload.hubId)
                        const hub: RegisteredHub = {
                            hubId: payload.hubId,
                            owner: payload.owner,
                            jobId: payload.jobId ?? null,
                            jobName: payload.jobName ?? null,
                            hostname: payload.hostname ?? null,
                            localUrl: payload.localUrl,
                            createdAt: existing?.createdAt ?? now,
                            lastSeenAt: now,
                            publicUrl: `${config.publicUrl.replace(/\/$/, '')}/h/${encodeURIComponent(payload.hubId)}`,
                            socket: ws,
                            launchFolders: payload.launchFolders ?? [],
                            configError: payload.configError ?? null
                        }
                        if (existing?.socket && existing.socket !== ws) {
                            rejectPendingRequestsForClient(
                                existing.socket.data.clientId,
                                `Hub ${payload.hubId} reconnected before completing the request`
                            )
                        }
                        registry.set(hub.hubId, hub)
                        rememberHub(hub)
                        socketHubMap.set(ws.data.clientId, hub.hubId)
                        ws.data.hubId = hub.hubId
                        return
                    } catch {
                        ws.close(1008, 'Invalid register payload')
                        return
                    }
                }

                if ((parsed as { type?: string }).type === 'ping') {
                    const hubId = socketHubMap.get(ws.data.clientId)
                    if (hubId) {
                        const hub = registry.get(hubId)
                        if (hub && hub.socket === ws) {
                            hub.lastSeenAt = Date.now()
                        }
                    }
                    return
                }

                if (isProxyResponseMessage(parsed)) {
                    const pending = pendingRequests.get(parsed.requestId)
                    if (pending) {
                        pending.resolve(parsed)
                    }
                    return
                }

                if (isProxyStreamStartMessage(parsed)) {
                    const pending = pendingRequests.get(parsed.requestId)
                    if (pending) {
                        pending.resolve(parsed)
                    }
                    return
                }

                if (isProxyStreamChunkMessage(parsed)) {
                    const controller = pendingStreams.get(parsed.requestId)
                    if (controller) {
                        controller.enqueue(decodeBase64(parsed.chunkBase64))
                    }
                    return
                }

                if (isProxyStreamEndMessage(parsed)) {
                    const controller = pendingStreams.get(parsed.requestId)
                    if (controller) {
                        controller.close()
                        pendingStreams.delete(parsed.requestId)
                    }
                    return
                }

                if (isProxyWsDataMessage(parsed)) {
                    const browserWs = browserWsMap.get(parsed.wsId)
                    if (browserWs) {
                        const payload = Buffer.from(parsed.dataBase64, 'base64')
                        browserWs.send(parsed.isText ? payload.toString('utf8') : payload)
                    }
                    return
                }

                if (isProxyWsCloseMessage(parsed)) {
                    const browserWs = browserWsMap.get(parsed.wsId)
                    if (browserWs) {
                        browserWs.close()
                        browserWsMap.delete(parsed.wsId)
                    }
                }
            },
            close(ws) {
                if (ws.data.role === 'browser') {
                    if (ws.data.wsId) {
                        browserWsMap.delete(ws.data.wsId)
                    }
                    if (ws.data.hubId && ws.data.wsId) {
                        const hub = registry.get(ws.data.hubId)
                        if (hub?.socket) {
                            hub.socket.send(JSON.stringify({
                                type: 'proxy-ws-close',
                                wsId: ws.data.wsId
                            } satisfies ProxyWsCloseMessage))
                        }
                    }
                    return
                }

                const hubId = socketHubMap.get(ws.data.clientId)
                if (!hubId) {
                    return
                }
                socketHubMap.delete(ws.data.clientId)
                const hub = registry.get(hubId)
                if (hub && hub.socket === ws) {
                    rejectPendingRequestsForClient(ws.data.clientId, `Hub ${hubId} disconnected while waiting for response`)
                    hub.socket = null
                    hub.lastSeenAt = Date.now()
                    rememberHub(hub)
                }
            }
        }
    })

    console.log('')
    console.log('Maglev Broker is ready!')
    console.log(`[Broker] Local:  http://${config.host}:${config.port}`)
    console.log(`[Broker] Public: ${config.publicUrl}`)

    const shutdown = () => {
        console.log('\nShutting down broker...')
        clearInterval(pruneInterval)
        for (const pending of pendingRequests.values()) {
            pending.reject(new Error('Broker shutting down'))
        }
        pendingRequests.clear()
        for (const controller of pendingStreams.values()) {
            controller.error(new Error('Broker shutting down'))
        }
        pendingStreams.clear()
        server.stop()
        process.exit(0)
    }

    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)

    await new Promise(() => {})
}
