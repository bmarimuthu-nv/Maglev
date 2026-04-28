import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { __test__ } from './doctor'

describe('doctor first-run checks', () => {
    it('flags invalid settings.json content', async () => {
        const tempDir = await mkdtemp(join(tmpdir(), 'maglev-doctor-'))
        const settingsPath = join(tempDir, 'settings.json')
        await writeFile(settingsPath, '{not-json', 'utf8')

        const result = await __test__.inspectSettingsFile(settingsPath)

        expect(result.status).toBe('fail')
        expect(result.detail).toContain('Invalid JSON')
        expect(result.nextStep).toContain('Parse error')
    })

    it('accepts valid override paths for required tools', () => {
        const result = __test__.inspectRequiredTool('rg', 'MAGLEV_RIPGREP_PATH', {
            MAGLEV_RIPGREP_PATH: process.execPath
        })

        expect(result.status).toBe('pass')
        expect(result.detail).toContain('MAGLEV_RIPGREP_PATH')
    })

    it('reports missing tools when no override or PATH entry exists', () => {
        const result = __test__.inspectRequiredTool('difft', 'MAGLEV_DIFFTASTIC_PATH', {}, () => null)

        expect(result.status).toBe('fail')
        expect(result.detail).toContain('not on PATH')
        expect(result.nextStep).toContain('MAGLEV_DIFFTASTIC_PATH')
    })
})
