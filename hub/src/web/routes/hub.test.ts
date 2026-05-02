import { afterEach, describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import type { WebAppEnv } from '../middleware/auth'
import { createHubRoutes } from './hub'

describe('hub routes', () => {
    const originalHubName = process.env.MAGLEV_HUB_NAME
    const originalNamespace = process.env.MAGLEV_NAMESPACE

    afterEach(() => {
        if (originalHubName === undefined) {
            delete process.env.MAGLEV_HUB_NAME
        } else {
            process.env.MAGLEV_HUB_NAME = originalHubName
        }

        if (originalNamespace === undefined) {
            delete process.env.MAGLEV_NAMESPACE
        } else {
            process.env.MAGLEV_NAMESPACE = originalNamespace
        }
    })

    it('exposes stable hub identity without session auth context', async () => {
        process.env.MAGLEV_HUB_NAME = 'work-hub'
        process.env.MAGLEV_NAMESPACE = 'hub-work-hub'

        const app = new Hono<WebAppEnv>()
        app.route('/api', createHubRoutes(() => null, async () => []))

        const response = await app.request('/api/hub/identity')

        expect(response.status).toBe(200)
        await expect(response.json()).resolves.toMatchObject({
            name: 'work-hub',
            namespace: 'hub-work-hub',
            identityKey: expect.stringContaining('hub:hub-work-hub')
        })
    })
})
