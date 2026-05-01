import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { socketMocks, ioMock, registerCommonHandlersMock, loggerDebugMock } = vi.hoisted(() => {
    const handlers = new Map<string, (...args: any[]) => void>()
    const socket = {
        on: vi.fn((event: string, handler: (...args: any[]) => void) => {
            handlers.set(event, handler)
            return socket
        }),
        emit: vi.fn(),
        emitWithAck: vi.fn(async () => ({
            result: 'success',
            version: 2,
            runnerState: {
                status: 'running',
                pid: 123,
                httpPort: 4567,
                startedAt: 1
            }
        })),
        close: vi.fn(),
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

import { ApiMachineClient } from './apiMachine'

describe('ApiMachineClient', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        socketMocks.handlers.clear()
        socketMocks.socket.on.mockClear()
        socketMocks.socket.emit.mockClear()
        socketMocks.socket.emitWithAck.mockClear()
        socketMocks.socket.close.mockClear()
        ioMock.mockClear()
        registerCommonHandlersMock.mockClear()
        loggerDebugMock.mockClear()
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('emits machine-alive immediately after connecting', async () => {
        const client = new ApiMachineClient('token:hub-smoke', {
            id: 'machine-1',
            seq: 1,
            createdAt: 1,
            updatedAt: 1,
            active: false,
            activeAt: 1,
            metadata: null,
            metadataVersion: 1,
            runnerState: null,
            runnerStateVersion: 1
        })

        client.connect()

        const onConnect = socketMocks.handlers.get('connect')
        expect(onConnect).toBeTypeOf('function')

        onConnect?.()
        await vi.runAllTicks()

        expect(socketMocks.socket.emit).toHaveBeenCalledWith(
            'machine-alive',
            expect.objectContaining({
                machineId: 'machine-1'
            })
        )
    })

    it('uses the provided namespaced token for socket auth', () => {
        new ApiMachineClient('token:hub-smoke', {
            id: 'machine-1',
            seq: 1,
            createdAt: 1,
            updatedAt: 1,
            active: false,
            activeAt: 1,
            metadata: null,
            metadataVersion: 1,
            runnerState: null,
            runnerStateVersion: 1
        }).connect()

        expect(ioMock).toHaveBeenCalledTimes(1)
        const ioCalls = (ioMock as any).mock.calls as Array<[string, {
            auth?: (cb: (value: Record<string, unknown>) => void) => void
        } | undefined]>
        const options = (ioCalls[0]?.[1] ?? null) as {
            auth?: (cb: (value: Record<string, unknown>) => void) => void
        } | null
        expect(options).toBeTruthy()
        expect(typeof options?.auth).toBe('function')

        let authPayload: Record<string, unknown> | undefined
        if (!options?.auth) {
            throw new Error('Expected socket auth callback to be configured')
        }
        options.auth((value: Record<string, unknown>) => {
            authPayload = value
        })

        expect(authPayload).toEqual(expect.objectContaining({
            token: 'token:hub-smoke',
            clientType: 'machine-scoped',
            machineId: 'machine-1'
        }))
    })
})
