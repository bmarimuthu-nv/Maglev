import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AppContextProvider } from '@/lib/app-context'
import { decodeBase64, encodeBase64 } from '@/lib/utils'
import { FilePreviewPanel } from './FilePreviewPanel'

vi.mock('@/lib/shiki', () => ({
    useShikiLines: () => null,
    resolveLanguageFromPath: () => 'text'
}))

vi.mock('@/components/MarkdownRenderer', () => ({
    MarkdownRenderer: ({ content }: { content: string }) => (
        <div data-testid="markdown-renderer">{content}</div>
    )
}))

function createApi(overrides?: Partial<{
    readSessionFile: ReturnType<typeof vi.fn>
    getSessionFileReviewThreads: ReturnType<typeof vi.fn>
    createSessionFileReviewThread: ReturnType<typeof vi.fn>
    replyToSessionFileReviewThread: ReturnType<typeof vi.fn>
    setSessionFileReviewThreadStatus: ReturnType<typeof vi.fn>
    deleteSessionFileReviewThread: ReturnType<typeof vi.fn>
    writeSessionFile: ReturnType<typeof vi.fn>
}>) {
    return {
        readSessionFile: vi.fn(),
        getSessionFileReviewThreads: vi.fn(),
        createSessionFileReviewThread: vi.fn(),
        replyToSessionFileReviewThread: vi.fn(),
        setSessionFileReviewThreadStatus: vi.fn(),
        deleteSessionFileReviewThread: vi.fn(),
        writeSessionFile: vi.fn(),
        ...overrides
    }
}

function renderPreview(
    api: ReturnType<typeof createApi>,
    filePath: string,
    presentation: 'sidebar' | 'overlay' = 'sidebar',
    workspacePath: string | null = '/repo'
) {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
                gcTime: 0
            }
        }
    })

    return render(
        <QueryClientProvider client={queryClient}>
            <AppContextProvider
                value={{
                    api: api as never,
                    token: 'token',
                    baseUrl: 'https://maglev.test',
                    scopeKey: 'test-scope'
                }}
            >
                <FilePreviewPanel
                    sessionId="session-1"
                    filePath={filePath}
                    api={api as never}
                    onClose={vi.fn()}
                    presentation={presentation}
                    workspacePath={workspacePath}
                />
            </AppContextProvider>
        </QueryClientProvider>
    )
}

describe('FilePreviewPanel', () => {
    beforeEach(() => {
        window.matchMedia = vi.fn().mockImplementation(() => ({
            matches: false,
            media: '(pointer: coarse)',
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        }))
        vi.stubGlobal('navigator', {
            clipboard: {
                writeText: vi.fn()
            },
            vibrate: vi.fn()
        })
        HTMLElement.prototype.scrollIntoView = vi.fn()
    })

    afterEach(() => {
        vi.clearAllMocks()
        vi.unstubAllGlobals()
        window.sessionStorage.clear()
        cleanup()
    })

    it('loads a code file and switches into review mode with inline thread content', async () => {
        const now = Date.now()
        const api = createApi({
            readSessionFile: vi.fn().mockImplementation(async (_sessionId: string, path: string) => {
                if (path === '.maglev-review/review.json') {
                    return {
                        success: true,
                        content: encodeBase64(JSON.stringify({
                            version: 1,
                            workspacePath: '/repo',
                            currentBranch: null,
                            defaultBranch: null,
                            mergeBase: null,
                            reviewContext: null,
                            updatedAt: now,
                            threads: [{
                                id: 'thread-1',
                                diffMode: 'branch',
                                filePath: '/repo/src/example.ts',
                                anchor: {
                                    side: 'right',
                                    line: 2,
                                    preview: 'const b = a + 1'
                                },
                                status: 'open',
                                comments: [{
                                    id: 'thread-1-root',
                                    author: 'user',
                                    createdAt: now,
                                    body: 'Need a null guard here.'
                                }]
                            }]
                        })),
                        hash: 'review-hash'
                    }
                }
                return {
                    success: true,
                    content: encodeBase64(['const a = 1', 'const b = a + 1'].join('\n')),
                    hash: 'file-hash'
                }
            }),
            getSessionFileReviewThreads: vi.fn().mockResolvedValue({
                success: true,
                threads: []
            })
        })

        renderPreview(api, '/repo/src/example.ts')

        expect(await screen.findByText('/repo/src/example.ts')).toBeInTheDocument()
        expect(await screen.findByPlaceholderText('Search in file')).toBeInTheDocument()
        expect(screen.getByText('2 lines')).toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: 'Review' }))

        expect(await screen.findByText('Review annotations')).toBeInTheDocument()
        expect(await screen.findByText('1 total threads')).toBeInTheDocument()
        expect(screen.getAllByText('1 unresolved').length).toBeGreaterThanOrEqual(1)
        expect(screen.getByText('Need a null guard here.')).toBeInTheDocument()
        expect(screen.getByPlaceholderText('Search in file')).toBeInTheDocument()
    })

    it('copies the review JSON path from the header', async () => {
        const api = createApi({
            readSessionFile: vi.fn().mockResolvedValue({
                success: true,
                content: encodeBase64('const value = 1'),
                hash: 'file-hash'
            }),
            getSessionFileReviewThreads: vi.fn().mockResolvedValue({
                success: true,
                threads: []
            })
        })

        renderPreview(api, '/repo/src/example.ts')

        expect(await screen.findByText('/repo/src/example.ts')).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Copy review JSON path' }))

        await waitFor(() => {
            expect(navigator.clipboard.writeText).toHaveBeenCalledWith('/repo/.maglev-review/review.json')
        })
    })

    it('creates open-file review comments in the shared review JSON file', async () => {
        const writeSessionFile = vi.fn().mockResolvedValue({
            success: true,
            hash: 'review-hash'
        })
        const api = createApi({
            readSessionFile: vi.fn().mockImplementation(async (_sessionId: string, path: string) => {
                if (path === '.maglev-review/review.json') {
                    return {
                        success: false,
                        error: 'ENOENT: no such file or directory'
                    }
                }
                return {
                    success: true,
                    content: encodeBase64(['const a = 1', 'const b = a + 1'].join('\n')),
                    hash: 'file-hash'
                }
            }),
            writeSessionFile
        })

        renderPreview(api, '/repo/src/example.ts')

        expect(await screen.findByText('/repo/src/example.ts')).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Review' }))
        expect(await screen.findByText('Review annotations')).toBeInTheDocument()

        const addCommentButton = await screen.findByTitle('Add comment on line 2')
        await waitFor(() => {
            expect(addCommentButton).not.toBeDisabled()
        })
        fireEvent.click(addCommentButton)
        fireEvent.change(screen.getByPlaceholderText('Add comment for line 2'), {
            target: { value: 'Use the shared review file.' }
        })
        fireEvent.click(screen.getByRole('button', { name: 'Save comment' }))

        await waitFor(() => {
            expect(writeSessionFile).toHaveBeenCalled()
        })
        const [, reviewPath, encodedContent, expectedHash] = writeSessionFile.mock.calls[0]
        const decoded = decodeBase64(encodedContent)
        expect(reviewPath).toBe('.maglev-review/review.json')
        expect(expectedHash).toBeNull()
        expect(decoded.ok).toBe(true)
        const payload = JSON.parse(decoded.text)
        expect(payload.workspacePath).toBe('/repo')
        expect(payload.threads).toHaveLength(1)
        expect(payload.threads[0]).toMatchObject({
            diffMode: 'branch',
            filePath: '/repo/src/example.ts',
            anchor: {
                side: 'right',
                line: 2,
                preview: 'const b = a + 1'
            },
            status: 'open'
        })
        expect(payload.threads[0].comments[0]).toMatchObject({
            author: 'user',
            body: 'Use the shared review file.'
        })
    })

    it('uses rendered markdown in code mode and falls back to the code canvas in review mode', async () => {
        const now = Date.now()
        const api = createApi({
            readSessionFile: vi.fn().mockImplementation(async (_sessionId: string, path: string) => {
                if (path === '.maglev-review/review.json') {
                    return {
                        success: true,
                        content: encodeBase64(JSON.stringify({
                            version: 1,
                            workspacePath: '/repo',
                            currentBranch: null,
                            defaultBranch: null,
                            mergeBase: null,
                            reviewContext: null,
                            updatedAt: now,
                            threads: [{
                                id: 'thread-md',
                                diffMode: 'branch',
                                filePath: '/repo/README.md',
                                anchor: {
                                    side: 'right',
                                    line: 1,
                                    preview: '# Hello Maglev'
                                },
                                status: 'open',
                                comments: [{
                                    id: 'thread-md-root',
                                    author: 'agent',
                                    createdAt: now,
                                    body: 'Consider tightening this heading.'
                                }]
                            }]
                        })),
                        hash: 'review-hash'
                    }
                }
                return {
                    success: true,
                    content: encodeBase64('# Hello Maglev\n\nPreview text'),
                    hash: 'md-hash'
                }
            }),
            getSessionFileReviewThreads: vi.fn().mockResolvedValue({
                success: true,
                threads: []
            })
        })

        renderPreview(api, '/repo/README.md')

        expect(await screen.findByTestId('markdown-renderer')).toHaveTextContent('# Hello Maglev')
        expect(screen.getByRole('button', { name: 'Rendered' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Source' })).toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: 'Review' }))

        expect(await screen.findByText('Review annotations')).toBeInTheDocument()
        expect(screen.getByPlaceholderText('Search in file')).toBeInTheDocument()
        expect(await screen.findByText('Consider tightening this heading.')).toBeInTheDocument()

        await waitFor(() => {
            expect(screen.getAllByTestId('markdown-renderer').map((element) => element.textContent)).toEqual([
                'Consider tightening this heading.'
            ])
        })
    })

    it('keeps the draft and shows overwrite or discard actions on save conflict', async () => {
        const api = createApi({
            readSessionFile: vi.fn().mockResolvedValue({
                success: true,
                content: encodeBase64('const value = 1\n'),
                hash: 'file-hash'
            }),
            getSessionFileReviewThreads: vi.fn().mockResolvedValue({
                success: true,
                threads: []
            }),
            writeSessionFile: vi.fn()
                .mockResolvedValueOnce({
                    success: false,
                    error: 'File changed on disk since this preview was loaded',
                    conflict: {
                        type: 'hash_mismatch',
                        expectedHash: 'file-hash',
                        currentHash: 'fresh-hash',
                        currentContent: encodeBase64('const value = 9\n')
                    }
                })
                .mockResolvedValueOnce({
                    success: true,
                    hash: 'saved-hash'
                })
        })

        renderPreview(api, '/repo/src/example.ts')

        expect(await screen.findByText('/repo/src/example.ts')).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

        const editor = screen.getByRole('textbox')
        fireEvent.change(editor, { target: { value: 'const value = 2\n' } })
        fireEvent.click(screen.getByRole('button', { name: 'Save' }))

        expect(await screen.findByText('This file changed on disk after you opened it.')).toBeInTheDocument()
        expect(screen.getByText('Your draft is still intact.')).toBeInTheDocument()
        expect(api.writeSessionFile).toHaveBeenNthCalledWith(
            1,
            'session-1',
            '/repo/src/example.ts',
            encodeBase64('const value = 2\n'),
            'file-hash'
        )
        expect(screen.getByRole('textbox')).toHaveValue('const value = 2\n')

        fireEvent.click(screen.getByRole('button', { name: 'Overwrite with my draft' }))

        await waitFor(() => {
            expect(api.writeSessionFile).toHaveBeenNthCalledWith(
                2,
                'session-1',
                '/repo/src/example.ts',
                encodeBase64('const value = 2\n'),
                'fresh-hash'
            )
        })
    })

    it('restores an unsaved draft from sessionStorage for the same session and file', async () => {
        window.sessionStorage.setItem(
            'maglev:file-preview-draft:test-scope:session-1:/repo/src/example.ts',
            JSON.stringify({
                draft: 'const recovered = true\n',
                updatedAt: Date.now()
            })
        )

        const api = createApi({
            readSessionFile: vi.fn().mockResolvedValue({
                success: true,
                content: encodeBase64('const value = 1\n'),
                hash: 'file-hash'
            }),
            getSessionFileReviewThreads: vi.fn().mockResolvedValue({
                success: true,
                threads: []
            })
        })

        renderPreview(api, '/repo/src/example.ts')

        expect(await screen.findByText('Recovered unsaved draft from this browser session')).toBeInTheDocument()
        expect(screen.getByRole('textbox')).toHaveValue('const recovered = true\n')
    })

    it('keeps conflict recovery actions working in overlay presentation', async () => {
        const api = createApi({
            readSessionFile: vi.fn()
                .mockResolvedValueOnce({
                    success: true,
                    content: encodeBase64('const value = 1\n'),
                    hash: 'old-hash'
                })
                .mockResolvedValueOnce({
                    success: true,
                    content: encodeBase64('const value = 3\n'),
                    hash: 'fresh-hash'
                }),
            getSessionFileReviewThreads: vi.fn().mockResolvedValue({
                success: true,
                threads: []
            }),
            writeSessionFile: vi.fn()
                .mockResolvedValueOnce({
                    success: false,
                    conflict: {
                        type: 'hash_mismatch',
                        currentHash: 'fresh-hash'
                    }
                })
                .mockResolvedValueOnce({
                    success: true
                })
        })

        renderPreview(api, '/repo/src/example.ts', 'overlay')

        expect(await screen.findByText('/repo/src/example.ts')).toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
        fireEvent.change(screen.getByRole('textbox'), {
            target: { value: 'const value = 2\n' }
        })
        fireEvent.click(screen.getByRole('button', { name: 'Save' }))

        expect(await screen.findByText('This file changed on disk after you opened it.')).toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: 'Overwrite with my draft' }))

        await waitFor(() => {
            expect(api.writeSessionFile).toHaveBeenNthCalledWith(
                2,
                'session-1',
                '/repo/src/example.ts',
                encodeBase64('const value = 2\n'),
                'fresh-hash'
            )
        })
    })
})
