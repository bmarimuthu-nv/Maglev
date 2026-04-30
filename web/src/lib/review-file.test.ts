import { describe, expect, it } from 'vitest'
import { countReviewCommentsByFile, countReviewCommentsByMode, getReviewModeLabel, isReviewThreadOutdated, keepReviewThreadsForMode, parseReviewFile, type ReviewThread } from './review-file'

describe('parseReviewFile', () => {
    it('accepts review comments from any named author', () => {
        const parsed = parseReviewFile(JSON.stringify({
            version: 1,
            workspacePath: '/repo',
            currentBranch: null,
            defaultBranch: null,
            mergeBase: null,
            updatedAt: 123,
            threads: [{
                id: 'thread-1',
                diffMode: 'branch',
                filePath: 'src/app.ts',
                anchor: {
                    side: 'right',
                    line: 12
                },
                status: 'open',
                comments: [{
                    id: 'comment-1',
                    author: 'Bharath',
                    createdAt: 456,
                    body: 'Looks good.'
                }]
            }]
        }), '/repo')

        expect(parsed.ok).toBe(true)
        if (!parsed.ok) {
            return
        }
        expect(parsed.value.threads[0]?.comments[0]?.author).toBe('Bharath')
    })

    it('rejects blank author names', () => {
        const parsed = parseReviewFile(JSON.stringify({
            version: 1,
            workspacePath: '/repo',
            updatedAt: 123,
            threads: [{
                id: 'thread-1',
                diffMode: 'branch',
                filePath: 'src/app.ts',
                anchor: {
                    side: 'right',
                    line: 12
                },
                status: 'open',
                comments: [{
                    id: 'comment-1',
                    author: '   ',
                    createdAt: 456,
                    body: 'Looks good.'
                }]
            }]
        }), '/repo')

        expect(parsed).toEqual({ ok: false, error: 'Invalid review file format' })
    })

    it('preserves review diff context metadata', () => {
        const parsed = parseReviewFile(JSON.stringify({
            version: 1,
            workspacePath: '/repo',
            currentBranch: 'feature/review',
            defaultBranch: 'origin/main',
            mergeBase: 'abc123',
            reviewContext: {
                mode: 'branch',
                modeLabel: 'Branch diff',
                baseMode: 'fork-point',
                baseModeLabel: 'Branch fork point',
                currentBranch: 'feature/review',
                defaultBranch: 'origin/main',
                mergeBase: 'abc123',
                comparison: 'Branch diff from abc123 to HEAD against origin/main using Branch fork point'
            },
            updatedAt: 123,
            threads: []
        }), '/repo')

        expect(parsed.ok).toBe(true)
        if (!parsed.ok) {
            return
        }
        expect(parsed.value.reviewContext).toEqual({
            mode: 'branch',
            modeLabel: 'Branch diff',
            baseMode: 'fork-point',
            baseModeLabel: 'Branch fork point',
            currentBranch: 'feature/review',
            defaultBranch: 'origin/main',
            mergeBase: 'abc123',
            comparison: 'Branch diff from abc123 to HEAD against origin/main using Branch fork point'
        })
    })

    it('counts review comments by file', () => {
        const threads: ReviewThread[] = [{
            id: 'thread-1',
            diffMode: 'branch',
            filePath: 'src/app.ts',
            anchor: { side: 'right', line: 12 },
            status: 'open',
            comments: [
                { id: 'comment-1', author: 'user', createdAt: 1, body: 'First' },
                { id: 'comment-2', author: 'agent', createdAt: 2, body: 'Second' }
            ]
        }, {
            id: 'thread-2',
            diffMode: 'branch',
            filePath: 'src/other.ts',
            anchor: { side: 'right', line: 8 },
            status: 'open',
            comments: [
                { id: 'comment-3', author: 'Reviewer', createdAt: 3, body: 'Third' }
            ]
        }]

        expect(Object.fromEntries(countReviewCommentsByFile(threads))).toEqual({
            'src/app.ts': 2,
            'src/other.ts': 1
        })
    })

    it('summarizes and filters review comments by diff mode', () => {
        const threads: ReviewThread[] = [{
            id: 'thread-1',
            diffMode: 'branch',
            filePath: 'src/app.ts',
            anchor: { side: 'right', line: 12 },
            status: 'open',
            comments: [
                { id: 'comment-1', author: 'user', createdAt: 1, body: 'First' },
                { id: 'comment-2', author: 'agent', createdAt: 2, body: 'Second' }
            ]
        }, {
            id: 'thread-2',
            diffMode: 'working',
            filePath: 'src/app.ts',
            anchor: { side: 'right', line: 8 },
            status: 'open',
            comments: [
                { id: 'comment-3', author: 'Reviewer', createdAt: 3, body: 'Third' }
            ]
        }]

        expect(getReviewModeLabel('branch')).toBe('Branch diff')
        expect(getReviewModeLabel('working')).toBe('Uncommitted changes')
        expect(Object.fromEntries(countReviewCommentsByMode(threads))).toEqual({
            branch: 2,
            working: 1
        })
        expect(keepReviewThreadsForMode(threads, 'working')).toEqual([threads[1]])
    })

    it('marks threads outdated when their original preview no longer matches', () => {
        const thread: ReviewThread = {
            id: 'thread-1',
            diffMode: 'branch',
            filePath: 'src/app.ts',
            anchor: { side: 'right', line: 12, preview: 'const oldValue = true' },
            status: 'open',
            comments: [
                { id: 'comment-1', author: 'Reviewer', createdAt: 1, body: 'Check this' }
            ]
        }

        expect(isReviewThreadOutdated(thread, 'const oldValue = true')).toBe(false)
        expect(isReviewThreadOutdated(thread, 'const newValue = true')).toBe(true)
        expect(isReviewThreadOutdated(thread, undefined)).toBe(true)
    })
})
