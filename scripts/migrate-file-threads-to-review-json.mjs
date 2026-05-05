#!/usr/bin/env node

import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

const LEGACY_FILE_NAME = 'file-threads.json'
const LEGACY_GIT_FOLDER = 'maglev-review'
const LEGACY_WORKSPACE_FOLDER = '.maglev-review'
const REVIEW_FILE_PATH = join('.maglev-review', 'review.json')
const VALID_REVIEW_MODES = new Set(['branch', 'working'])

function usage() {
    console.log(`Usage:
  node scripts/migrate-file-threads-to-review-json.mjs [workspace] [options]

Migrates old open-file review comments from file-threads.json into
.maglev-review/review.json. Existing review.json threads are preserved.

Options:
  --legacy <path>       Read a specific file-threads.json
  --review <path>       Write a specific review.json path
  --mode <branch|working>
                        Diff mode to assign to migrated threads. Default: branch
  --dry-run             Print what would happen without writing
  --no-backup           Do not back up an existing review.json before writing
  -h, --help            Show this help
`)
}

function fail(message) {
    console.error(`Error: ${message}`)
    process.exit(1)
}

function parseArgs(argv) {
    const options = {
        workspacePath: null,
        legacyPath: null,
        reviewPath: null,
        mode: 'branch',
        dryRun: false,
        backup: true
    }

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index]
        if (arg === '-h' || arg === '--help') {
            usage()
            process.exit(0)
        }
        if (arg === '--dry-run') {
            options.dryRun = true
            continue
        }
        if (arg === '--no-backup') {
            options.backup = false
            continue
        }
        if (arg === '--legacy' || arg === '--review' || arg === '--mode') {
            const value = argv[index + 1]
            if (!value || value.startsWith('--')) {
                fail(`${arg} requires a value`)
            }
            index += 1
            if (arg === '--legacy') options.legacyPath = resolve(value)
            if (arg === '--review') options.reviewPath = resolve(value)
            if (arg === '--mode') options.mode = value
            continue
        }
        if (arg.startsWith('--')) {
            fail(`Unknown option: ${arg}`)
        }
        if (options.workspacePath) {
            fail(`Unexpected extra positional argument: ${arg}`)
        }
        options.workspacePath = resolve(arg)
    }

    options.workspacePath = options.workspacePath ?? process.cwd()
    options.reviewPath = options.reviewPath ?? join(options.workspacePath, REVIEW_FILE_PATH)

    if (!VALID_REVIEW_MODES.has(options.mode)) {
        fail(`--mode must be one of: ${Array.from(VALID_REVIEW_MODES).join(', ')}`)
    }

    return options
}

async function pathExists(path) {
    try {
        await stat(path)
        return true
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return false
        }
        throw error
    }
}

async function readIfExists(path) {
    try {
        return await readFile(path, 'utf8')
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return null
        }
        throw error
    }
}

async function findGitLegacyPath(workspacePath) {
    let current = resolve(workspacePath)

    while (true) {
        const gitMarkerPath = join(current, '.git')
        try {
            const gitMarkerStats = await stat(gitMarkerPath)
            if (gitMarkerStats.isDirectory()) {
                return join(gitMarkerPath, LEGACY_GIT_FOLDER, LEGACY_FILE_NAME)
            }
            if (gitMarkerStats.isFile()) {
                const gitPointer = await readFile(gitMarkerPath, 'utf8')
                const match = gitPointer.match(/^gitdir:\s*(.+)\s*$/m)
                if (match?.[1]) {
                    return join(resolve(current, match[1].trim()), LEGACY_GIT_FOLDER, LEGACY_FILE_NAME)
                }
            }
        } catch (error) {
            if (error?.code !== 'ENOENT') {
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

async function resolveLegacyPath(workspacePath, explicitLegacyPath) {
    if (explicitLegacyPath) {
        return { legacyPath: explicitLegacyPath, checkedPaths: [explicitLegacyPath] }
    }

    const gitPath = await findGitLegacyPath(workspacePath)
    const workspacePathFallback = join(workspacePath, LEGACY_WORKSPACE_FOLDER, LEGACY_FILE_NAME)
    const checkedPaths = [...new Set([gitPath, workspacePathFallback].filter(Boolean))]

    for (const candidate of checkedPaths) {
        if (await pathExists(candidate)) {
            return { legacyPath: candidate, checkedPaths }
        }
    }

    return { legacyPath: checkedPaths[0] ?? workspacePathFallback, checkedPaths }
}

function parseJson(raw, path) {
    try {
        return JSON.parse(raw)
    } catch {
        fail(`Invalid JSON in ${path}`)
    }
}

function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value)
}

function validateLegacyStore(value, path) {
    if (!isObject(value) || value.version !== 1 || !Array.isArray(value.threads)) {
        fail(`Invalid legacy file review store format: ${path}`)
    }

    for (const [index, thread] of value.threads.entries()) {
        if (!isObject(thread)
            || typeof thread.id !== 'string'
            || typeof thread.filePath !== 'string'
            || (thread.status !== 'open' && thread.status !== 'resolved')
            || !isObject(thread.anchor)
            || typeof thread.anchor.line !== 'number'
            || typeof thread.anchor.preview !== 'string'
            || !Array.isArray(thread.comments)) {
            fail(`Invalid legacy thread at index ${index}: ${path}`)
        }

        for (const [commentIndex, comment] of thread.comments.entries()) {
            if (!isObject(comment)
                || typeof comment.id !== 'string'
                || typeof comment.author !== 'string'
                || typeof comment.createdAt !== 'number'
                || typeof comment.body !== 'string') {
                fail(`Invalid legacy comment at thread ${index}, comment ${commentIndex}: ${path}`)
            }
        }
    }

    return value
}

function createEmptyReviewFile(workspacePath) {
    return {
        version: 1,
        workspacePath,
        currentBranch: null,
        defaultBranch: null,
        mergeBase: null,
        reviewContext: null,
        updatedAt: Date.now(),
        threads: []
    }
}

function validateReviewFile(value, path, workspacePath) {
    if (!isObject(value) || value.version !== 1 || !Array.isArray(value.threads)) {
        fail(`Invalid review file format: ${path}`)
    }

    return {
        ...value,
        workspacePath: typeof value.workspacePath === 'string' ? value.workspacePath : workspacePath,
        currentBranch: value.currentBranch ?? null,
        defaultBranch: value.defaultBranch ?? null,
        mergeBase: value.mergeBase ?? null,
        reviewContext: value.reviewContext ?? null
    }
}

async function loadReviewFile(reviewPath, workspacePath) {
    const raw = await readIfExists(reviewPath)
    if (!raw || !raw.trim()) {
        return createEmptyReviewFile(workspacePath)
    }
    return validateReviewFile(parseJson(raw, reviewPath), reviewPath, workspacePath)
}

function migrateThread(thread, mode) {
    return {
        id: thread.id,
        diffMode: mode,
        filePath: thread.filePath,
        anchor: {
            side: 'right',
            line: thread.anchor.line,
            preview: thread.anchor.preview
        },
        status: thread.status,
        comments: thread.comments.map((comment) => ({
            id: comment.id,
            author: comment.author,
            createdAt: comment.createdAt,
            body: comment.body
        }))
    }
}

function timestampForFile() {
    return new Date().toISOString().replace(/[:.]/g, '-')
}

async function main() {
    const options = parseArgs(process.argv.slice(2))
    const { legacyPath, checkedPaths } = await resolveLegacyPath(options.workspacePath, options.legacyPath)

    if (!await pathExists(legacyPath)) {
        fail(`Legacy ${LEGACY_FILE_NAME} not found. Checked:\n  ${checkedPaths.join('\n  ')}`)
    }

    const legacyRaw = await readFile(legacyPath, 'utf8')
    const legacyStore = validateLegacyStore(parseJson(legacyRaw, legacyPath), legacyPath)
    const reviewFile = await loadReviewFile(options.reviewPath, options.workspacePath)
    const existingThreadIds = new Set(reviewFile.threads.map((thread) => thread.id))
    const migratedThreads = []
    let skippedDuplicateIds = 0

    for (const thread of legacyStore.threads) {
        if (existingThreadIds.has(thread.id)) {
            skippedDuplicateIds += 1
            continue
        }
        migratedThreads.push(migrateThread(thread, options.mode))
    }

    const nextReviewFile = {
        ...reviewFile,
        workspacePath: reviewFile.workspacePath || options.workspacePath,
        updatedAt: Date.now(),
        threads: [...reviewFile.threads, ...migratedThreads]
    }

    console.log(`Legacy store: ${legacyPath}`)
    console.log(`Review file:  ${options.reviewPath}`)
    console.log(`Diff mode:    ${options.mode}`)
    console.log(`Existing review threads: ${reviewFile.threads.length}`)
    console.log(`Legacy threads:          ${legacyStore.threads.length}`)
    console.log(`Threads to migrate:      ${migratedThreads.length}`)
    console.log(`Skipped duplicate IDs:   ${skippedDuplicateIds}`)

    if (options.dryRun) {
        console.log('Dry run only. No files written.')
        return
    }

    await mkdir(dirname(options.reviewPath), { recursive: true })

    if (options.backup && await pathExists(options.reviewPath)) {
        const backupPath = `${options.reviewPath}.pre-file-threads-migration-${timestampForFile()}`
        await copyFile(options.reviewPath, backupPath)
        console.log(`Backup written: ${backupPath}`)
    }

    await writeFile(options.reviewPath, `${JSON.stringify(nextReviewFile, null, 2)}\n`, 'utf8')
    console.log(`Migration complete. Wrote ${options.reviewPath}`)
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})
