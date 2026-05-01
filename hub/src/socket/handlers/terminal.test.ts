import { describe, expect, it } from 'bun:test'
import { registerTerminalHandlers } from './terminal'
import { TerminalRegistry } from '../terminalRegistry'
import type { SocketServer, SocketWithData } from '../socketTypes'

type EmittedEvent = {
    event: string
    data: unknown
}

class FakeSocket {
    readonly id: string
    readonly data: Record<string, unknown> = {}
    readonly emitted: EmittedEvent[] = []
    private readonly handlers = new Map<string, (...args: unknown[]) => void>()

    constructor(id: string) {
        this.id = id
    }

    on(event: string, handler: (...args: unknown[]) => void): this {
        this.handlers.set(event, handler)
        return this
    }

    emit(event: string, data: unknown): boolean {
        this.emitted.push({ event, data })
        return true
    }

    trigger(event: string, data?: unknown): void {
        const handler = this.handlers.get(event)
        if (!handler) {
            return
        }
        if (typeof data === 'undefined') {
            handler()
            return
        }
        handler(data)
    }
}

class FakeNamespace {
    readonly sockets = new Map<string, FakeSocket>()
    readonly adapter = { rooms: new Map<string, Set<string>>() }
}

class FakeServer {
    private readonly namespaces = new Map<string, FakeNamespace>()

    of(name: string): FakeNamespace {
        const existing = this.namespaces.get(name)
        if (existing) {
            return existing
        }
        const namespace = new FakeNamespace()
        this.namespaces.set(name, namespace)
        return namespace
    }
}

type Harness = {
    io: FakeServer
    terminalSocket: FakeSocket
    cliNamespace: FakeNamespace
    terminalRegistry: TerminalRegistry
}

function createHarness(options?: {
    sessionActive?: boolean
    maxTerminalsPerSocket?: number
    maxTerminalsPerSession?: number
    onSessionTerminalInput?: (payload: { sessionId: string; terminalId: string; actor: 'human' }) => void
}): Harness {
    const io = new FakeServer()
    const terminalNamespace = io.of('/terminal')
    const terminalSocket = new FakeSocket('terminal-socket')
    terminalSocket.data.namespace = 'default'
    terminalNamespace.sockets.set(terminalSocket.id, terminalSocket)
    const terminalRegistry = new TerminalRegistry({ idleTimeoutMs: 0 })
    const cliNamespace = io.of('/cli')

    registerTerminalHandlers(terminalSocket as unknown as SocketWithData, {
        io: io as unknown as SocketServer,
        getSession: () => ({ active: options?.sessionActive ?? true, namespace: 'default' }),
        terminalRegistry,
        maxTerminalsPerSocket: options?.maxTerminalsPerSocket ?? 4,
        maxTerminalsPerSession: options?.maxTerminalsPerSession ?? 4,
        onSessionTerminalInput: options?.onSessionTerminalInput
    })

    return { io, terminalSocket, cliNamespace, terminalRegistry }
}

function connectCliSocket(cliNamespace: FakeNamespace, cliSocket: FakeSocket, sessionId: string): void {
    cliSocket.data.namespace = 'default'
    cliNamespace.sockets.set(cliSocket.id, cliSocket)
    const roomId = `session:${sessionId}`
    const room = cliNamespace.adapter.rooms.get(roomId) ?? new Set<string>()
    room.add(cliSocket.id)
    cliNamespace.adapter.rooms.set(roomId, room)
}

function lastEmit(socket: FakeSocket, event: string): EmittedEvent | undefined {
    return [...socket.emitted].reverse().find((entry) => entry.event === event)
}

describe('terminal socket handlers', () => {
    it('rejects terminal creation when session is inactive', () => {
        const { terminalSocket, terminalRegistry } = createHarness({ sessionActive: false })

        terminalSocket.trigger('terminal:create', {
            sessionId: 'session-1',
            terminalId: 'terminal-1',
            cols: 80,
            rows: 24
        })

        const errorEvent = lastEmit(terminalSocket, 'terminal:error')
        expect(errorEvent).toBeDefined()
        expect(errorEvent?.data).toEqual({
            terminalId: 'terminal-1',
            message: 'Session is inactive or unavailable.'
        })
        expect(terminalRegistry.get('terminal-1')).toBeNull()
    })

    it('opens a terminal and forwards write/resize/close to the CLI socket', () => {
        const { terminalSocket, cliNamespace, terminalRegistry } = createHarness()
        const cliSocket = new FakeSocket('cli-socket-1')
        connectCliSocket(cliNamespace, cliSocket, 'session-1')

        terminalSocket.trigger('terminal:create', {
            sessionId: 'session-1',
            terminalId: 'terminal-1',
            cols: 120,
            rows: 40
        })

        const openEvent = lastEmit(cliSocket, 'terminal:open')
        expect(openEvent?.data).toEqual({
            sessionId: 'session-1',
            terminalId: 'terminal-1',
            cols: 120,
            rows: 40
        })
        expect(lastEmit(terminalSocket, 'terminal:status')?.data).toEqual({
            sessionId: 'session-1',
            terminalId: 'terminal-1',
            owner: 'self',
            attachedAt: expect.any(Number),
            canTakeOver: false
        })
        expect(terminalRegistry.get('terminal-1')).not.toBeNull()

        terminalSocket.trigger('terminal:write', {
            terminalId: 'terminal-1',
            data: 'ls\n'
        })
        const writeEvent = lastEmit(cliSocket, 'terminal:write')
        expect(writeEvent?.data).toEqual({
            sessionId: 'session-1',
            terminalId: 'terminal-1',
            data: 'ls\n'
        })

        terminalSocket.trigger('terminal:resize', {
            terminalId: 'terminal-1',
            cols: 100,
            rows: 30
        })
        const resizeEvent = lastEmit(cliSocket, 'terminal:resize')
        expect(resizeEvent?.data).toEqual({
            sessionId: 'session-1',
            terminalId: 'terminal-1',
            cols: 100,
            rows: 30
        })

        terminalSocket.trigger('terminal:close', {
            terminalId: 'terminal-1'
        })
        const closeEvent = lastEmit(cliSocket, 'terminal:close')
        expect(closeEvent?.data).toEqual({
            sessionId: 'session-1',
            terminalId: 'terminal-1'
        })
        expect(terminalRegistry.get('terminal-1')).toBeNull()
    })

    it('records human terminal input activity when forwarding writes', () => {
        const inputs: Array<{ sessionId: string; terminalId: string; actor: 'human' }> = []
        const { terminalSocket, cliNamespace } = createHarness({
            onSessionTerminalInput: (payload) => inputs.push(payload)
        })
        const cliSocket = new FakeSocket('cli-socket-1')
        connectCliSocket(cliNamespace, cliSocket, 'session-1')

        terminalSocket.trigger('terminal:create', {
            sessionId: 'session-1',
            terminalId: 'terminal-1',
            cols: 80,
            rows: 24
        })

        terminalSocket.trigger('terminal:write', {
            terminalId: 'terminal-1',
            data: 'echo hi\n'
        })

        expect(inputs).toEqual([
            { sessionId: 'session-1', terminalId: 'terminal-1', actor: 'human' }
        ])
    })

    it('forwards restore-only terminal opens to the CLI socket', () => {
        const { terminalSocket, cliNamespace } = createHarness()
        const cliSocket = new FakeSocket('cli-socket-1')
        connectCliSocket(cliNamespace, cliSocket, 'session-1')

        terminalSocket.trigger('terminal:create', {
            sessionId: 'session-1',
            terminalId: 'terminal-restore',
            cols: 100,
            rows: 30,
            createIfMissing: false
        })

        expect(lastEmit(cliSocket, 'terminal:open')?.data).toEqual({
            sessionId: 'session-1',
            terminalId: 'terminal-restore',
            cols: 100,
            rows: 30,
            createIfMissing: false
        })
    })

    it('detaches terminal on socket disconnect and lets the next socket reattach', () => {
        const { io, terminalSocket, cliNamespace, terminalRegistry } = createHarness()
        const cliSocket = new FakeSocket('cli-socket-1')
        connectCliSocket(cliNamespace, cliSocket, 'session-1')

        terminalSocket.trigger('terminal:create', {
            sessionId: 'session-1',
            terminalId: 'terminal-1',
            cols: 90,
            rows: 24
        })

        terminalSocket.trigger('disconnect')

        const closeEvent = lastEmit(cliSocket, 'terminal:close')
        expect(closeEvent).toBeUndefined()
        expect(terminalRegistry.get('terminal-1')?.socketId).toBeNull()

        const replacementSocket = new FakeSocket('terminal-socket-2')
        replacementSocket.data.namespace = 'default'
        io.of('/terminal').sockets.set(replacementSocket.id, replacementSocket)
        registerTerminalHandlers(replacementSocket as unknown as SocketWithData, {
            io: io as unknown as SocketServer,
            getSession: () => ({ active: true, namespace: 'default' }),
            terminalRegistry,
            maxTerminalsPerSocket: 4,
            maxTerminalsPerSession: 4
        })

        replacementSocket.trigger('terminal:create', {
            sessionId: 'session-1',
            terminalId: 'terminal-1',
            cols: 90,
            rows: 24
        })

        expect(lastEmit(replacementSocket, 'terminal:status')?.data).toEqual({
            sessionId: 'session-1',
            terminalId: 'terminal-1',
            owner: 'self',
            attachedAt: expect.any(Number),
            canTakeOver: false
        })
        const readyEvent = lastEmit(replacementSocket, 'terminal:ready')
        expect(readyEvent).toBeUndefined()
        expect(terminalRegistry.get('terminal-1')?.socketId).toBe('terminal-socket-2')
        expect(lastEmit(cliSocket, 'terminal:open')?.data).toEqual({
            sessionId: 'session-1',
            terminalId: 'terminal-1',
            cols: 90,
            rows: 24
        })
    })

    it('requires takeover confirmation before moving a live terminal to another browser', () => {
        const { io, terminalSocket, cliNamespace, terminalRegistry } = createHarness()
        const cliSocket = new FakeSocket('cli-socket-1')
        connectCliSocket(cliNamespace, cliSocket, 'session-1')

        terminalSocket.trigger('terminal:create', {
            sessionId: 'session-1',
            terminalId: 'terminal-1',
            cols: 90,
            rows: 24
        })

        const replacementSocket = new FakeSocket('terminal-socket-2')
        replacementSocket.data.namespace = 'default'
        io.of('/terminal').sockets.set(replacementSocket.id, replacementSocket)
        registerTerminalHandlers(replacementSocket as unknown as SocketWithData, {
            io: io as unknown as SocketServer,
            getSession: () => ({ active: true, namespace: 'default' }),
            terminalRegistry,
            maxTerminalsPerSocket: 4,
            maxTerminalsPerSession: 4
        })

        replacementSocket.trigger('terminal:create', {
            sessionId: 'session-1',
            terminalId: 'terminal-1',
            cols: 90,
            rows: 24
        })

        expect(lastEmit(replacementSocket, 'terminal:status')?.data).toEqual({
            sessionId: 'session-1',
            terminalId: 'terminal-1',
            owner: 'other',
            attachedAt: expect.any(Number),
            canTakeOver: true
        })
        expect(lastEmit(replacementSocket, 'terminal:error')?.data).toEqual({
            terminalId: 'terminal-1',
            message: 'Terminal is attached in another browser. Reconnect here to take over.'
        })
        expect(terminalRegistry.get('terminal-1')?.socketId).toBe('terminal-socket')

        replacementSocket.trigger('terminal:create', {
            sessionId: 'session-1',
            terminalId: 'terminal-1',
            cols: 90,
            rows: 24,
            force: true
        })

        expect(terminalRegistry.get('terminal-1')?.socketId).toBe('terminal-socket-2')
        expect(lastEmit(replacementSocket, 'terminal:status')?.data).toEqual({
            sessionId: 'session-1',
            terminalId: 'terminal-1',
            owner: 'self',
            attachedAt: expect.any(Number),
            canTakeOver: false
        })
        expect(lastEmit(terminalSocket, 'terminal:status')?.data).toEqual({
            sessionId: 'session-1',
            terminalId: 'terminal-1',
            owner: 'other',
            attachedAt: expect.any(Number),
            canTakeOver: true
        })
        expect(lastEmit(terminalSocket, 'terminal:error')?.data).toEqual({
            terminalId: 'terminal-1',
            message: 'Terminal moved to another browser.'
        })
        expect(lastEmit(cliSocket, 'terminal:open')?.data).toEqual({
            sessionId: 'session-1',
            terminalId: 'terminal-1',
            cols: 90,
            rows: 24
        })
    })

    it('enforces per-socket terminal limits', () => {
        const { terminalSocket, cliNamespace } = createHarness({ maxTerminalsPerSocket: 1 })
        const cliSocket = new FakeSocket('cli-socket-1')
        connectCliSocket(cliNamespace, cliSocket, 'session-1')

        terminalSocket.trigger('terminal:create', {
            sessionId: 'session-1',
            terminalId: 'terminal-1',
            cols: 80,
            rows: 24
        })

        terminalSocket.trigger('terminal:create', {
            sessionId: 'session-1',
            terminalId: 'terminal-2',
            cols: 80,
            rows: 24
        })

        const errorEvent = lastEmit(terminalSocket, 'terminal:error')
        expect(errorEvent?.data).toEqual({
            terminalId: 'terminal-2',
            message: 'Too many terminals open (max 1).'
        })
    })
})
