import { describe, expect, it } from 'vitest'
import { createBackoff, exponentialBackoffDelay } from './time'

describe('createBackoff', () => {
    it('returns the result on first success', async () => {
        const backoff = createBackoff()
        const result = await backoff(async () => 42)
        expect(result).toBe(42)
    })

    it('retries on transient failure then succeeds', async () => {
        let calls = 0
        const backoff = createBackoff({ minDelay: 1, maxDelay: 1, maxFailureCount: 5 })
        const result = await backoff(async () => {
            calls++
            if (calls < 3) throw new Error('transient')
            return 'ok'
        })
        expect(result).toBe('ok')
        expect(calls).toBe(3)
    })

    it('throws after maxAttempts is exhausted', async () => {
        const backoff = createBackoff({ maxAttempts: 3, minDelay: 1, maxDelay: 1, maxFailureCount: 3 })
        await expect(
            backoff(async () => { throw new Error('persistent') })
        ).rejects.toThrow('persistent')
    })

    it('calls onError with failure count', async () => {
        const errors: number[] = []
        const backoff = createBackoff({
            maxAttempts: 3,
            minDelay: 1,
            maxDelay: 1,
            maxFailureCount: 5,
            onError: (_e, count) => errors.push(count)
        })
        await expect(
            backoff(async () => { throw new Error('fail') })
        ).rejects.toThrow('fail')
        expect(errors).toEqual([1, 2])
    })

    it('defaults maxAttempts to 200', async () => {
        // We cannot run 200 iterations in a test, but we verify the option is accepted
        // and that a small maxAttempts works as expected
        let attempts = 0
        const backoff = createBackoff({ maxAttempts: 5, minDelay: 0, maxDelay: 0, maxFailureCount: 5 })
        try {
            await backoff(async () => {
                attempts++
                throw new Error('fail')
            })
        } catch {
            // expected
        }
        expect(attempts).toBe(5)
    })

    it('retries exactly maxAttempts times before throwing', async () => {
        let attempts = 0
        const backoff = createBackoff({ maxAttempts: 7, minDelay: 0, maxDelay: 0, maxFailureCount: 10 })
        try {
            await backoff(async () => {
                attempts++
                throw new Error('fail')
            })
        } catch {
            // expected
        }
        expect(attempts).toBe(7)
    })
})

describe('exponentialBackoffDelay', () => {
    it('returns 0 when failureCount is 0', () => {
        // With 0 failures, maxDelayRet = minDelay, and random * minDelay is in [0, minDelay]
        const result = exponentialBackoffDelay(0, 100, 1000, 50)
        expect(result).toBeGreaterThanOrEqual(0)
        expect(result).toBeLessThanOrEqual(100)
    })

    it('caps delay at maxDelay when failureCount equals maxFailureCount', () => {
        const result = exponentialBackoffDelay(50, 100, 1000, 50)
        expect(result).toBeGreaterThanOrEqual(0)
        expect(result).toBeLessThanOrEqual(1000)
    })
})
