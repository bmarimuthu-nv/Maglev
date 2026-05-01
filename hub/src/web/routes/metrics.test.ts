import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import type { SSEManager } from '../../sse/sseManager'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { createMetricsRoutes } from './metrics'

describe('metrics routes', () => {
    it('returns namespace-scoped metrics for the authenticated namespace', async () => {
        const engine = {
            getSessionCountByNamespace: (namespace: string) => namespace === 'alpha' ? 4 : 0,
            getActiveSessionCountByNamespace: (namespace: string) => namespace === 'alpha' ? 2 : 0,
            getMachineCountByNamespace: (namespace: string) => namespace === 'alpha' ? 3 : 0,
            getOnlineMachineCountByNamespace: (namespace: string) => namespace === 'alpha' ? 1 : 0
        } as unknown as SyncEngine

        const sseManager = {
            getConnectionCount: (namespace?: string) => namespace === 'alpha' ? 2 : 5,
            getVisibleConnectionCount: (namespace?: string) => namespace === 'alpha' ? 1 : 3
        } as unknown as SSEManager

        const app = new Hono<WebAppEnv>()
        app.use('/api/*', async (c, next) => {
            c.set('namespace', 'alpha')
            await next()
        })
        app.route('/api', createMetricsRoutes(() => engine, () => sseManager, 1_000))

        const response = await app.request('/api/metrics')

        expect(response.status).toBe(200)
        await expect(response.json()).resolves.toMatchObject({
            namespace: 'alpha',
            uptimeMs: expect.any(Number),
            sessions: {
                total: 4,
                active: 2
            },
            machines: {
                total: 3,
                online: 1
            },
            sse: {
                connections: {
                    total: 2,
                    visible: 1
                }
            }
        })
    })
})
