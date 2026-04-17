import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import type { Session, SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { createSessionsRoutes } from './sessions'

function createSession(overrides?: Partial<Session>): Session {
    const baseMetadata = {
        path: '/tmp/project',
        host: 'localhost',
        flavor: 'shell' as const
    }
    const base: Session = {
        id: 'session-1',
        namespace: 'default',
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: true,
        activeAt: 1,
        metadata: baseMetadata,
        metadataVersion: 1,
        agentState: {
            controlledByUser: false,
            requests: {},
            completedRequests: {}
        },
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: 1,
        model: 'gpt-5.4'
    }

    return {
        ...base,
        ...overrides,
        metadata: overrides?.metadata === undefined
            ? base.metadata
            : overrides.metadata === null
                ? null
                : {
                    ...baseMetadata,
                    ...overrides.metadata
                },
        agentState: overrides?.agentState === undefined ? base.agentState : overrides.agentState
    }
}

function createApp(session: Session) {
    const engine = {
        resolveSessionAccess: () => ({ ok: true, sessionId: session.id, session })
    } as Partial<SyncEngine>

    const app = new Hono<WebAppEnv>()
    app.use('*', async (c, next) => {
        c.set('namespace', 'default')
        await next()
    })
    app.route('/api', createSessionsRoutes(() => engine as SyncEngine))

    return { app }
}

describe('sessions routes', () => {
    it('forwards terminal pair rebind requests to the sync engine', async () => {
        const session = createSession({
            metadata: {
                path: '/tmp/project',
                host: 'localhost',
                flavor: 'shell',
                shellTerminalId: 'terminal:1',
                shellTerminalState: 'ready',
                terminalPair: {
                    pairId: 'pair-1',
                    pairName: 'deploy',
                    role: 'worker',
                    state: 'active'
                }
            }
        })
        const rebindCalls: Array<[string, string, string]> = []
        const engine = {
            resolveSessionAccess: () => ({ ok: true, sessionId: session.id, session }),
            rebindTerminalPairBySession: async (sessionId: string, replacementSessionId: string, namespace: string) => {
                rebindCalls.push([sessionId, replacementSessionId, namespace])
                return {
                    id: 'pair-1',
                    namespace,
                    name: 'deploy',
                    createdAt: 1,
                    updatedAt: 2,
                    state: 'active',
                    workerSessionId: replacementSessionId,
                    supervisorSessionId: 'session-supervisor',
                    worker: {
                        role: 'worker',
                        workingDirectory: '/tmp/project',
                        sessionName: 'deploy_worker'
                    },
                    supervisor: {
                        role: 'supervisor',
                        workingDirectory: '/tmp/project',
                        sessionName: 'deploy_supervisor'
                    }
                }
            }
        } as Partial<SyncEngine>

        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => {
            c.set('namespace', 'default')
            await next()
        })
        app.route('/api', createSessionsRoutes(() => engine as SyncEngine))

        const response = await app.request('/api/sessions/session-1/terminal-pair/rebind', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ replacementSessionId: 'session-2' })
        })

        expect(response.status).toBe(200)
        expect(rebindCalls).toEqual([['session-1', 'session-2', 'default']])
        await expect(response.json()).resolves.toMatchObject({
            pair: {
                id: 'pair-1',
                workerSessionId: 'session-2'
            }
        })
    })

    it('forwards add-supervisor requests to the sync engine', async () => {
        const session = createSession({
            metadata: {
                path: '/tmp/project',
                host: 'localhost',
                flavor: 'shell',
                shellTerminalId: 'terminal:1',
                shellTerminalState: 'ready'
            }
        })
        const addSupervisorCalls: Array<[string, string, { name: string }]> = []
        const engine = {
            resolveSessionAccess: () => ({ ok: true, sessionId: session.id, session }),
            addSupervisorToWorkerSession: async (
                sessionId: string,
                namespace: string,
                options: { name: string }
            ) => {
                addSupervisorCalls.push([sessionId, namespace, options])
                return {
                    type: 'success' as const,
                    pair: {
                        id: 'pair-2',
                        namespace,
                        name: options.name,
                        createdAt: 1,
                        updatedAt: 2,
                        state: 'active' as const,
                        workerSessionId: sessionId,
                        supervisorSessionId: 'session-supervisor',
                        worker: {
                            role: 'worker' as const,
                            workingDirectory: '/tmp/project',
                            sessionName: `${options.name}_worker`
                        },
                        supervisor: {
                            role: 'supervisor' as const,
                            workingDirectory: '/tmp/project',
                            sessionName: `${options.name}_supervisor`
                        }
                    }
                }
            }
        } as Partial<SyncEngine>

        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => {
            c.set('namespace', 'default')
            await next()
        })
        app.route('/api', createSessionsRoutes(() => engine as SyncEngine))

        const response = await app.request('/api/sessions/session-1/terminal-pair/add-supervisor', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'deploy' })
        })

        expect(response.status).toBe(200)
        expect(addSupervisorCalls).toEqual([[
            'session-1',
            'default',
            { name: 'deploy' }
        ]])
        await expect(response.json()).resolves.toMatchObject({
            type: 'success',
            pair: {
                id: 'pair-2',
                supervisorSessionId: 'session-supervisor'
            }
        })
    })
})
