import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { createHash } from 'crypto'
import { RpcHandlerManager } from '../../../api/rpc/RpcHandlerManager'
import { registerFileHandlers } from './files'

async function createTempDir(prefix: string): Promise<string> {
    const path = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    await mkdir(path, { recursive: true })
    return path
}

function hashText(value: string): string {
    return createHash('sha256').update(Buffer.from(value, 'utf8')).digest('hex')
}

describe('file RPC handlers', () => {
    let rootDir: string
    let externalDir: string
    let rpc: RpcHandlerManager

    beforeEach(async () => {
        rootDir = await createTempDir('maglev-file-handler')
        externalDir = await createTempDir('maglev-file-handler-external')
        await mkdir(join(rootDir, 'src'), { recursive: true })
        await writeFile(join(rootDir, 'src', 'example.ts'), 'const value = 1\n', 'utf8')

        rpc = new RpcHandlerManager({ scopePrefix: 'session-test' })
        registerFileHandlers(rpc, rootDir)
    })

    afterEach(async () => {
        await rm(rootDir, { recursive: true, force: true })
        await rm(externalDir, { recursive: true, force: true })
    })

    it('returns structured conflict data for hash mismatches', async () => {
        const response = await rpc.handleRequest({
            method: 'session-test:writeFile',
            params: JSON.stringify({
                path: 'src/example.ts',
                content: Buffer.from('const value = 2\n', 'utf8').toString('base64'),
                expectedHash: 'stale-hash'
            })
        })

        const parsed = JSON.parse(response) as {
            success: boolean
            error?: string
            conflict?: {
                type: string
                expectedHash: string | null
                currentHash: string | null
                currentContent: string | null
            }
        }

        expect(parsed.success).toBe(false)
        expect(parsed.error).toBe('File changed on disk since this preview was loaded')
        expect(parsed.conflict).toEqual({
            type: 'hash_mismatch',
            expectedHash: 'stale-hash',
            currentHash: hashText('const value = 1\n'),
            currentContent: Buffer.from('const value = 1\n', 'utf8').toString('base64')
        })
    })

    it('allows overwriting once the latest hash is acknowledged', async () => {
        const currentHash = hashText('const value = 1\n')
        const response = await rpc.handleRequest({
            method: 'session-test:writeFile',
            params: JSON.stringify({
                path: 'src/example.ts',
                content: Buffer.from('const value = 3\n', 'utf8').toString('base64'),
                expectedHash: currentHash
            })
        })

        const parsed = JSON.parse(response) as { success: boolean; hash?: string }
        expect(parsed.success).toBe(true)
        expect(parsed.hash).toBe(hashText('const value = 3\n'))
        await expect(readFile(join(rootDir, 'src', 'example.ts'), 'utf8')).resolves.toBe('const value = 3\n')
    })

    it('reads an absolute file path outside the workspace when the user can access it', async () => {
        const absolutePath = join(externalDir, 'notes.txt')
        await writeFile(absolutePath, 'hello from outside workspace')

        const response = await rpc.handleRequest({
            method: 'session-test:readFile',
            params: JSON.stringify({ path: absolutePath })
        })

        const parsed = JSON.parse(response) as { success: boolean; content?: string; error?: string }
        expect(parsed.success).toBe(true)
        expect(Buffer.from(parsed.content ?? '', 'base64').toString('utf8')).toBe('hello from outside workspace')
        expect(parsed.error).toBeUndefined()
    })

    it('returns a clear error when an absolute file path does not exist', async () => {
        const missingPath = join(externalDir, 'missing.txt')

        const response = await rpc.handleRequest({
            method: 'session-test:readFile',
            params: JSON.stringify({ path: missingPath })
        })

        const parsed = JSON.parse(response) as { success: boolean; error?: string }
        expect(parsed.success).toBe(false)
        expect(parsed.error).toBe(`File does not exist: ${missingPath}`)
    })
})
