import { describe, expect, it } from 'bun:test'

// Test the generateOwnerId logic directly (extracted to avoid filesystem side effects)
function generateOwnerId(bytes: Uint8Array): number {
    let value = 0
    for (const byte of bytes) {
        value = value * 256 + byte
    }
    return value > 0 ? value : 1
}

describe('generateOwnerId', () => {
    it('produces correct value for known bytes', () => {
        // 0x01 0x02 0x03 0x04 0x05 0x06
        // = 1*256^5 + 2*256^4 + 3*256^3 + 4*256^2 + 5*256 + 6
        // = 1099511627776 + 8589934592 + 50331648 + 262144 + 1280 + 6
        // = 1108152157446
        const bytes = new Uint8Array([1, 2, 3, 4, 5, 6])
        expect(generateOwnerId(bytes)).toBe(1108152157446)
    })

    it('produces positive value for all 0xFF bytes', () => {
        // 0xFF * 6 bytes = 2^48 - 1 = 281474976710655
        const bytes = new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF])
        const result = generateOwnerId(bytes)
        expect(result).toBe(281474976710655)
        expect(result).toBeGreaterThan(0)
    })

    it('never produces negative values (the old bitshift bug)', () => {
        // With bitshift, bytes like [0x80, 0, 0, 0, 0, 0] would produce negative
        // because bit 31 would be set causing sign extension
        const bytes = new Uint8Array([0x80, 0, 0, 0, 0, 0])
        const result = generateOwnerId(bytes)
        expect(result).toBeGreaterThan(0)
    })

    it('handles high byte values that caused overflow with bitshift', () => {
        // The 5th byte (index 4) at position 5 would shift by 40 bits,
        // exceeding 32-bit signed integer range
        const bytes = new Uint8Array([0xFF, 0, 0, 0, 0, 0])
        const result = generateOwnerId(bytes)
        // 0xFF * 256^5 = 255 * 1099511627776 = 280375465082880
        expect(result).toBe(280375465082880)
        expect(Number.isSafeInteger(result)).toBe(true)
    })

    it('returns 1 for all-zero bytes', () => {
        const bytes = new Uint8Array([0, 0, 0, 0, 0, 0])
        expect(generateOwnerId(bytes)).toBe(1)
    })

    it('result is always a safe integer', () => {
        // Max possible value is 2^48 - 1 = 281474976710655 which is < Number.MAX_SAFE_INTEGER
        const bytes = new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF])
        expect(Number.isSafeInteger(generateOwnerId(bytes))).toBe(true)
    })
})
