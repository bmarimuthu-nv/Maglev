import { afterEach, describe, expect, it } from 'vitest'
import { __test__ } from './shell'

describe('shell hub preflight helpers', () => {
    const originalFetch = globalThis.fetch

    afterEach(() => {
        Object.defineProperty(globalThis, 'fetch', {
            value: originalFetch,
            configurable: true,
            writable: true
        })
    })

    it('reports invalid MAGLEV_API_URL values clearly', async () => {
        const result = await __test__.probeHubHealth('not a url')

        expect(result.ok).toBe(false)
        if (result.ok) {
            throw new Error('Expected invalid-url failure')
        }
        expect(result.reason).toBe('invalid-url')
        expect(__test__.getHubPreflightGuidance(result).join('\n')).toContain('MAGLEV_API_URL is not a valid base URL')
    })

    it('classifies refused connections and suggests starting the hub', async () => {
        Object.defineProperty(globalThis, 'fetch', {
            value: async () => {
            const error = new Error('fetch failed')
            ;(error as Error & { cause?: unknown }).cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3006'), {
                code: 'ECONNREFUSED'
            })
            throw error
            },
            configurable: true,
            writable: true
        })

        const result = await __test__.probeHubHealth('http://localhost:3006')

        expect(result.ok).toBe(false)
        if (result.ok) {
            throw new Error('Expected connection-refused failure')
        }
        expect(result.reason).toBe('connection-refused')
        expect(__test__.getHubPreflightGuidance(result).join('\n')).toContain('Start one with: maglev hub start')
    })

    it('surfaces non-200 health responses as wrong-service guidance', async () => {
        Object.defineProperty(globalThis, 'fetch', {
            value: async () => new Response('busy', { status: 503 }),
            configurable: true,
            writable: true
        })

        const result = await __test__.probeHubHealth('http://localhost:3006')

        expect(result.ok).toBe(false)
        if (result.ok) {
            throw new Error('Expected HTTP failure')
        }
        expect(result.reason).toBe('http-error')
        expect(result.status).toBe(503)
        expect(__test__.getHubPreflightGuidance(result).join('\n')).toContain('wrong service or port')
    })
})
