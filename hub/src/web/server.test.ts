import { describe, expect, it } from 'bun:test'
import { join, resolve } from 'node:path'

// Extract the path traversal logic to test it directly
function resolveStaticAssetPath(distDir: string, requestPath: string): string | null {
    const normalizedPath = requestPath.replace(/^\/+/, '')
    if (!normalizedPath) {
        return null
    }
    const assetPath = join(distDir, normalizedPath)
    const resolvedDistDir = resolve(distDir)
    const resolvedAssetPath = resolve(assetPath)
    if (!resolvedAssetPath.startsWith(resolvedDistDir + '/') && resolvedAssetPath !== resolvedDistDir) {
        return null
    }
    // Skip existsSync check for unit testing — just return the resolved path
    return resolvedAssetPath
}

describe('resolveStaticAssetPath', () => {
    const distDir = '/app/dist'

    it('resolves a normal asset path', () => {
        const result = resolveStaticAssetPath(distDir, '/assets/main.js')
        expect(result).toBe('/app/dist/assets/main.js')
    })

    it('rejects path traversal with ../', () => {
        const result = resolveStaticAssetPath(distDir, '/../../../etc/passwd')
        expect(result).toBeNull()
    })

    it('rejects encoded path traversal', () => {
        const result = resolveStaticAssetPath(distDir, '/assets/../../etc/passwd')
        expect(result).toBeNull()
    })

    it('returns null for empty path', () => {
        const result = resolveStaticAssetPath(distDir, '/')
        expect(result).toBeNull()
    })

    it('allows nested paths within distDir', () => {
        const result = resolveStaticAssetPath(distDir, '/assets/css/style.css')
        expect(result).toBe('/app/dist/assets/css/style.css')
    })

    it('rejects path that starts with distDir as prefix but escapes', () => {
        // /app/dist-evil/malicious.js should not pass if distDir is /app/dist
        const result = resolveStaticAssetPath(distDir, '/../dist-evil/malicious.js')
        expect(result).toBeNull()
    })
})
