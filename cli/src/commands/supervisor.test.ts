import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import axios from 'axios'
import { configuration } from '@/configuration'
import { resolveCommand } from './registry'
import { __test__, supervisorCommand } from './supervisor'

vi.mock('axios', () => ({
    default: {
        post: vi.fn()
    }
}))

vi.mock('@/ui/tokenInit', () => ({
    initializeToken: vi.fn(async () => {})
}))

vi.mock('@/api/auth', () => ({
    getAuthToken: vi.fn(() => 'namespaced-token')
}))

describe('supervisor command', () => {
    const originalApiUrl = configuration.apiUrl
    const originalSessionId = process.env.MAGLEV_SESSION_ID

    beforeEach(() => {
        vi.clearAllMocks()
        configuration._setApiUrl('http://hub.example.test')
        delete process.env.MAGLEV_SESSION_ID
    })

    afterEach(() => {
        configuration._setApiUrl(originalApiUrl)
        if (originalSessionId === undefined) {
            delete process.env.MAGLEV_SESSION_ID
        } else {
            process.env.MAGLEV_SESSION_ID = originalSessionId
        }
    })

    it('parses session selection and newline behavior', () => {
        expect(__test__.parseSupervisorSendArgs(['--session', 'session-1', '--no-newline', '--', 'git', 'status'])).toEqual({
            sessionId: 'session-1',
            appendNewline: false,
            dataParts: ['git', 'status']
        })

        process.env.MAGLEV_SESSION_ID = 'session-env'
        expect(__test__.parseSupervisorSendArgs(['echo', 'hello'])).toEqual({
            sessionId: 'session-env',
            appendNewline: true,
            dataParts: ['echo', 'hello']
        })
    })

    it('is registered as a top-level command', () => {
        const resolved = resolveCommand(['supervisor', 'send', '--session', 'session-1', 'pwd'])
        expect(resolved.command).toBe(supervisorCommand)
        expect(resolved.context.commandArgs).toEqual(['send', '--session', 'session-1', 'pwd'])
    })

    it('posts supervisor input to the hub CLI route', async () => {
        await supervisorCommand.run({
            args: ['supervisor', 'send', '--session', 'session-1', 'git', 'status'],
            subcommand: 'supervisor',
            commandArgs: ['send', '--session', 'session-1', 'git', 'status']
        })

        expect(axios.post).toHaveBeenCalledWith(
            'http://hub.example.test/cli/sessions/session-1/supervisor/write',
            { data: 'git status\n' },
            {
                headers: {
                    Authorization: 'Bearer namespaced-token',
                    'Content-Type': 'application/json'
                },
                timeout: 30_000
            }
        )
    })
})
