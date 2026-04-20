import { describe, expect, it } from 'bun:test'
import { buildBrokerLocalUrl, createProxyErrorResponse } from './client'

describe('broker client helpers', () => {
    it('uses a loopback address when listen host is unspecified or wildcard', () => {
        expect(buildBrokerLocalUrl(40637)).toBe('http://127.0.0.1:40637')
        expect(buildBrokerLocalUrl(40637, '0.0.0.0')).toBe('http://127.0.0.1:40637')
        expect(buildBrokerLocalUrl(40637, '::')).toBe('http://[::1]:40637')
    })

    it('preserves explicit listen hosts for local proxying', () => {
        expect(buildBrokerLocalUrl(40637, '127.0.0.1')).toBe('http://127.0.0.1:40637')
        expect(buildBrokerLocalUrl(40637, 'localhost')).toBe('http://localhost:40637')
        expect(buildBrokerLocalUrl(40637, '::1')).toBe('http://[::1]:40637')
    })

    it('turns local proxy failures into an explicit 502 response', () => {
        const response = createProxyErrorResponse('req-123', new Error('connect ECONNREFUSED 127.0.0.1:40637'))
        expect(response).toEqual({
            type: 'proxy-response',
            requestId: 'req-123',
            status: 502,
            headers: {
                'content-type': 'text/plain; charset=utf-8'
            },
            bodyBase64: Buffer.from(
                'Failed to forward request to local hub: connect ECONNREFUSED 127.0.0.1:40637',
                'utf8'
            ).toString('base64')
        })
    })
})
