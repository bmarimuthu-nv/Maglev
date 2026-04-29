import { describe, expect, it } from 'vitest'
import { countReviewCommentsByFile, parseReviewFile, type ReviewThread } from './review-file'

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
})
