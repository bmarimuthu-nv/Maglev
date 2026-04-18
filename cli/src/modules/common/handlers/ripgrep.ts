import { logger } from '@/ui/logger'
import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'
import { run as runRipgrep } from '@/modules/ripgrep/index'
import { readdir } from 'fs/promises'
import { join, relative, resolve } from 'path'
import { validatePath } from '../pathSecurity'
import { getErrorMessage, rpcError } from '../rpcResponses'

interface RipgrepRequest {
    args: string[]
    cwd?: string
    limit?: number
}

interface RipgrepResponse {
    success: boolean
    exitCode?: number
    stdout?: string
    stderr?: string
    error?: string
}

function globToRegExp(glob: string): RegExp {
    const escaped = glob
        .replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
        .replace(/\*/g, '.*')
    return new RegExp(`^${escaped}$`, 'i')
}

function parseFileListFallbackArgs(args: string[]): { glob?: RegExp } | null {
    if (!args.includes('--files')) {
        return null
    }

    let glob: RegExp | undefined
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index]
        if (arg === '--files') {
            continue
        }
        if (arg === '--iglob') {
            const value = args[index + 1]
            if (!value) {
                return null
            }
            glob = globToRegExp(value)
            index += 1
            continue
        }
        return null
    }

    return { glob }
}

async function walkFiles(rootDir: string, currentDir: string, glob?: RegExp, limit: number = Number.POSITIVE_INFINITY): Promise<string[]> {
    const entries = await readdir(currentDir, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    const files: string[] = []

    for (const entry of entries) {
        if (files.length >= limit) {
            break
        }

        if (entry.name.startsWith('.')) {
            continue
        }

        const fullPath = join(currentDir, entry.name)
        if (entry.isSymbolicLink()) {
            continue
        }
        if (entry.isDirectory()) {
            files.push(...await walkFiles(rootDir, fullPath, glob, limit - files.length))
            continue
        }
        if (!entry.isFile()) {
            continue
        }

        const relativePath = relative(rootDir, fullPath).split('\\').join('/')
        if (glob && !glob.test(relativePath)) {
            continue
        }
        files.push(relativePath)
    }

    files.sort((left, right) => left.localeCompare(right))
    return files
}

async function runFileListFallback(
    args: string[],
    cwd: string | undefined,
    workingDirectory: string,
    limit?: number
): Promise<RipgrepResponse | null> {
    const parsed = parseFileListFallbackArgs(args)
    if (!parsed) {
        return null
    }

    const rootDir = cwd ? resolve(cwd) : resolve(workingDirectory)
    const maxResults = typeof limit === 'number' && Number.isFinite(limit) && limit > 0
        ? Math.floor(limit)
        : Number.POSITIVE_INFINITY
    const files = await walkFiles(rootDir, rootDir, parsed.glob, maxResults)
    return {
        success: true,
        exitCode: 0,
        stdout: files.join('\n'),
        stderr: ''
    }
}

/**
 * Validate ripgrep args to prevent path escapes beyond the working directory.
 * Rejects absolute path arguments that could read files outside the workspace.
 */
function validateRipgrepArgs(args: string[], workingDirectory: string): string | null {
    // Flags that accept a path as the next argument
    const pathFlags = new Set([
        '--file', '-f', '--ignore-file', '--pre', '--type-add',
        '--type-list', '--sort-files'
    ])
    for (let i = 0; i < args.length; i++) {
        const arg = args[i]
        // Reject absolute paths used as positional arguments (search paths)
        // These could escape the working directory
        if (arg.startsWith('/') && !arg.startsWith('--')) {
            const validation = validatePath(arg, workingDirectory)
            if (!validation.valid) {
                return `Path argument not allowed: ${arg}`
            }
        }
        // If a flag takes a path value, validate it
        if (pathFlags.has(arg) && i + 1 < args.length) {
            const value = args[i + 1]
            if (value.startsWith('/')) {
                const validation = validatePath(value, workingDirectory)
                if (!validation.valid) {
                    return `Path in ${arg} not allowed: ${value}`
                }
            }
            i++ // skip the value
        }
    }
    return null
}

export function registerRipgrepHandlers(rpcHandlerManager: RpcHandlerManager, workingDirectory: string): void {
    rpcHandlerManager.registerHandler<RipgrepRequest, RipgrepResponse>('ripgrep', async (data) => {
        logger.debug('Ripgrep request with args:', data.args, 'cwd:', data.cwd)

        if (data.cwd) {
            const validation = validatePath(data.cwd, workingDirectory)
            if (!validation.valid) {
                return rpcError(validation.error ?? 'Invalid working directory')
            }
        }

        const argsError = validateRipgrepArgs(data.args, workingDirectory)
        if (argsError) {
            return rpcError(argsError)
        }

        if (typeof data.limit === 'number' && Number.isFinite(data.limit) && data.limit > 0) {
            const boundedFileList = await runFileListFallback(data.args, data.cwd, workingDirectory, data.limit)
            if (boundedFileList) {
                logger.debug('Using bounded file-list mode for ripgrep request')
                return boundedFileList
            }
        }

        try {
            const result = await runRipgrep(data.args, { cwd: data.cwd })
            return {
                success: true,
                exitCode: result.exitCode,
                stdout: result.stdout.toString(),
                stderr: result.stderr.toString()
            }
        } catch (error) {
            const message = getErrorMessage(error, 'Failed to run ripgrep')
            if (message.toLowerCase().includes('ripgrep not found')) {
                try {
                    const fallback = await runFileListFallback(data.args, data.cwd, workingDirectory, data.limit)
                    if (fallback) {
                        logger.debug('Ripgrep not available; using recursive file-list fallback')
                        return fallback
                    }
                } catch (fallbackError) {
                    logger.debug('Ripgrep fallback failed:', fallbackError)
                }
            }
            logger.debug('Failed to run ripgrep:', error)
            return rpcError(message)
        }
    })
}
