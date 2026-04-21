import { execFile, type ExecFileOptions } from 'child_process'
import { promisify } from 'util'
import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'
import { validatePath } from '../pathSecurity'
import { rpcError } from '../rpcResponses'

const execFileAsync = promisify(execFile)

interface GitStatusRequest {
    cwd?: string
    timeout?: number
}

interface GitDiffNumstatRequest {
    cwd?: string
    staged?: boolean
    timeout?: number
}

interface GitDiffFileRequest {
    cwd?: string
    filePath: string
    staged?: boolean
    timeout?: number
}

type GitReviewMode = 'branch' | 'working'
type GitReviewBaseMode = 'origin' | 'upstream' | 'fork-point'

interface GitReviewSummaryRequest {
    cwd?: string
    mode: GitReviewMode
    baseMode?: GitReviewBaseMode
    timeout?: number
}

interface GitReviewFileRequest {
    cwd?: string
    mode: GitReviewMode
    baseMode?: GitReviewBaseMode
    filePath: string
    timeout?: number
}

interface GitCommandResponse {
    success: boolean
    stdout?: string
    stderr?: string
    exitCode?: number
    error?: string
}

interface GitReviewSummaryFile {
    filePath: string
    added: number | null
    removed: number | null
    binary?: boolean
    oldPath?: string
}

interface GitReviewSummaryResponse {
    success: boolean
    mode?: GitReviewMode
    baseMode?: GitReviewBaseMode
    currentBranch?: string | null
    defaultBranch?: string | null
    mergeBase?: string | null
    files?: GitReviewSummaryFile[]
    error?: string
}

function resolveCwd(requestedCwd: string | undefined, workingDirectory: string): { cwd: string; error?: string } {
    const cwd = requestedCwd ?? workingDirectory
    const validation = validatePath(cwd, workingDirectory)
    if (!validation.valid) {
        return { cwd, error: validation.error ?? 'Invalid working directory' }
    }
    return { cwd }
}

function validateFilePath(filePath: string, workingDirectory: string): string | null {
    const validation = validatePath(filePath, workingDirectory)
    if (!validation.valid) {
        return validation.error ?? 'Invalid file path'
    }
    return null
}

async function runGitCommand(
    args: string[],
    cwd: string,
    timeout?: number
): Promise<GitCommandResponse> {
    try {
        const options: ExecFileOptions = {
            cwd,
            timeout: timeout ?? 10_000
        }
        const { stdout, stderr } = await execFileAsync('git', args, options)
        return {
            success: true,
            stdout: stdout ? stdout.toString() : '',
            stderr: stderr ? stderr.toString() : '',
            exitCode: 0
        }
    } catch (error) {
        const execError = error as NodeJS.ErrnoException & {
            stdout?: string
            stderr?: string
            code?: number | string
            killed?: boolean
        }

        if (execError.code === 'ETIMEDOUT' || execError.killed) {
            return rpcError('Command timed out', {
                stdout: execError.stdout ? execError.stdout.toString() : '',
                stderr: execError.stderr ? execError.stderr.toString() : '',
                exitCode: typeof execError.code === 'number' ? execError.code : -1
            })
        }

        return rpcError(execError.message || 'Command failed', {
            stdout: execError.stdout ? execError.stdout.toString() : '',
            stderr: execError.stderr ? execError.stderr.toString() : execError.message || 'Command failed',
            exitCode: typeof execError.code === 'number' ? execError.code : 1
        })
    }
}

async function runGitText(args: string[], cwd: string, timeout?: number): Promise<string> {
    const result = await runGitCommand(args, cwd, timeout)
    if (!result.success) {
        throw new Error(result.error ?? result.stderr ?? 'Git command failed')
    }
    return (result.stdout ?? '').trim()
}

async function tryRunGitText(args: string[], cwd: string, timeout?: number): Promise<string | null> {
    try {
        const value = await runGitText(args, cwd, timeout)
        return value || null
    } catch {
        return null
    }
}

async function resolveRemoteDefaultBranch(remote: string, cwd: string, timeout?: number): Promise<string | null> {
    const symbolic = await tryRunGitText(['symbolic-ref', '--quiet', `refs/remotes/${remote}/HEAD`], cwd, timeout)
    if (symbolic) {
        return symbolic.replace(/^refs\/remotes\//, '')
    }

    const fallbacks = [`${remote}/main`, `${remote}/master`]
    for (const candidate of fallbacks) {
        const exists = await tryRunGitText(['rev-parse', '--verify', '--quiet', candidate], cwd, timeout)
        if (exists) {
            return candidate
        }
    }
    return null
}

async function resolveBranchUpstream(cwd: string, timeout?: number): Promise<string | null> {
    return await tryRunGitText(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], cwd, timeout)
}

async function resolveReviewBase(cwd: string, mode: GitReviewMode, timeout: number | undefined, baseMode: GitReviewBaseMode = 'origin'): Promise<{
    mode: GitReviewMode
    baseMode: GitReviewBaseMode
    currentBranch: string | null
    defaultBranch: string | null
    mergeBase: string | null
    rangeArgs: string[]
}> {
    const currentBranch = await tryRunGitText(['rev-parse', '--abbrev-ref', 'HEAD'], cwd, timeout)

    if (mode === 'working') {
        return {
            mode,
            baseMode,
            currentBranch,
            defaultBranch: null,
            mergeBase: null,
            rangeArgs: ['HEAD']
        }
    }

    if (baseMode === 'fork-point') {
        const upstreamRef = await resolveBranchUpstream(cwd, timeout)
            ?? await resolveRemoteDefaultBranch('origin', cwd, timeout)
        if (!upstreamRef) {
            throw new Error('Could not resolve branch upstream for fork-point diff')
        }

        const mergeBase = await tryRunGitText(['merge-base', '--fork-point', upstreamRef, 'HEAD'], cwd, timeout)
            ?? await runGitText(['merge-base', 'HEAD', upstreamRef], cwd, timeout)
        return {
            mode,
            baseMode,
            currentBranch,
            defaultBranch: upstreamRef,
            mergeBase,
            rangeArgs: [`${mergeBase}..HEAD`]
        }
    }

    const remote = baseMode === 'upstream' ? 'upstream' : 'origin'
    const defaultBranch = await resolveRemoteDefaultBranch(remote, cwd, timeout)
    if (!defaultBranch) {
        throw new Error(`Could not resolve ${remote} default branch`)
    }

    const mergeBase = await runGitText(['merge-base', 'HEAD', defaultBranch], cwd, timeout)
    return {
        mode,
        baseMode,
        currentBranch,
        defaultBranch,
        mergeBase,
        rangeArgs: [`${mergeBase}..HEAD`]
    }
}

function parseNumstat(stdout: string): GitReviewSummaryFile[] {
    return stdout
        .split('\n')
        .map((line) => line.trimEnd())
        .filter(Boolean)
        .map((line) => {
            const parts = line.split('\t')
            const addedRaw = parts[0] ?? ''
            const removedRaw = parts[1] ?? ''
            const paths = parts.slice(2)
            const filePath = paths[paths.length - 1] ?? ''
            const oldPath = paths.length > 1 ? paths[0] : undefined
            const added = addedRaw === '-' ? null : Number.parseInt(addedRaw, 10)
            const removed = removedRaw === '-' ? null : Number.parseInt(removedRaw, 10)
            return {
                filePath,
                oldPath,
                added: Number.isFinite(added) ? added : null,
                removed: Number.isFinite(removed) ? removed : null,
                binary: addedRaw === '-' || removedRaw === '-'
            }
        })
        .filter((file) => file.filePath.length > 0)
}

export function registerGitHandlers(rpcHandlerManager: RpcHandlerManager, workingDirectory: string): void {
    rpcHandlerManager.registerHandler<GitStatusRequest, GitCommandResponse>('git-status', async (data) => {
        const resolved = resolveCwd(data.cwd, workingDirectory)
        if (resolved.error) {
            return rpcError(resolved.error)
        }
        return await runGitCommand(
            ['status', '--porcelain=v2', '--branch', '--untracked-files=all'],
            resolved.cwd,
            data.timeout
        )
    })

    rpcHandlerManager.registerHandler<GitDiffNumstatRequest, GitCommandResponse>('git-diff-numstat', async (data) => {
        const resolved = resolveCwd(data.cwd, workingDirectory)
        if (resolved.error) {
            return rpcError(resolved.error)
        }
        const args = data.staged
            ? ['diff', '--cached', '--numstat']
            : ['diff', '--numstat']
        return await runGitCommand(args, resolved.cwd, data.timeout)
    })

    rpcHandlerManager.registerHandler<GitDiffFileRequest, GitCommandResponse>('git-diff-file', async (data) => {
        const resolved = resolveCwd(data.cwd, workingDirectory)
        if (resolved.error) {
            return rpcError(resolved.error)
        }
        const fileError = validateFilePath(data.filePath, workingDirectory)
        if (fileError) {
            return rpcError(fileError)
        }

        const args = data.staged
            ? ['diff', '--cached', '--no-ext-diff', '--', data.filePath]
            : ['diff', '--no-ext-diff', '--', data.filePath]
        return await runGitCommand(args, resolved.cwd, data.timeout)
    })

    rpcHandlerManager.registerHandler<GitReviewSummaryRequest, GitReviewSummaryResponse>('git-review-summary', async (data) => {
        const resolved = resolveCwd(data.cwd, workingDirectory)
        if (resolved.error) {
            return rpcError(resolved.error)
        }

        try {
            const base = await resolveReviewBase(resolved.cwd, data.mode, data.timeout, data.baseMode)
            const stdout = await runGitText(['diff', '--numstat', ...base.rangeArgs, '--'], resolved.cwd, data.timeout)
            return {
                success: true,
                mode: data.mode,
                baseMode: base.baseMode,
                currentBranch: base.currentBranch,
                defaultBranch: base.defaultBranch,
                mergeBase: base.mergeBase,
                files: parseNumstat(stdout)
            }
        } catch (error) {
            return rpcError(error instanceof Error ? error.message : 'Failed to build review summary')
        }
    })

    rpcHandlerManager.registerHandler<GitReviewFileRequest, GitCommandResponse>('git-review-file', async (data) => {
        const resolved = resolveCwd(data.cwd, workingDirectory)
        if (resolved.error) {
            return rpcError(resolved.error)
        }
        const fileError = validateFilePath(data.filePath, workingDirectory)
        if (fileError) {
            return rpcError(fileError)
        }

        try {
            const base = await resolveReviewBase(resolved.cwd, data.mode, data.timeout, data.baseMode)
            const args = ['diff', '--no-ext-diff', ...base.rangeArgs, '--', data.filePath]
            return await runGitCommand(args, resolved.cwd, data.timeout)
        } catch (error) {
            return rpcError(error instanceof Error ? error.message : 'Failed to load review diff')
        }
    })
}
