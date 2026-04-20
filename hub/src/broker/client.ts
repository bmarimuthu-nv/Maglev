import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import type { HubLaunchFolder } from '../hubConfig'

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

type BrokerMessage = PingMessage | ProxyRequestMessage | ProxyWsOpenMessage | ProxyWsDataMessage | ProxyWsCloseMessage

export type BrokerClientConfig = {
    brokerUrl: string
    brokerToken?: string | null
    owner: string
    localHost?: string | null
    localPort: number
    hubName?: string | null
    launchFolders?: HubLaunchFolder[]
    configError?: string | null
    onStatusChange?: (status: string) => void
}

function sanitizeHubName(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
}

function toBrokerWsUrl(brokerUrl: string, brokerToken?: string | null): string {
    const url = new URL(brokerUrl)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.pathname = '/api/hubs/connect'
    url.search = ''
    if (brokerToken) {
        url.searchParams.set('token', brokerToken)
    }
    return url.toString()
}

function toBase64(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString('base64')
}

function formatUrlHost(host: string): string {
    return host.includes(':') ? `[${host}]` : host
}

function resolveProxyLocalHost(host?: string | null): string {
    const trimmed = host?.trim()
    if (!trimmed || trimmed === '0.0.0.0') {
        return '127.0.0.1'
    }
    if (trimmed === '::') {
        return '::1'
    }
    return trimmed
}

export function buildBrokerLocalUrl(localPort: number, localHost?: string | null): string {
    return `http://${formatUrlHost(resolveProxyLocalHost(localHost))}:${localPort}`
}

export function createProxyErrorResponse(requestId: string, error: unknown): ProxyResponseMessage {
    const message = error instanceof Error ? error.message : String(error)
    return {
        type: 'proxy-response',
        requestId,
        status: 502,
        headers: {
            'content-type': 'text/plain; charset=utf-8'
        },
        bodyBase64: Buffer.from(`Failed to forward request to local hub: ${message}`, 'utf8').toString('base64')
    }
}

export class BrokerClient {
    private static readonly RECONNECT_DELAY_MS = 5_000

    private readonly config: BrokerClientConfig
    private readonly hubId: string
    private readonly localUrl: string
    private socket: WebSocket | null = null
    private heartbeatTimer: ReturnType<typeof setInterval> | null = null
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null
    private hubUrl: string | null = null
    private started = false
    private stopped = false
    private reconnecting = false
    private readonly wsUrl: string
    private readonly proxySockets = new Map<string, {
        socket: WebSocket
        pending: Array<{ payload: Buffer; isText: boolean }>
    }>()

    constructor(config: BrokerClientConfig) {
        this.config = config
        const slurmJobId = process.env.SLURM_JOB_ID?.trim()
        const configuredHubName = config.hubName ? sanitizeHubName(config.hubName) : ''
        this.hubId = configuredHubName || (slurmJobId ? `slurm-${slurmJobId}` : randomUUID())
        this.localUrl = buildBrokerLocalUrl(config.localPort, config.localHost)
        this.wsUrl = toBrokerWsUrl(config.brokerUrl, config.brokerToken)
    }

    async start(): Promise<string> {
        if (this.started) {
            if (!this.hubUrl) {
                throw new Error('Broker client started without a hub URL')
            }
            return this.hubUrl
        }

        this.stopped = false
        await this.connect()
        this.started = true
        this.hubUrl = `${this.config.brokerUrl.replace(/\/$/, '')}/h/${encodeURIComponent(this.hubId)}`
        this.startHeartbeat()
        return this.hubUrl
    }

    async stop(): Promise<void> {
        this.stopped = true
        this.reconnecting = false
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer)
            this.heartbeatTimer = null
        }

        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer)
            this.reconnectTimer = null
        }

        this.closeProxySockets()

        if (this.socket) {
            this.socket.close()
            this.socket = null
        }
    }

    getHubId(): string {
        return this.hubId
    }

    getHubUrl(): string | null {
        return this.hubUrl
    }

    private async connect(): Promise<void> {
        const socket = new WebSocket(this.wsUrl)

        await new Promise<void>((resolve, reject) => {
            let settled = false
            socket.onopen = () => {
                if (settled) {
                    return
                }
                settled = true
                this.socket = socket
                socket.send(JSON.stringify(this.buildRegisterMessage()))
                this.reconnecting = false
                this.emitStatus(`Connected to broker ${this.config.brokerUrl}`)
                resolve()
            }

            socket.onerror = () => {
                if (settled) {
                    return
                }
                settled = true
                reject(new Error(`Failed to connect to broker WebSocket ${this.wsUrl}`))
            }

            socket.onclose = () => {
                if (settled) {
                    return
                }
                settled = true
                reject(new Error(`Broker WebSocket closed during connect ${this.wsUrl}`))
            }
        })

        socket.onmessage = (event) => {
            void this.handleMessage(event.data)
        }

        socket.onerror = () => {
            // Let onclose handle reconnect behavior.
        }

        socket.onclose = () => {
            const wasActiveSocket = this.socket === socket
            if (wasActiveSocket) {
                this.socket = null
                this.closeProxySockets()
                this.emitStatus(`Disconnected from broker ${this.config.brokerUrl}`)
                this.scheduleReconnect()
            }
        }
    }

    private startHeartbeat(): void {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer)
        }
        this.heartbeatTimer = setInterval(() => {
            if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
                return
            }
            this.socket.send(JSON.stringify({ type: 'ping' } satisfies PingMessage))
        }, 10_000)
    }

    private buildRegisterMessage(): RegisterHubMessage {
        return {
            type: 'register',
            hubId: this.hubId,
            owner: this.config.owner,
            jobId: process.env.SLURM_JOB_ID?.trim() || null,
            jobName: this.config.hubName?.trim() || process.env.SLURM_JOB_NAME?.trim() || null,
            hostname: hostname(),
            localUrl: this.localUrl,
            launchFolders: this.config.launchFolders ?? [],
            configError: this.config.configError ?? null
        }
    }

    private emitStatus(status: string): void {
        this.config.onStatusChange?.(status)
    }

    private closeProxySockets(): void {
        for (const { socket } of this.proxySockets.values()) {
            socket.close()
        }
        this.proxySockets.clear()
    }

    private scheduleReconnect(): void {
        if (this.stopped || this.reconnecting || this.reconnectTimer) {
            return
        }

        this.reconnecting = true
        this.emitStatus(`Broker connection lost; retrying in ${BrokerClient.RECONNECT_DELAY_MS / 1000}s`)
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null
            void this.reconnect()
        }, BrokerClient.RECONNECT_DELAY_MS)
    }

    private async reconnect(): Promise<void> {
        if (this.stopped) {
            this.reconnecting = false
            return
        }

        try {
            this.emitStatus(`Reconnecting to broker ${this.config.brokerUrl}`)
            await this.connect()
            this.emitStatus(`Re-registered hub ${this.hubId} with broker`)
        } catch (error) {
            this.emitStatus(
                `Broker reconnect failed: ${error instanceof Error ? error.message : String(error)}`
            )
            this.reconnecting = false
            this.scheduleReconnect()
        }
    }

    private async handleMessage(raw: string | ArrayBuffer | Blob): Promise<void> {
        const text = typeof raw === 'string'
            ? raw
            : raw instanceof ArrayBuffer
                ? Buffer.from(raw).toString('utf8')
                : Buffer.from(await raw.arrayBuffer()).toString('utf8')

        let message: BrokerMessage
        try {
            message = JSON.parse(text) as BrokerMessage
        } catch {
            console.error('[Broker] Received malformed JSON message, ignoring')
            return
        }

        if (message.type === 'ping') {
            if (this.socket?.readyState === WebSocket.OPEN) {
                this.socket.send(JSON.stringify(this.buildRegisterMessage()))
            }
            return
        }

        if (message.type === 'proxy-request') {
            let response: ProxyResponseMessage
            try {
                response = await this.forwardProxyRequest(message)
            } catch (error) {
                console.error(`[Broker] Failed to proxy ${message.method} ${message.path}:`, error)
                response = createProxyErrorResponse(message.requestId, error)
            }
            if (this.socket?.readyState === WebSocket.OPEN) {
                this.socket.send(JSON.stringify(response))
            }
            return
        }

        if (message.type === 'proxy-ws-open') {
            this.openProxySocket(message)
            return
        }

        if (message.type === 'proxy-ws-data') {
            const entry = this.proxySockets.get(message.wsId)
            if (!entry) {
                return
            }
            const payload = Buffer.from(message.dataBase64, 'base64')
            const isText = message.isText === true
            if (entry.socket.readyState === WebSocket.OPEN) {
                entry.socket.send(isText ? payload.toString('utf8') : payload)
            } else {
                entry.pending.push({ payload, isText })
            }
            return
        }

        if (message.type === 'proxy-ws-close') {
            const entry = this.proxySockets.get(message.wsId)
            if (entry) {
                entry.socket.close()
                this.proxySockets.delete(message.wsId)
            }
        }
    }

    private openProxySocket(message: ProxyWsOpenMessage): void {
        const targetUrl = new URL(`${this.localUrl}${message.path}`)
        if (message.query) {
            targetUrl.search = message.query
        }
        targetUrl.protocol = targetUrl.protocol === 'https:' ? 'wss:' : 'ws:'

        const socket = new WebSocket(targetUrl.toString())
        const entry = {
            socket,
            pending: [] as Array<{ payload: Buffer; isText: boolean }>
        }
        this.proxySockets.set(message.wsId, entry)

        socket.binaryType = 'arraybuffer'

        socket.onopen = () => {
            for (const item of entry.pending) {
                socket.send(item.isText ? item.payload.toString('utf8') : item.payload)
            }
            entry.pending.length = 0
        }

        socket.onmessage = (event) => {
            const isText = typeof event.data === 'string'
            const payload = isText
                ? Buffer.from(event.data, 'utf8')
                : event.data instanceof ArrayBuffer
                    ? Buffer.from(event.data)
                    : Buffer.from([])

            if (this.socket?.readyState === WebSocket.OPEN) {
                this.socket.send(JSON.stringify({
                    type: 'proxy-ws-data',
                    wsId: message.wsId,
                    dataBase64: payload.toString('base64'),
                    isText
                } satisfies ProxyWsDataMessage))
            }
        }

        socket.onclose = () => {
            this.proxySockets.delete(message.wsId)
            if (this.socket?.readyState === WebSocket.OPEN) {
                this.socket.send(JSON.stringify({
                    type: 'proxy-ws-close',
                    wsId: message.wsId
                } satisfies ProxyWsCloseMessage))
            }
        }

        socket.onerror = () => {
            socket.close()
        }
    }

    private async forwardProxyRequest(message: ProxyRequestMessage): Promise<ProxyResponseMessage> {
        const url = new URL(`${this.localUrl}${message.path}`)
        if (message.query) {
            url.search = message.query
        }

        const requestHeaders = new Headers()
        for (const [key, value] of Object.entries(message.headers)) {
            if (key.toLowerCase() === 'host' || key.toLowerCase() === 'content-length') {
                continue
            }
            requestHeaders.set(key, value)
        }

        const body = message.bodyBase64
            ? Buffer.from(message.bodyBase64, 'base64')
            : undefined

        const response = await fetch(url, {
            method: message.method,
            headers: requestHeaders,
            body: body && body.length > 0 ? body : undefined
        })

        const responseHeaders: Record<string, string> = {}
        for (const [key, value] of response.headers.entries()) {
            responseHeaders[key] = value
        }

        const contentType = response.headers.get('content-type') ?? ''
        const shouldStream = contentType.includes('text/event-stream') && response.body

        if (shouldStream && this.socket?.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({
                type: 'proxy-stream-start',
                requestId: message.requestId,
                status: response.status,
                headers: responseHeaders
            } satisfies ProxyStreamStartMessage))

            const reader = response.body!.getReader()
            try {
                while (true) {
                    const { done, value } = await reader.read()
                    if (done) {
                        break
                    }
                    if (value && value.length > 0 && this.socket?.readyState === WebSocket.OPEN) {
                        this.socket.send(JSON.stringify({
                            type: 'proxy-stream-chunk',
                            requestId: message.requestId,
                            chunkBase64: toBase64(value)
                        } satisfies ProxyStreamChunkMessage))
                    }
                }
            } finally {
                if (this.socket?.readyState === WebSocket.OPEN) {
                    this.socket.send(JSON.stringify({
                        type: 'proxy-stream-end',
                        requestId: message.requestId
                    } satisfies ProxyStreamEndMessage))
                }
            }

            return {
                type: 'proxy-response',
                requestId: message.requestId,
                status: response.status,
                headers: responseHeaders
            }
        }

        const buffer = new Uint8Array(await response.arrayBuffer())

        return {
            type: 'proxy-response',
            requestId: message.requestId,
            status: response.status,
            headers: responseHeaders,
            bodyBase64: buffer.length > 0 ? toBase64(buffer) : undefined
        }
    }
}
