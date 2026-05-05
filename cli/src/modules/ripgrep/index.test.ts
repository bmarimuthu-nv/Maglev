/**
 * Tests for low-level ripgrep wrapper
 */

import { describe, it, expect } from 'vitest'
import { run } from './index'
import { existsSync } from 'fs'
import { spawnSync } from 'child_process'
import { join } from 'path'
import { platform } from 'os'
import { runtimePath } from '@/projectPath'

function isRipgrepAvailable(): boolean {
    const binaryName = platform() === 'win32' ? 'rg.exe' : 'rg'
    const configuredPath = process.env.MAGLEV_RIPGREP_PATH?.trim()
    const bundledPath = join(runtimePath(), 'tools', 'unpacked', binaryName)
    const command = configuredPath || (existsSync(bundledPath)
        ? bundledPath
        : binaryName)
    const result = spawnSync(command, ['--version'], { stdio: 'ignore', env: process.env })
    return !result.error && result.status === 0
}

const describeIfRipgrepAvailable = isRipgrepAvailable() ? describe : describe.skip

describeIfRipgrepAvailable('ripgrep low-level wrapper', () => {
    it('should get version', async () => {
        const result = await run(['--version'])
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('ripgrep')
    })
    
    it('should search for pattern', async () => {
        const result = await run(['describe', 'src/modules/ripgrep/index.test.ts'])
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('describe')
    })
    
    it('should return exit code 1 for no matches', async () => {
        const result = await run(['ThisPatternShouldNeverMatch999', 'package.json'])
        expect(result.exitCode).toBe(1)
        expect(result.stdout).toBe('')
    })
    
    it('should handle JSON output', async () => {
        const result = await run(['--json', 'describe', 'src/modules/ripgrep/index.test.ts'])
        expect(result.exitCode).toBe(0)
        
        // Parse first line to check it's valid JSON
        const lines = result.stdout.trim().split('\n')
        const firstLine = JSON.parse(lines[0])
        expect(firstLine).toHaveProperty('type')
    })
    
    it('should respect custom working directory', async () => {
        const result = await run(['describe', 'index.test.ts'], { cwd: 'src/modules/ripgrep' })
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('describe')
    })
})
