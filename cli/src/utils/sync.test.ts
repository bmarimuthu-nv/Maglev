import { describe, expect, it, vi } from 'vitest'
import { InvalidateSync } from './sync'

// Mock the backoff to use no delays
vi.mock('@/utils/time', () => ({
    backoff: async <T>(callback: () => Promise<T>): Promise<T> => {
        let attempts = 0
        const maxAttempts = 5
        while (true) {
            try {
                return await callback()
            } catch (e) {
                attempts++
                if (attempts >= maxAttempts) {
                    throw e
                }
            }
        }
    }
}))

describe('InvalidateSync', () => {
    it('calls command once on invalidate', async () => {
        let callCount = 0
        const sync = new InvalidateSync(async () => { callCount++ })
        await sync.invalidateAndAwait()
        expect(callCount).toBe(1)
    })

    it('does not call command after stop', async () => {
        let callCount = 0
        const sync = new InvalidateSync(async () => { callCount++ })
        sync.stop()
        sync.invalidate()
        // Give microtasks a chance to run
        await new Promise(resolve => setTimeout(resolve, 10))
        expect(callCount).toBe(0)
    })

    it('resolves pending awaiters when backoff exhausts retries', async () => {
        const sync = new InvalidateSync(async () => {
            throw new Error('always fails')
        })
        // This should resolve (not hang) even though the command always fails
        await sync.invalidateAndAwait()
        // If we get here, the pending promise was resolved correctly
    })

    it('coalesces rapid invalidations', async () => {
        let callCount = 0
        let resolveFirst: () => void
        const firstCall = new Promise<void>(r => { resolveFirst = r })

        const sync = new InvalidateSync(async () => {
            callCount++
            if (callCount === 1) {
                await firstCall
            }
        })

        sync.invalidate()
        sync.invalidate()
        sync.invalidate()

        // Release the first call
        resolveFirst!()
        await new Promise(resolve => setTimeout(resolve, 20))

        // Should have been called at most twice (first + one coalesced re-sync)
        expect(callCount).toBeLessThanOrEqual(2)
    })
})
