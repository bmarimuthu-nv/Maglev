import { beforeEach, describe, expect, it } from 'vitest'
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
    let rpc: RpcHandlerManager

    beforeEach(async () => {
        if (rootDir) {
            await rm(rootDir, { recursive: true, force: true })
        }

        rootDir = await createTempDir('maglev-file-handler')
        await mkdir(join(rootDir, 'src'), { recursive: true })
        await writeFile(join(rootDir, 'src', 'example.ts'), 'const value = 1\n', 'utf8')

        rpc = new RpcHandlerManager({ scopePrefix: 'session-test' })
        registerFileHandlers(rpc, rootDir)
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
})
