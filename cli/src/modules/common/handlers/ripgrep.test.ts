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

    it('supports question-mark wildcards in iglob fallback mode', async () => {
        process.env.MAGLEV_RIPGREP_PATH = join(rootDir, 'missing-rg')

        const response = await rpc.handleRequest({
            method: 'session-test:ripgrep',
            params: JSON.stringify({ args: ['--files', '--iglob', 'src/nested/helper.?s'], cwd: rootDir })
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

    it('rejects absolute path arguments outside working directory', async () => {
        const response = await rpc.handleRequest({
            method: 'session-test:ripgrep',
            params: JSON.stringify({ args: ['pattern', '/etc/passwd'] })
        })

        const parsed = JSON.parse(response) as { success: boolean; error?: string }
        expect(parsed.success).toBe(false)
        expect(parsed.error).toContain('/etc/passwd')
    })

    it('skips node_modules in fallback file listing', async () => {
        process.env.MAGLEV_RIPGREP_PATH = join(rootDir, 'missing-rg')
        await mkdir(join(rootDir, 'node_modules', 'pkg'), { recursive: true })
        await writeFile(join(rootDir, 'node_modules', 'pkg', 'index.js'), 'module.exports = {}')

        const response = await rpc.handleRequest({
            method: 'session-test:ripgrep',
            params: JSON.stringify({ args: ['--files'], cwd: rootDir, limit: 100 })
        })

        const parsed = JSON.parse(response) as { success: boolean; stdout?: string }
        expect(parsed.success).toBe(true)
        const files = parsed.stdout?.split('\n') ?? []
        expect(files.some(f => f.includes('node_modules'))).toBe(false)
    })

    it('skips common large directories in fallback mode', async () => {
        process.env.MAGLEV_RIPGREP_PATH = join(rootDir, 'missing-rg')
        for (const dir of ['dist', '__pycache__', '.venv', 'build']) {
            await mkdir(join(rootDir, dir), { recursive: true })
            await writeFile(join(rootDir, dir, 'file.txt'), 'data')
        }

        const response = await rpc.handleRequest({
            method: 'session-test:ripgrep',
            params: JSON.stringify({ args: ['--files'], cwd: rootDir, limit: 100 })
        })

        const parsed = JSON.parse(response) as { success: boolean; stdout?: string }
        expect(parsed.success).toBe(true)
        const files = parsed.stdout?.split('\n') ?? []
        expect(files.some(f => f.includes('dist/'))).toBe(false)
        expect(files.some(f => f.includes('__pycache__/'))).toBe(false)
        expect(files.some(f => f.includes('.venv/'))).toBe(false)
        expect(files.some(f => f.includes('build/'))).toBe(false)
    })

    it('handles unreadable directories gracefully in fallback mode', async () => {
        process.env.MAGLEV_RIPGREP_PATH = join(rootDir, 'missing-rg')

        const response = await rpc.handleRequest({
            method: 'session-test:ripgrep',
            params: JSON.stringify({ args: ['--files'], cwd: join(rootDir, 'nonexistent'), limit: 100 })
        })

        const parsed = JSON.parse(response) as { success: boolean; stdout?: string; error?: string }
        // Should not crash - returns empty or error gracefully
        expect(parsed.success).toBeDefined()
    })

    it('rejects --file flag with absolute path outside working directory', async () => {
        const response = await rpc.handleRequest({
            method: 'session-test:ripgrep',
            params: JSON.stringify({ args: ['--file', '/etc/shadow', 'pattern'] })
        })

        const parsed = JSON.parse(response) as { success: boolean; error?: string }
        expect(parsed.success).toBe(false)
        expect(parsed.error).toContain('/etc/shadow')
    })
})
