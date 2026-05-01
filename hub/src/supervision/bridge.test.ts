import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, readFile, rm, stat } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import {
    clearTerminalSupervisionBridge,
    resolveTerminalSupervisionBridgeLocation,
    writeTerminalSupervisionBridge
} from './bridge'

describe('terminal supervision bridge', () => {
    const cleanupPaths: string[] = []

    afterEach(async () => {
        while (cleanupPaths.length > 0) {
            const path = cleanupPaths.pop()
            if (!path) {
                continue
            }
            await rm(path, { recursive: true, force: true })
        }
    })

    it('stores the bridge in a git-excluded folder when the workspace is in a repo', async () => {
        const root = await mkdtemp(join(tmpdir(), 'maglev-bridge-git-'))
        cleanupPaths.push(root)
        const workspace = join(root, 'workspace')
        const gitDir = join(workspace, '.git')
        await Bun.write(join(gitDir, 'placeholder'), '')
        await Bun.write(join(gitDir, 'info', 'exclude'), '# existing\n')

        const location = await resolveTerminalSupervisionBridgeLocation(workspace, 'supervisor:1')

        expect(location.storageScope).toBe('git-excluded')
        expect(location.bridgeDir.endsWith('.maglev-supervision/supervisor-1')).toBe(true)

        const exclude = await readFile(join(gitDir, 'info', 'exclude'), 'utf8')
        expect(exclude).toContain('.maglev-supervision/')
    })

    it('writes transcript, state, helper script, and clears them again', async () => {
        const workspace = await mkdtemp(join(tmpdir(), 'maglev-bridge-workspace-'))
        cleanupPaths.push(workspace)
        const location = await resolveTerminalSupervisionBridgeLocation(workspace, 'supervisor-bridge')

        await writeTerminalSupervisionBridge(location, {
            supervisorSessionId: 'supervisor-bridge',
            workerSessionId: 'worker-1',
            supervisionState: 'active',
            workerTerminalId: 'terminal:worker',
            snapshot: {
                outputBuffer: 'worker output\n',
                status: 'ready',
                updatedAt: 123,
                exitInfo: null
            }
        })

        expect(await readFile(location.transcriptFilePath, 'utf8')).toBe('worker output\n')
        const state = JSON.parse(await readFile(location.stateFilePath, 'utf8')) as Record<string, unknown>
        expect(state.supervisorSessionId).toBe('supervisor-bridge')
        expect(state.workerSessionId).toBe('worker-1')
        expect(state.supervisionState).toBe('active')
        expect(state.terminalStatus).toBe('ready')
        expect(await readFile(location.helperScriptPath, 'utf8')).toContain('maglev supervisor send --session "supervisor-bridge" -- "$@"')
        expect(await readFile(location.readmePath, 'utf8')).toContain('Worker terminal transcript')

        await clearTerminalSupervisionBridge(location)
        expect(await stat(location.bridgeDir).catch(() => null)).toBeNull()
    })
})
