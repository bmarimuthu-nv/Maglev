import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
    bootstrapSessionMock,
    registerKillSessionHandlerMock,
    getShellTerminalIdMock,
    loggerInfoDeveloperMock
} = vi.hoisted(() => ({
    bootstrapSessionMock: vi.fn(),
    registerKillSessionHandlerMock: vi.fn(),
    getShellTerminalIdMock: vi.fn(() => 'terminal-1'),
    loggerInfoDeveloperMock: vi.fn()
}))

vi.mock('@/agent/sessionFactory', () => ({
    bootstrapSession: bootstrapSessionMock
}))

vi.mock('@/session/registerKillSessionHandler', () => ({
    registerKillSessionHandler: registerKillSessionHandlerMock
}))

vi.mock('@/shell/terminalId', () => ({
    getShellTerminalId: getShellTerminalIdMock
}))

vi.mock('@/ui/logger', () => ({
    logger: {
        infoDeveloper: loggerInfoDeveloperMock,
        logFilePath: '/tmp/maglev.log'
    }
}))

import { runShell } from './runShell'

describe('runShell', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('marks shell metadata ready only after ensuring the terminal backend', async () => {
        const callOrder: string[] = []
        let shutdownHandler: (() => Promise<void>) | null = null

        const session = {
            rpcHandlerManager: {},
            updateMetadata: vi.fn((updater: (metadata: Record<string, unknown>) => Record<string, unknown>) => {
                callOrder.push('updateMetadata')
                updater({})
            }),
            ensureTerminal: vi.fn(() => {
                callOrder.push('ensureTerminal')
            }),
            keepAlive: vi.fn(),
            checkTerminalExists: vi.fn(() => ({ status: 'exists' as const })),
            sendSessionDeath: vi.fn(),
            flush: vi.fn(async () => {}),
            close: vi.fn()
        }

        bootstrapSessionMock.mockResolvedValue({
            session,
            sessionInfo: { id: 'session-1' }
        })
        registerKillSessionHandlerMock.mockImplementation((_manager: unknown, handler: () => Promise<void>) => {
            shutdownHandler = handler
        })

        const runPromise = runShell()
        await Promise.resolve()
        await Promise.resolve()

        expect(callOrder.indexOf('ensureTerminal')).toBeGreaterThanOrEqual(0)
        expect(callOrder.indexOf('updateMetadata')).toBeGreaterThan(callOrder.indexOf('ensureTerminal'))

        expect(shutdownHandler).toBeTypeOf('function')
        await shutdownHandler!()
        await runPromise
    })
})
