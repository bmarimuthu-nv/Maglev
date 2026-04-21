import { randomUUID } from 'crypto'
import { mkdir, readFile, stat, writeFile } from 'fs/promises'
import { dirname, join, resolve } from 'path'

export const FILE_REVIEW_STORE_FILE = 'file-threads.json'
export const FILE_REVIEW_GIT_FOLDER = 'maglev-review'
export const FILE_REVIEW_WORKSPACE_FOLDER = '.maglev-review'

export type FileReviewComment = {
    id: string
    author: 'user' | 'agent'
    createdAt: number
    body: string
}

export type FileReviewThreadAnchor = {
    line: number
    preview: string
    contextBefore: string[]
    contextAfter: string[]
}

export type FileReviewThread = {
    id: string
    filePath: string
    absolutePath: string
    createdAt: number
    updatedAt: number
    status: 'open' | 'resolved'
    anchor: FileReviewThreadAnchor
    comments: FileReviewComment[]
}

export type FileReviewStore = {
    version: 1
    workspacePath: string
    updatedAt: number
    threads: FileReviewThread[]
}

export type ResolvedFileReviewThread = FileReviewThread & {
    resolvedLine: number | null
    orphaned: boolean
}

export type FileReviewStoreLocation = {
    workspaceRoot: string
    storePath: string
    storageScope: 'git' | 'workspace'
}

const mutationQueues = new Map<string, Promise<unknown>>()

function isComment(value: unknown): value is FileReviewComment {
    if (!value || typeof value !== 'object') {
        return false
    }
    const candidate = value as Record<string, unknown>
    return typeof candidate.id === 'string'
        && (candidate.author === 'user' || candidate.author === 'agent')
        && typeof candidate.createdAt === 'number'
        && typeof candidate.body === 'string'
}

function isAnchor(value: unknown): value is FileReviewThreadAnchor {
    if (!value || typeof value !== 'object') {
        return false
    }
    const candidate = value as Record<string, unknown>
    return typeof candidate.line === 'number'
        && typeof candidate.preview === 'string'
        && Array.isArray(candidate.contextBefore)
        && candidate.contextBefore.every((entry) => typeof entry === 'string')
        && Array.isArray(candidate.contextAfter)
        && candidate.contextAfter.every((entry) => typeof entry === 'string')
}

function isThread(value: unknown): value is FileReviewThread {
    if (!value || typeof value !== 'object') {
        return false
    }
    const candidate = value as Record<string, unknown>
    return typeof candidate.id === 'string'
        && typeof candidate.filePath === 'string'
        && typeof candidate.absolutePath === 'string'
        && typeof candidate.createdAt === 'number'
        && typeof candidate.updatedAt === 'number'
        && (candidate.status === 'open' || candidate.status === 'resolved')
        && isAnchor(candidate.anchor)
        && Array.isArray(candidate.comments)
        && candidate.comments.every(isComment)
}

function isStore(value: unknown): value is FileReviewStore {
    if (!value || typeof value !== 'object') {
        return false
    }
    const candidate = value as Record<string, unknown>
    return candidate.version === 1
        && typeof candidate.workspacePath === 'string'
        && typeof candidate.updatedAt === 'number'
        && Array.isArray(candidate.threads)
        && candidate.threads.every(isThread)
}

function createEmptyStore(workspacePath: string): FileReviewStore {
    return {
        version: 1,
        workspacePath,
        updatedAt: Date.now(),
        threads: []
    }
}

function splitLines(content: string): string[] {
    return content.replace(/\r\n/g, '\n').split('\n')
}

function buildAnchor(lines: string[], line: number): FileReviewThreadAnchor {
    const lineIndex = Math.max(0, line - 1)
    return {
        line,
        preview: lines[lineIndex] ?? '',
        contextBefore: lines.slice(Math.max(0, lineIndex - 2), lineIndex),
        contextAfter: lines.slice(lineIndex + 1, Math.min(lines.length, lineIndex + 3))
    }
}

function scoreContextMatch(lines: string[], index: number, anchor: FileReviewThreadAnchor): number {
    let score = 0
    const beforeStart = index - anchor.contextBefore.length
    for (let i = 0; i < anchor.contextBefore.length; i += 1) {
        if (lines[beforeStart + i] === anchor.contextBefore[i]) {
            score += 2
        }
    }
    for (let i = 0; i < anchor.contextAfter.length; i += 1) {
        if (lines[index + 1 + i] === anchor.contextAfter[i]) {
            score += 2
        }
    }
    return score
}

function resolveThreadAnchor(thread: FileReviewThread, content: string | null): { resolvedLine: number | null; orphaned: boolean } {
    if (content === null) {
        return { resolvedLine: null, orphaned: true }
    }

    const lines = splitLines(content)
    const expectedIndex = Math.max(0, thread.anchor.line - 1)
    if (lines[expectedIndex] === thread.anchor.preview) {
        return { resolvedLine: thread.anchor.line, orphaned: false }
    }

    let bestIndex = -1
    let bestScore = -1

    for (let index = 0; index < lines.length; index += 1) {
        if (lines[index] !== thread.anchor.preview) {
            continue
        }
        const score = scoreContextMatch(lines, index, thread.anchor)
        const distance = Math.abs(index - expectedIndex)
        const bestDistance = bestIndex >= 0 ? Math.abs(bestIndex - expectedIndex) : Number.POSITIVE_INFINITY
        if (score > bestScore || (score === bestScore && distance < bestDistance)) {
            bestScore = score
            bestIndex = index
        }
    }

    if (bestIndex >= 0) {
        return { resolvedLine: bestIndex + 1, orphaned: false }
    }

    return { resolvedLine: null, orphaned: true }
}

async function exists(path: string): Promise<boolean> {
    try {
        await stat(path)
        return true
    } catch {
        return false
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

async function findGitStoreLocation(workspacePath: string): Promise<FileReviewStoreLocation | null> {
    let current = resolve(workspacePath)

    while (true) {
        const gitMarkerPath = join(current, '.git')
        try {
            const gitMarkerStats = await stat(gitMarkerPath)
            if (gitMarkerStats.isDirectory()) {
                return {
                    workspaceRoot: current,
                    storePath: join(gitMarkerPath, FILE_REVIEW_GIT_FOLDER, FILE_REVIEW_STORE_FILE),
                    storageScope: 'git'
                }
            }
            if (gitMarkerStats.isFile()) {
                const gitPointer = await readFile(gitMarkerPath, 'utf8')
                const match = gitPointer.match(/^gitdir:\s*(.+)\s*$/m)
                if (match?.[1]) {
                    const gitDir = resolve(current, match[1].trim())
                    return {
                        workspaceRoot: current,
                        storePath: join(gitDir, FILE_REVIEW_GIT_FOLDER, FILE_REVIEW_STORE_FILE),
                        storageScope: 'git'
                    }
                }
            }
        } catch (error) {
            const nodeError = error as NodeJS.ErrnoException
            if (nodeError.code !== 'ENOENT') {
                throw error
            }
        }

        const parent = dirname(current)
        if (parent === current) {
            return null
        }
        current = parent
    }
}

export async function resolveFileReviewStoreLocation(workspacePath: string): Promise<FileReviewStoreLocation> {
    const gitLocation = await findGitStoreLocation(workspacePath)
    if (gitLocation) {
        return gitLocation
    }

    const resolvedWorkspacePath = resolve(workspacePath)
    return {
        workspaceRoot: resolvedWorkspacePath,
        storePath: join(resolvedWorkspacePath, FILE_REVIEW_WORKSPACE_FOLDER, FILE_REVIEW_STORE_FILE),
        storageScope: 'workspace'
    }
}

async function loadStore(location: FileReviewStoreLocation): Promise<FileReviewStore> {
    const raw = await tryReadUtf8(location.storePath)
    if (!raw || !raw.trim()) {
        return createEmptyStore(location.workspaceRoot)
    }

    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch {
        throw new Error('Invalid file review store JSON')
    }

    if (!isStore(parsed)) {
        throw new Error('Invalid file review store format')
    }

    return {
        ...parsed,
        workspacePath: location.workspaceRoot
    }
}

async function saveStore(location: FileReviewStoreLocation, store: FileReviewStore): Promise<void> {
    await mkdir(dirname(location.storePath), { recursive: true })
    await writeFile(location.storePath, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
}

async function withStoreMutation<T>(
    location: FileReviewStoreLocation,
    mutate: (store: FileReviewStore) => Promise<T> | T
): Promise<T> {
    const previous = mutationQueues.get(location.storePath) ?? Promise.resolve()
    let result: T | undefined
    const next = previous
        .catch(() => {})
        .then(async () => {
            const store = await loadStore(location)
            result = await mutate(store)
            store.updatedAt = Date.now()
            await saveStore(location, store)
        })
        .finally(() => {
            if (mutationQueues.get(location.storePath) === next) {
                mutationQueues.delete(location.storePath)
            }
        })
    mutationQueues.set(location.storePath, next)
    await next
    return result as T
}

function normalizeRequestedFilePath(workspacePath: string, filePath: string): { relativePath: string; absolutePath: string } {
    const absolutePath = resolve(workspacePath, filePath)
    return {
        relativePath: filePath,
        absolutePath
    }
}

async function readAbsoluteFileContent(absolutePath: string): Promise<string | null> {
    return await tryReadUtf8(absolutePath)
}

export async function listFileReviewThreads(workspacePath: string, filePath: string): Promise<{
    storePath: string
    storageScope: 'git' | 'workspace'
    threads: ResolvedFileReviewThread[]
}> {
    const location = await resolveFileReviewStoreLocation(workspacePath)
    const store = await loadStore(location)
    const normalized = normalizeRequestedFilePath(workspacePath, filePath)
    const content = await readAbsoluteFileContent(normalized.absolutePath)

    const threads = store.threads
        .filter((thread) => thread.absolutePath === normalized.absolutePath)
        .map((thread) => {
            const resolved = resolveThreadAnchor(thread, content)
            return {
                ...thread,
                resolvedLine: resolved.resolvedLine,
                orphaned: resolved.orphaned
            } satisfies ResolvedFileReviewThread
        })
        .sort((left, right) => {
            if (left.orphaned !== right.orphaned) {
                return left.orphaned ? 1 : -1
            }
            if (left.resolvedLine !== right.resolvedLine) {
                return (left.resolvedLine ?? Number.MAX_SAFE_INTEGER) - (right.resolvedLine ?? Number.MAX_SAFE_INTEGER)
            }
            return left.createdAt - right.createdAt
        })

    return {
        storePath: location.storePath,
        storageScope: location.storageScope,
        threads
    }
}

export async function createFileReviewThread(
    workspacePath: string,
    filePath: string,
    options: { line: number; body: string; author: 'user' | 'agent' }
): Promise<void> {
    const location = await resolveFileReviewStoreLocation(workspacePath)
    const normalized = normalizeRequestedFilePath(workspacePath, filePath)
    const content = await readAbsoluteFileContent(normalized.absolutePath)
    if (content === null) {
        throw new Error('File not found')
    }

    const lines = splitLines(content)
    if (!Number.isInteger(options.line) || options.line < 1 || options.line > Math.max(lines.length, 1)) {
        throw new Error('Invalid line number')
    }

    await withStoreMutation(location, async (store) => {
        const now = Date.now()
        store.threads.push({
            id: randomUUID(),
            filePath: normalized.relativePath,
            absolutePath: normalized.absolutePath,
            createdAt: now,
            updatedAt: now,
            status: 'open',
            anchor: buildAnchor(lines, options.line),
            comments: [
                {
                    id: randomUUID(),
                    author: options.author,
                    createdAt: now,
                    body: options.body
                }
            ]
        })
    })
}

export async function replyToFileReviewThread(
    workspacePath: string,
    threadId: string,
    options: { body: string; author: 'user' | 'agent' }
): Promise<void> {
    const location = await resolveFileReviewStoreLocation(workspacePath)
    await withStoreMutation(location, async (store) => {
        const thread = store.threads.find((entry) => entry.id === threadId)
        if (!thread) {
            throw new Error('Thread not found')
        }
        thread.comments.push({
            id: randomUUID(),
            author: options.author,
            createdAt: Date.now(),
            body: options.body
        })
        thread.updatedAt = Date.now()
    })
}

export async function setFileReviewThreadStatus(
    workspacePath: string,
    threadId: string,
    status: 'open' | 'resolved'
): Promise<void> {
    const location = await resolveFileReviewStoreLocation(workspacePath)
    await withStoreMutation(location, async (store) => {
        const thread = store.threads.find((entry) => entry.id === threadId)
        if (!thread) {
            throw new Error('Thread not found')
        }
        thread.status = status
        thread.updatedAt = Date.now()
    })
}

export async function deleteFileReviewThread(workspacePath: string, threadId: string): Promise<void> {
    const location = await resolveFileReviewStoreLocation(workspacePath)
    await withStoreMutation(location, async (store) => {
        const nextThreads = store.threads.filter((entry) => entry.id !== threadId)
        if (nextThreads.length === store.threads.length) {
            throw new Error('Thread not found')
        }
        store.threads = nextThreads
    })
}

export async function fileReviewStoreExists(workspacePath: string): Promise<boolean> {
    const location = await resolveFileReviewStoreLocation(workspacePath)
    return await exists(location.storePath)
}
