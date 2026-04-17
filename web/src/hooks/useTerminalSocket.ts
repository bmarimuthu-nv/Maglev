import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'

type TerminalConnectionState =
    | { status: 'idle' }
    | { status: 'connecting' }
    | { status: 'connected' }
    | { status: 'error'; error: string }

type UseTerminalSocketOptions = {
    baseUrl: string
    token: string
    sessionId: string
    terminalId: string | null
    createIfMissing?: boolean
}

type TerminalReadyPayload = {
    terminalId: string
}

type TerminalOutputPayload = {
    terminalId: string
    data: string
}

type TerminalExitPayload = {
    terminalId: string
    code: number | null
    signal: string | null
}

type TerminalErrorPayload = {
    terminalId: string
    message: string
}

type TerminalSnapshot = {
    outputBuffer: string
    exitInfo: { code: number | null; signal: string | null } | null
}

type TerminalController = {
    key: string
    state: TerminalConnectionState
    socket: Socket | null
    token: string
    baseUrl: string
    sessionId: string
    terminalId: string | null
    lastSize: { cols: number; rows: number } | null
    hasCreated: boolean
    outputBuffer: string
    exitInfo: { code: number | null; signal: string | null } | null
    stateListeners: Set<() => void>
    outputListeners: Set<(data: string) => void>
    exitListeners: Set<(code: number | null, signal: string | null) => void>
}

const OUTPUT_BUFFER_CHARS = 200_000
const controllers = new Map<string, TerminalController>()

function getSocketPath(baseUrl: string): string {
    try {
        const base = new URL(baseUrl)
        const prefix = base.pathname.replace(/\/+$/, '')
        return prefix ? `${prefix}/socket.io/` : '/socket.io/'
    } catch {
        return '/socket.io/'
    }
}

function getSocketOrigin(baseUrl: string): string {
    try {
        const base = new URL(baseUrl)
        return base.origin
    } catch {
        return baseUrl
    }
}

function getControllerKey(options: UseTerminalSocketOptions): string {
    return `${options.baseUrl}::${options.sessionId}::${options.terminalId ?? 'pending'}`
}

function notifyState(controller: TerminalController): void {
    for (const listener of controller.stateListeners) {
        listener()
    }
}

function setControllerState(controller: TerminalController, state: TerminalConnectionState): void {
    controller.state = state
    notifyState(controller)
}

function appendOutput(controller: TerminalController, chunk: string): void {
    if (!chunk) {
        return
    }
    controller.outputBuffer += chunk
    if (controller.outputBuffer.length > OUTPUT_BUFFER_CHARS) {
        controller.outputBuffer = controller.outputBuffer.slice(controller.outputBuffer.length - OUTPUT_BUFFER_CHARS)
    }
}

function emitCreate(
    controller: TerminalController,
    socket: Socket,
    size: { cols: number; rows: number },
    force = false,
    createIfMissing = true
): void {
    socket.emit('terminal:create', {
        sessionId: controller.sessionId,
        terminalId: controller.terminalId,
        cols: size.cols,
        rows: size.rows,
        force,
        createIfMissing
    })
}

function setErrorState(controller: TerminalController, message: string): void {
    setControllerState(controller, { status: 'error', error: message })
}

function ensureController(options: UseTerminalSocketOptions): TerminalController {
    const key = getControllerKey(options)
    const existing = controllers.get(key)
    if (existing) {
        existing.token = options.token
        existing.baseUrl = options.baseUrl
        return existing
    }

    const controller: TerminalController = {
        key,
        state: { status: 'idle' },
        socket: null,
        token: options.token,
        baseUrl: options.baseUrl,
        sessionId: options.sessionId,
        terminalId: options.terminalId,
        lastSize: null,
        hasCreated: false,
        outputBuffer: '',
        exitInfo: null,
        stateListeners: new Set(),
        outputListeners: new Set(),
        exitListeners: new Set()
    }

    controllers.set(key, controller)
    return controller
}

function connectController(controller: TerminalController, cols: number, rows: number, createIfMissing = true): void {
    controller.lastSize = { cols, rows }
    if (!controller.token || !controller.sessionId || !controller.terminalId) {
        setErrorState(controller, 'Missing terminal credentials.')
        return
    }

    if (controller.socket) {
        controller.socket.auth = { token: controller.token }
        if (controller.socket.connected) {
            if (controller.hasCreated) {
                setControllerState(controller, { status: 'connected' })
            } else {
                emitCreate(controller, controller.socket, { cols, rows }, false, createIfMissing)
                setControllerState(controller, { status: 'connecting' })
            }
        } else {
            controller.socket.connect()
            setControllerState(controller, { status: 'connecting' })
        }
        return
    }

    const socket = io(`${getSocketOrigin(controller.baseUrl)}/terminal`, {
        auth: { token: controller.token },
        path: getSocketPath(controller.baseUrl),
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        transports: ['websocket'],
        autoConnect: false
    })

    controller.socket = socket
    setControllerState(controller, { status: 'connecting' })

    socket.on('connect', () => {
        const size = controller.lastSize
        if (!size) {
            return
        }
        controller.exitInfo = null
        setControllerState(controller, { status: 'connecting' })
        emitCreate(controller, socket, size, false, createIfMissing)
    })

    socket.on('terminal:ready', (payload: TerminalReadyPayload) => {
        if (payload.terminalId !== controller.terminalId) {
            return
        }
        controller.hasCreated = true
        setControllerState(controller, { status: 'connected' })
    })

    socket.on('terminal:output', (payload: TerminalOutputPayload) => {
        if (payload.terminalId !== controller.terminalId) {
            return
        }
        if (controller.state.status !== 'connected') {
            controller.hasCreated = true
            setControllerState(controller, { status: 'connected' })
        }
        appendOutput(controller, payload.data)
        for (const listener of controller.outputListeners) {
            listener(payload.data)
        }
    })

    socket.on('terminal:exit', (payload: TerminalExitPayload) => {
        if (payload.terminalId !== controller.terminalId) {
            return
        }
        controller.exitInfo = { code: payload.code, signal: payload.signal }
        controller.hasCreated = false
        for (const listener of controller.exitListeners) {
            listener(payload.code, payload.signal)
        }
        setErrorState(controller, 'Terminal exited.')
    })

    socket.on('terminal:error', (payload: TerminalErrorPayload) => {
        if (payload.terminalId !== controller.terminalId) {
            return
        }
        setErrorState(controller, payload.message)
    })

    socket.on('connect_error', (error) => {
        const message = error instanceof Error ? error.message : 'Connection error'
        setErrorState(controller, message)
    })

    socket.on('disconnect', (reason) => {
        if (reason === 'io client disconnect') {
            controller.hasCreated = false
            setControllerState(controller, { status: 'idle' })
            return
        }
        controller.hasCreated = false
        setErrorState(controller, `Disconnected: ${reason}`)
    })

    socket.connect()
}

function disconnectController(controller: TerminalController): void {
    const socket = controller.socket
    if (!socket) {
        return
    }
    socket.removeAllListeners()
    socket.disconnect()
    controller.socket = null
    controller.hasCreated = false
    controller.outputBuffer = ''
    controller.exitInfo = null
    setControllerState(controller, { status: 'idle' })

    // Remove from module-level map if no listeners remain
    if (controller.stateListeners.size === 0
        && controller.outputListeners.size === 0
        && controller.exitListeners.size === 0) {
        controllers.delete(controller.key)
    }
}

function replayControllerSnapshot(
    controller: TerminalController,
    outputHandler: ((data: string) => void) | null,
    exitHandler: ((code: number | null, signal: string | null) => void) | null
): void {
    if (outputHandler && controller.outputBuffer) {
        outputHandler(controller.outputBuffer)
    }
    if (exitHandler && controller.exitInfo) {
        exitHandler(controller.exitInfo.code, controller.exitInfo.signal)
    }
}

export function useTerminalSocket(options: UseTerminalSocketOptions): {
    state: TerminalConnectionState
    connect: (cols: number, rows: number) => void
    reconnectView: (cols: number, rows: number) => void
    write: (data: string) => void
    resize: (cols: number, rows: number) => void
    disconnect: () => void
    onOutput: (handler: (data: string) => void) => void
    onExit: (handler: (code: number | null, signal: string | null) => void) => void
    replay: () => void
    takeOver: () => void
} {
    const controller = useMemo(() => ensureController(options), [options.baseUrl, options.sessionId, options.terminalId, options.token])
    const [state, setState] = useState<TerminalConnectionState>(controller.state)
    const outputHandlerRef = useRef<((data: string) => void) | null>(null)
    const exitHandlerRef = useRef<((code: number | null, signal: string | null) => void) | null>(null)

    useEffect(() => {
        controller.token = options.token
        controller.baseUrl = options.baseUrl
        if (controller.socket) {
            controller.socket.auth = { token: options.token }
        }
    }, [controller, options.token, options.baseUrl])

    useEffect(() => {
        const handleState = () => {
            setState(controller.state)
        }
        const handleOutput = (data: string) => {
            outputHandlerRef.current?.(data)
        }
        const handleExit = (code: number | null, signal: string | null) => {
            exitHandlerRef.current?.(code, signal)
        }

        controller.stateListeners.add(handleState)
        controller.outputListeners.add(handleOutput)
        controller.exitListeners.add(handleExit)
        setState(controller.state)

        return () => {
            controller.stateListeners.delete(handleState)
            controller.outputListeners.delete(handleOutput)
            controller.exitListeners.delete(handleExit)

            // Evict idle controller when last listener detaches
            if (controller.stateListeners.size === 0
                && controller.outputListeners.size === 0
                && controller.exitListeners.size === 0
                && !controller.socket) {
                controllers.delete(controller.key)
            }
        }
    }, [controller])

    const connect = useCallback((cols: number, rows: number) => {
        connectController(controller, cols, rows, options.createIfMissing ?? true)
    }, [controller, options.createIfMissing])

    const reconnectView = useCallback((cols: number, rows: number) => {
        controller.lastSize = { cols, rows }
        const socket = controller.socket
        if (!socket || !socket.connected || !controller.hasCreated) {
            connectController(controller, cols, rows, options.createIfMissing ?? true)
            return
        }
        controller.exitInfo = null
        emitCreate(controller, socket, { cols, rows }, false, options.createIfMissing ?? true)
        setControllerState(controller, { status: 'connecting' })
    }, [controller])

    const write = useCallback((data: string) => {
        const socket = controller.socket
        if (!socket || !socket.connected) {
            return
        }
        socket.emit('terminal:write', { terminalId: controller.terminalId, data })
    }, [controller])

    const resize = useCallback((cols: number, rows: number) => {
        controller.lastSize = { cols, rows }
        const socket = controller.socket
        if (!socket || !socket.connected || !controller.hasCreated) {
            return
        }
        socket.emit('terminal:resize', { terminalId: controller.terminalId, cols, rows })
    }, [controller])

    const disconnect = useCallback(() => {
        disconnectController(controller)
    }, [controller])

    const onOutput = useCallback((handler: (data: string) => void) => {
        outputHandlerRef.current = handler
    }, [])

    const onExit = useCallback((handler: (code: number | null, signal: string | null) => void) => {
        exitHandlerRef.current = handler
    }, [])

    const replay = useCallback(() => {
        replayControllerSnapshot(controller, outputHandlerRef.current, exitHandlerRef.current)
    }, [controller])

    const takeOver = useCallback(() => {
        const socket = controller.socket
        const size = controller.lastSize
        if (!socket || !socket.connected || !size) {
            return
        }
        controller.exitInfo = null
        emitCreate(controller, socket, size, true, options.createIfMissing ?? true)
        setControllerState(controller, { status: 'connecting' })
    }, [controller, options.createIfMissing])

    return {
        state,
        connect,
        reconnectView,
        write,
        resize,
        disconnect,
        onOutput,
        onExit,
        replay,
        takeOver
    }
}
