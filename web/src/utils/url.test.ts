import { describe, expect, it } from 'vitest'
import { getBrokerBasepath, normalizeUrlToBrokerBase } from './url'

describe('getBrokerBasepath', () => {
    it('returns the broker root for deep links', () => {
        expect(getBrokerBasepath('/h/demo/sessions/123')).toBe('/h/demo')
    })

    it('ignores trailing slashes', () => {
        expect(getBrokerBasepath('/h/demo/')).toBe('/h/demo')
    })

    it('returns an empty string outside broker routes', () => {
        expect(getBrokerBasepath('/sessions/123')).toBe('')
    })
})

describe('normalizeUrlToBrokerBase', () => {
    it('pins the base URL to the broker root for deep links', () => {
        const url = new URL('https://example.com/h/demo/sessions/123?x=1')
        expect(normalizeUrlToBrokerBase(url, '/h/demo')).toBe('https://example.com/h/demo?x=1')
    })

    it('preserves same-origin paths when no broker basepath is present', () => {
        const url = new URL('https://example.com/sessions/123?x=1')
        expect(normalizeUrlToBrokerBase(url, '')).toBe('https://example.com/sessions/123?x=1')
    })
})
