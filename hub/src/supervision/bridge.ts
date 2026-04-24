import { chmod, mkdir, readFile, rm, stat, writeFile } from 'fs/promises'
import { dirname, join, resolve } from 'path'

export const TERMINAL_SUPERVISION_FOLDER = '.maglev-supervision'

export type TerminalSupervisionBridgeLocation = {
    workspaceRoot: string
    bridgeDir: string
    transcriptFilePath: string
    helperScriptPath: string
    stateFilePath: string
    readmePath: string
    storageScope: 'git-excluded' | 'workspace'
}

type GitWorkspaceContext = {
    workspaceRoot: string
    gitDir: string
}

type BridgeSnapshot = {
    outputBuffer: string
    status: 'ready' | 'exited'
    updatedAt: number
    exitInfo: { code: number | null; signal: string | null } | null
} | null

async function tryStat(path: string) {
    try {
        return await stat(path)
    } catch (error) {
        const nodeError = error as NodeJS.ErrnoException
        if (nodeError.code === 'ENOENT') {
            return null
        }
        throw error
    }
}

async function tryReadUtf8(path: string): Promise<string | null> {
    try {
        return await readFile(path, 'utf8')
    } catch (error) {
        const nodeError = error as NodeJS.ErrnoException
        if (nodeError.code === 'ENOENT') {
            return null
        }
        throw error
    }
}

async function findGitWorkspaceContext(workspacePath: string): Promise<GitWorkspaceContext | null> {
    let current = resolve(workspacePath)

    while (true) {
        const gitMarkerPath = join(current, '.git')
        const gitMarkerStats = await tryStat(gitMarkerPath)
        if (gitMarkerStats?.isDirectory()) {
            return {
                workspaceRoot: current,
                gitDir: gitMarkerPath
            }
        }
        if (gitMarkerStats?.isFile()) {
            const pointer = await readFile(gitMarkerPath, 'utf8')
            const match = pointer.match(/^gitdir:\s*(.+)\s*$/m)
            if (match?.[1]) {
                return {
                    workspaceRoot: current,
                    gitDir: resolve(current, match[1].trim())
                }
            }
        }

        const parent = dirname(current)
        if (parent === current) {
            return null
        }
        current = parent
    }
}

async function ensureGitExcluded(gitDir: string): Promise<void> {
    const infoExcludePath = join(gitDir, 'info', 'exclude')
    const entry = `${TERMINAL_SUPERVISION_FOLDER}/`
    const existing = await tryReadUtf8(infoExcludePath)
    if (existing?.split(/\r?\n/).includes(entry)) {
        return
    }

    await mkdir(dirname(infoExcludePath), { recursive: true })
    const prefix = existing && existing.length > 0 && !existing.endsWith('\n') ? '\n' : ''
    await writeFile(infoExcludePath, `${existing ?? ''}${prefix}${entry}\n`, 'utf8')
}

function sanitizeSessionComponent(sessionId: string): string {
    return sessionId.replace(/[^a-zA-Z0-9._-]+/g, '-')
}

export async function resolveTerminalSupervisionBridgeLocation(
    workspacePath: string,
    supervisorSessionId: string
): Promise<TerminalSupervisionBridgeLocation> {
    const gitWorkspace = await findGitWorkspaceContext(workspacePath)
    if (gitWorkspace) {
        await ensureGitExcluded(gitWorkspace.gitDir)
    }

    const workspaceRoot = gitWorkspace?.workspaceRoot ?? resolve(workspacePath)
    const bridgeDir = join(workspaceRoot, TERMINAL_SUPERVISION_FOLDER, sanitizeSessionComponent(supervisorSessionId))
    return {
        workspaceRoot,
        bridgeDir,
        transcriptFilePath: join(bridgeDir, 'worker-terminal.log'),
        helperScriptPath: join(bridgeDir, 'send-to-worker.sh'),
        stateFilePath: join(bridgeDir, 'worker-terminal.json'),
        readmePath: join(bridgeDir, 'README.txt'),
        storageScope: gitWorkspace ? 'git-excluded' : 'workspace'
    }
}

export async function writeTerminalSupervisionBridge(
    location: TerminalSupervisionBridgeLocation,
    options: {
        supervisorSessionId: string
        workerSessionId: string
        supervisionState: 'active' | 'paused'
        workerTerminalId: string | null
        snapshot: BridgeSnapshot
    }
): Promise<void> {
    await mkdir(location.bridgeDir, { recursive: true })

    const transcript = options.snapshot?.outputBuffer ?? ''
    await writeFile(location.transcriptFilePath, transcript, 'utf8')

    const statusPayload = {
        version: 1,
        workerSessionId: options.workerSessionId,
        supervisorSessionId: options.supervisorSessionId,
        supervisionState: options.supervisionState,
        workerTerminalId: options.workerTerminalId,
        updatedAt: options.snapshot?.updatedAt ?? Date.now(),
        terminalStatus: options.snapshot?.status ?? 'missing',
        exitInfo: options.snapshot?.exitInfo ?? null,
        transcriptFilePath: location.transcriptFilePath
    }
    await writeFile(location.stateFilePath, `${JSON.stringify(statusPayload, null, 2)}\n`, 'utf8')

    const helperScript = [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        '',
        'if [ "$#" -eq 0 ]; then',
        '    echo "Usage: send-to-worker.sh <command ...>" >&2',
        '    exit 1',
        'fi',
        '',
        `exec maglev supervisor send --session ${JSON.stringify(options.supervisorSessionId)} -- "$@"`,
        ''
    ].join('\n')
    await writeFile(location.helperScriptPath, helperScript, 'utf8')
    await chmod(location.helperScriptPath, 0o755)

    const readme = [
        'Maglev worker/supervisor bridge',
        '',
        `Worker terminal transcript: ${location.transcriptFilePath}`,
        `Bridge state file: ${location.stateFilePath}`,
        `Helper command: ${location.helperScriptPath}`,
        '',
        'The transcript file is refreshed from the worker terminal output captured by the hub.',
        'Use the helper command to send input back to the worker shell through the hub.',
        ''
    ].join('\n')
    await writeFile(location.readmePath, readme, 'utf8')
}

export async function clearTerminalSupervisionBridge(location: TerminalSupervisionBridgeLocation): Promise<void> {
    await rm(location.bridgeDir, { recursive: true, force: true })
}
