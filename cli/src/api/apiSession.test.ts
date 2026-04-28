import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { socketMocks, ioMock, registerCommonHandlersMock, loggerDebugMock } = vi.hoisted(() => {
    const handlers = new Map<string, (...args: any[]) => void>()
    const socket = {
        on: vi.fn((event: string, handler: (...args: any[]) => void) => {
            handlers.set(event, handler)
            return socket
        }),
        off: vi.fn(),
        emit: vi.fn(),
        emitWithAck: vi.fn(),
        timeout: vi.fn(() => ({
            emitWithAck: vi.fn(async () => undefined)
        })),
        connect: vi.fn(),
        disconnect: vi.fn(),
        connected: true
    }

    return {
        socketMocks: { socket, handlers },
        ioMock: vi.fn(() => socket),
        registerCommonHandlersMock: vi.fn(),
        loggerDebugMock: vi.fn()
    }
})

vi.mock('socket.io-client', () => ({
    io: ioMock
}))

vi.mock('../modules/common/registerCommonHandlers', () => ({
    registerCommonHandlers: registerCommonHandlersMock
}))

vi.mock('@/ui/logger', () => ({
    logger: {
        debug: loggerDebugMock
    }
}))

import { ApiSessionClient } from './apiSession'

describe('ApiSessionClient', () => {
    beforeEach(() => {
        socketMocks.handlers.clear()
        socketMocks.socket.on.mockClear()
        socketMocks.socket.off.mockClear()
        socketMocks.socket.emit.mockClear()
        socketMocks.socket.emitWithAck.mockClear()
        socketMocks.socket.timeout.mockClear()
        socketMocks.socket.connect.mockClear()
        socketMocks.socket.disconnect.mockClear()
        ioMock.mockClear()
        registerCommonHandlersMock.mockClear()
        loggerDebugMock.mockClear()
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('registers common handlers when the session starts with a path', () => {
        new ApiSessionClient('token:hub-smoke', {
            id: 'session-1',
            namespace: 'default',
            seq: 1,
            createdAt: 1,
            updatedAt: 1,
            active: true,
            activeAt: 1,
            metadata: { path: '/tmp/project' },
            metadataVersion: 1,
            agentState: null,
            agentStateVersion: 1,
            thinking: false,
            thinkingAt: 1,
            model: null
        } as any)

        expect(registerCommonHandlersMock).toHaveBeenCalledWith(expect.anything(), '/tmp/project')
    })

    it('registers common handlers when a later metadata update adds a path', () => {
        new ApiSessionClient('token:hub-smoke', {
            id: 'session-1',
            namespace: 'default',
            seq: 1,
            createdAt: 1,
            updatedAt: 1,
            active: true,
            activeAt: 1,
            metadata: {},
            metadataVersion: 1,
            agentState: null,
            agentStateVersion: 1,
            thinking: false,
            thinkingAt: 1,
            model: null
        } as any)

        expect(registerCommonHandlersMock).not.toHaveBeenCalled()

        const onUpdate = socketMocks.handlers.get('update')
        expect(onUpdate).toBeTypeOf('function')

        onUpdate?.({
            body: {
                t: 'update-session',
                metadata: {
                    version: 2,
                    value: {
                        path: '/tmp/project',
                        host: 'localhost'
                    }
                }
            }
        })

        expect(registerCommonHandlersMock).toHaveBeenCalledTimes(1)
        expect(registerCommonHandlersMock).toHaveBeenCalledWith(expect.anything(), '/tmp/project')
    })
})
