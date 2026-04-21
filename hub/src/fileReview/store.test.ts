import { afterEach, describe, expect, it } from 'bun:test'
import { mkdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import {
    createFileReviewThread,
    deleteFileReviewThread,
    listFileReviewThreads,
    replyToFileReviewThread,
    resolveFileReviewStoreLocation,
    setFileReviewThreadStatus
} from './store'

const testRoots: string[] = []

async function makeTempDir(name: string): Promise<string> {
    const path = join(tmpdir(), `maglev-file-review-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    await mkdir(path, { recursive: true })
    testRoots.push(path)
    return path
}

afterEach(async () => {
    await Promise.all(testRoots.splice(0).map(async (path) => {
        await rm(path, { recursive: true, force: true })
    }))
})

describe('file review store', () => {
    it('stores review data inside the git metadata directory for a normal repo', async () => {
        const root = await makeTempDir('git-repo')
        await mkdir(join(root, '.git'), { recursive: true })

        const location = await resolveFileReviewStoreLocation(root)

        expect(location.storageScope).toBe('git')
        expect(location.storePath).toBe(join(root, '.git', 'maglev-review', 'file-threads.json'))
    })

    it('stores review data inside the worktree gitdir when .git is a pointer file', async () => {
        const root = await makeTempDir('worktree')
        const gitDir = join(root, '..', 'gitdir-target')
        await mkdir(gitDir, { recursive: true })
        await writeFile(join(root, '.git'), `gitdir: ${gitDir}\n`, 'utf8')

        const location = await resolveFileReviewStoreLocation(root)

        expect(location.storageScope).toBe('git')
        expect(location.storePath).toBe(join(gitDir, 'maglev-review', 'file-threads.json'))
    })

    it('reanchors threads by stored preview and surrounding context after the file shifts', async () => {
        const root = await makeTempDir('reanchor')
        await mkdir(join(root, '.git'), { recursive: true })
        await writeFile(join(root, 'README.md'), ['alpha', 'beta', 'gamma'].join('\n'), 'utf8')

        await createFileReviewThread(root, 'README.md', {
            line: 2,
            body: 'Check beta',
            author: 'user'
        })

        await writeFile(join(root, 'README.md'), ['intro', 'alpha', 'beta', 'gamma'].join('\n'), 'utf8')

        const result = await listFileReviewThreads(root, 'README.md')

        expect(result.threads).toHaveLength(1)
        expect(result.threads[0]?.resolvedLine).toBe(3)
        expect(result.threads[0]?.orphaned).toBe(false)
    })

    it('supports replies, resolving, and deleting threads', async () => {
        const root = await makeTempDir('mutations')
        await mkdir(join(root, '.git'), { recursive: true })
        await writeFile(join(root, 'notes.md'), 'line one\nline two\n', 'utf8')

        await createFileReviewThread(root, 'notes.md', {
            line: 1,
            body: 'Start thread',
            author: 'user'
        })

        const initial = await listFileReviewThreads(root, 'notes.md')
        const threadId = initial.threads[0]?.id
        expect(threadId).toBeTruthy()

        await replyToFileReviewThread(root, threadId!, {
            body: 'Agent reply',
            author: 'agent'
        })
        await setFileReviewThreadStatus(root, threadId!, 'resolved')

        const updated = await listFileReviewThreads(root, 'notes.md')
        expect(updated.threads[0]?.comments).toHaveLength(2)
        expect(updated.threads[0]?.status).toBe('resolved')

        await deleteFileReviewThread(root, threadId!)
        const emptied = await listFileReviewThreads(root, 'notes.md')
        expect(emptied.threads).toHaveLength(0)
    })
})
