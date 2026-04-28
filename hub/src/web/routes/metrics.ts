import { Hono } from 'hono'
import type { SSEManager } from '../../sse/sseManager'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { createHubNamespaceMetricsSnapshot, logObservabilityEvent } from '../observability'

export function createMetricsRoutes(
    getSyncEngine: () => SyncEngine | null,
    getSseManager: () => SSEManager | null,
    startedAtMs: number
): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/metrics', (c) => {
        try {
            return c.json(createHubNamespaceMetricsSnapshot({
                namespace: c.get('namespace'),
                syncEngine: getSyncEngine(),
                sseManager: getSseManager(),
                startedAtMs
            }))
        } catch (error) {
            logObservabilityEvent('error', 'metrics-request-failed', {
                path: c.req.path,
                namespace: c.get('namespace'),
                message: error instanceof Error ? error.message : 'unknown error'
            })
            return c.json({ error: 'Failed to collect metrics' }, 500)
        }
    })

    return app
}
