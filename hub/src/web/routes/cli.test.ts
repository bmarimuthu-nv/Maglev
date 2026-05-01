import { afterEach, describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { createConfiguration, getConfiguration } from '../../configuration'
import type { SyncEngine } from '../../sync/syncEngine'
import { createCliRoutes } from './cli'

describe('cli routes', () => {
    let originalToken = ''

    afterEach(() => {
        getConfiguration().cliApiToken = originalToken
    })

    it('forwards supervisor writes to the sync engine', async () => {
        const config = await createConfiguration()
        originalToken = config.cliApiToken
        config.cliApiToken = 'test-token'

        const calls: Array<{ sessionId: string; data: string; namespace: string }> = []
        const engine = {
            resolveSessionAccess: () => ({
                ok: true as const,
                sessionId: 'session-1',
                session: {
                    id: 'session-1',
                    namespace: 'default'
                }
            }),
            writeTerminalSupervisionInput: async (sessionId: string, data: string, namespace: string) => {
                calls.push({ sessionId, data, namespace })
                return { delivered: true as const }
            }
        } as unknown as SyncEngine

        const app = new Hono()
        app.route('/cli', createCliRoutes(() => engine))

        const response = await app.request('/cli/sessions/session-1/supervisor/write', {
            method: 'POST',
            headers: {
                authorization: 'Bearer test-token',
                'content-type': 'application/json'
            },
            body: JSON.stringify({ data: 'pwd\n' })
        })

        expect(response.status).toBe(200)
        expect(calls).toEqual([{ sessionId: 'session-1', data: 'pwd\n', namespace: 'default' }])
        await expect(response.json()).resolves.toEqual({ delivered: true })
    })
})
