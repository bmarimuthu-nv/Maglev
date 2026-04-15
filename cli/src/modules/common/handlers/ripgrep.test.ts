import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { mkdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { RpcHandlerManager } from '../../../api/rpc/RpcHandlerManager'
import { registerRipgrepHandlers } from './ripgrep'

async function createTempDir(prefix: string): Promise<string> {
    const base = tmpdir()
    const path = join(base, `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    await mkdir(path, { recursive: true })
    return path
}

describe('ripgrep RPC handler', () => {
    let rootDir: string
    let rpc: RpcHandlerManager
    let previousRipgrepPath: string | undefined

    beforeEach(async () => {
        previousRipgrepPath = process.env.MAGLEV_RIPGREP_PATH
        rootDir = await createTempDir('maglev-rg-handler')
        await mkdir(join(rootDir, 'src', 'nested'), { recursive: true })
        await writeFile(join(rootDir, 'src', 'index.ts'), 'console.log("ok")')
        await writeFile(join(rootDir, 'src', 'nested', 'helper.ts'), 'export const value = 1')
        await writeFile(join(rootDir, 'README.md'), '# test')

        rpc = new RpcHandlerManager({ scopePrefix: 'session-test' })
        registerRipgrepHandlers(rpc, rootDir)
    })

    afterEach(async () => {
        if (previousRipgrepPath === undefined) {
            delete process.env.MAGLEV_RIPGREP_PATH
        } else {
            process.env.MAGLEV_RIPGREP_PATH = previousRipgrepPath
        }
        if (rootDir) {
            await rm(rootDir, { recursive: true, force: true })
        }
    })

    it('falls back to recursive file listing when rg is unavailable', async () => {
        process.env.MAGLEV_RIPGREP_PATH = join(rootDir, 'missing-rg')

        const response = await rpc.handleRequest({
            method: 'session-test:ripgrep',
            params: JSON.stringify({ args: ['--files'], cwd: rootDir })
        })

        const parsed = JSON.parse(response) as { success: boolean; stdout?: string }
        expect(parsed.success).toBe(true)
        expect(parsed.stdout?.split('\n')).toEqual([
            'README.md',
            'src/index.ts',
            'src/nested/helper.ts'
        ])
    })

    it('applies iglob filtering in fallback mode', async () => {
        process.env.MAGLEV_RIPGREP_PATH = join(rootDir, 'missing-rg')

        const response = await rpc.handleRequest({
            method: 'session-test:ripgrep',
            params: JSON.stringify({ args: ['--files', '--iglob', '*helper*'], cwd: rootDir })
        })

        const parsed = JSON.parse(response) as { success: boolean; stdout?: string }
        expect(parsed.success).toBe(true)
        expect(parsed.stdout).toBe('src/nested/helper.ts')
    })

    it('bounds file-list responses before returning them over RPC', async () => {
        const response = await rpc.handleRequest({
            method: 'session-test:ripgrep',
            params: JSON.stringify({ args: ['--files'], cwd: rootDir, limit: 2 })
        })

        const parsed = JSON.parse(response) as { success: boolean; stdout?: string }
        expect(parsed.success).toBe(true)
        expect(parsed.stdout?.split('\n')).toEqual([
            'README.md',
            'src/index.ts'
        ])
    })
})
