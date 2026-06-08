import { logger } from '@/ui/logger'
import { mkdir, readFile, stat, writeFile } from 'fs/promises'
import { createHash } from 'crypto'
import { dirname, isAbsolute, resolve } from 'path'
import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'
import { validatePath } from '../pathSecurity'
import { getErrorMessage, rpcError } from '../rpcResponses'

interface ReadFileRequest {
    path: string
}

interface ReadFileResponse {
    success: boolean
    content?: string
    hash?: string
    error?: string
}

interface WriteFileRequest {
    path: string
    content: string
    expectedHash?: string | null
}

interface WriteFileConflict {
    type: 'hash_mismatch' | 'missing_file' | 'already_exists'
    expectedHash: string | null
    currentHash: string | null
    currentContent: string | null
}

interface WriteFileResponse {
    success: boolean
    hash?: string
    error?: string
    conflict?: WriteFileConflict
}

function hashBuffer(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex')
}

function resolveReadablePath(targetPath: string, workingDirectory: string): { path: string } | { error: string } {
    if (isAbsolute(targetPath)) {
        return { path: targetPath }
    }

    const validation = validatePath(targetPath, workingDirectory)
    if (!validation.valid) {
        return { error: validation.error ?? 'Invalid file path' }
    }

    return { path: resolve(workingDirectory, targetPath) }
}

function getReadFileErrorMessage(error: unknown, filePath: string): string {
    const nodeError = error as NodeJS.ErrnoException
    switch (nodeError.code) {
        case 'ENOENT':
        case 'ENOTDIR':
            return `File does not exist: ${filePath}`
        case 'EISDIR':
            return `Path is a directory, not a file: ${filePath}`
        case 'EACCES':
        case 'EPERM':
            return `File is not accessible: ${filePath}`
        default:
            return getErrorMessage(error, 'Failed to read file')
    }
}

export function registerFileHandlers(rpcHandlerManager: RpcHandlerManager, workingDirectory: string): void {
    rpcHandlerManager.registerHandler<ReadFileRequest, ReadFileResponse>('readFile', async (data) => {
        logger.debug('Read file request:', data.path)

        const resolved = resolveReadablePath(data.path, workingDirectory)
        if ('error' in resolved) {
            return rpcError(resolved.error)
        }

        try {
            const buffer = await readFile(resolved.path)
            const content = buffer.toString('base64')
            const hash = hashBuffer(buffer)
            return { success: true, content, hash }
        } catch (error) {
            logger.debug('Failed to read file:', error)
            return rpcError(getReadFileErrorMessage(error, resolved.path))
        }
    })

    rpcHandlerManager.registerHandler<WriteFileRequest, WriteFileResponse>('writeFile', async (data) => {
        logger.debug('Write file request:', data.path)

        const validation = validatePath(data.path, workingDirectory)
        if (!validation.valid) {
            return rpcError(validation.error ?? 'Invalid file path')
        }

        try {
            const resolvedPath = resolve(workingDirectory, data.path)
            if (data.expectedHash !== null && data.expectedHash !== undefined) {
                try {
                    const existingBuffer = await readFile(resolvedPath)
                    const existingHash = hashBuffer(existingBuffer)

                    if (existingHash !== data.expectedHash) {
                        return rpcError('File changed on disk since this preview was loaded', {
                            conflict: {
                                type: 'hash_mismatch' as const,
                                expectedHash: data.expectedHash,
                                currentHash: existingHash,
                                currentContent: existingBuffer.toString('base64')
                            }
                        })
                    }
                } catch (error) {
                    const nodeError = error as NodeJS.ErrnoException
                    if (nodeError.code !== 'ENOENT') {
                        throw error
                    }
                    return rpcError('File was deleted since this preview was loaded', {
                        conflict: {
                            type: 'missing_file' as const,
                            expectedHash: data.expectedHash,
                            currentHash: null,
                            currentContent: null
                        }
                    })
                }
            } else {
                try {
                    await stat(resolvedPath)
                    const existingBuffer = await readFile(resolvedPath)
                    return rpcError('File already exists and cannot be created as new', {
                        conflict: {
                            type: 'already_exists' as const,
                            expectedHash: null,
                            currentHash: hashBuffer(existingBuffer),
                            currentContent: existingBuffer.toString('base64')
                        }
                    })
                } catch (error) {
                    const nodeError = error as NodeJS.ErrnoException
                    if (nodeError.code !== 'ENOENT') {
                        throw error
                    }
                }
            }

            const buffer = Buffer.from(data.content, 'base64')
            await mkdir(dirname(resolvedPath), { recursive: true })
            await writeFile(resolvedPath, buffer)

            const hash = hashBuffer(buffer)

            return { success: true, hash }
        } catch (error) {
            logger.debug('Failed to write file:', error)
            return rpcError(getErrorMessage(error, 'Failed to write file'))
        }
    })
}
