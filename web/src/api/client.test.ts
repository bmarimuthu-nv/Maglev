import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiClient } from './client'

describe('ApiClient.writeSessionFile', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('returns structured conflict payloads for HTTP 409 responses', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
            success: false,
            error: 'File changed on disk since this preview was loaded',
            conflict: {
                type: 'hash_mismatch',
                expectedHash: 'stale-hash',
                currentHash: 'fresh-hash',
                currentContent: 'Y29uZmxpY3Q='
            }
        }), {
            status: 409,
            headers: { 'content-type': 'application/json' }
        })))

        const client = new ApiClient('token', { baseUrl: 'https://maglev.test' })
        const result = await client.writeSessionFile('session-1', 'src/example.ts', 'Y29udGVudA==', 'stale-hash')

        expect(result).toEqual({
            success: false,
            error: 'File changed on disk since this preview was loaded',
            conflict: {
                type: 'hash_mismatch',
                expectedHash: 'stale-hash',
                currentHash: 'fresh-hash',
                currentContent: 'Y29uZmxpY3Q='
            }
        })
    })
})
