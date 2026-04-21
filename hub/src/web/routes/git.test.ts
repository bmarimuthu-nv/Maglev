import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import type { Session, SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { createGitRoutes } from './git'

function createSession(overrides?: Partial<Session>): Session {
    const baseMetadata = {
        path: '/tmp/project',
        host: 'localhost',
        flavor: 'shell' as const
    }

    return {
        id: 'session-1',
        namespace: 'default',
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: true,
        activeAt: 1,
        metadata: {
            ...baseMetadata,
            ...(overrides?.metadata ?? {})
        },
        metadataVersion: 1,
        agentState: {
            controlledByUser: false,
            requests: {},
            completedRequests: {}
        },
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: 1,
        model: 'gpt-5.4',
        ...overrides
    }
}

function createApp(engine: Partial<SyncEngine>) {
    const app = new Hono<WebAppEnv>()
    app.use('*', async (c, next) => {
        c.set('namespace', 'default')
        await next()
    })
    app.route('/api', createGitRoutes(() => engine as SyncEngine))
    return app
}

describe('git routes', () => {
    it('uses raw glob patterns when pattern mode is requested for file search', async () => {
        const session = createSession()
        const runRipgrepCalls: Array<[string, string[], string, number | undefined]> = []
        const app = createApp({
            resolveSessionAccess: () => ({ ok: true, sessionId: session.id, session }),
            runRipgrep: async (sessionId: string, args: string[], cwd?: string, limit?: number) => {
                runRipgrepCalls.push([sessionId, args, cwd ?? '', limit])
                return {
                    success: true,
                    stdout: 'src/nested/helper.ts',
                    stderr: '',
                    exitCode: 0
                }
            }
        })

        const response = await app.request('/api/sessions/session-1/files?query=src/**/*.ts&mode=glob&limit=50')

        expect(response.status).toBe(200)
        expect(runRipgrepCalls).toEqual([[
            'session-1',
            ['--files', '--iglob', 'src/**/*.ts'],
            '/tmp/project',
            50
        ]])
        await expect(response.json()).resolves.toMatchObject({
            success: true,
            files: [
                {
                    fileName: 'helper.ts',
                    fullPath: 'src/nested/helper.ts'
                }
            ]
        })
    })
})
