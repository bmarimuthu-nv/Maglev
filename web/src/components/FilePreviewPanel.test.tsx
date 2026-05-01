import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AppContextProvider } from '@/lib/app-context'
import type { FileReviewThread } from '@/types/api'
import { encodeBase64 } from '@/lib/utils'
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

function makeThread(overrides: Partial<FileReviewThread> & { id: string }): FileReviewThread {
    const now = Date.now()
    const { id, ...rest } = overrides
    return {
        id,
        filePath: '/repo/src/example.ts',
        absolutePath: '/repo/src/example.ts',
        createdAt: now,
        updatedAt: now,
        status: 'open',
        anchor: {
            line: overrides.resolvedLine ?? 1,
            preview: 'const value = 1',
            contextBefore: [],
            contextAfter: []
        },
        comments: [
            {
                id: `${overrides.id}-comment-1`,
                author: 'user',
                createdAt: now,
                body: 'Review note'
            }
        ],
        resolvedLine: 1,
        orphaned: false,
        ...rest
    }
}

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
    presentation: 'sidebar' | 'overlay' = 'sidebar'
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
        const thread = makeThread({
            id: 'thread-1',
            resolvedLine: 2,
            comments: [
                {
                    id: 'thread-1-root',
                    author: 'user',
                    createdAt: Date.now(),
                    body: 'Need a null guard here.'
                }
            ]
        })
        const api = createApi({
            readSessionFile: vi.fn().mockResolvedValue({
                success: true,
                content: encodeBase64(['const a = 1', 'const b = a + 1'].join('\n')),
                hash: 'file-hash'
            }),
            getSessionFileReviewThreads: vi.fn().mockResolvedValue({
                success: true,
                threads: [thread]
            })
        })

        renderPreview(api, '/repo/src/example.ts')

        expect(await screen.findByText('/repo/src/example.ts')).toBeInTheDocument()
        expect(await screen.findByPlaceholderText('Search in file')).toBeInTheDocument()
        expect(screen.getByText('2 lines')).toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: 'Review' }))

        expect(await screen.findByText('Review annotations')).toBeInTheDocument()
        expect(screen.getByText('1 total threads')).toBeInTheDocument()
        expect(screen.getAllByText('1 unresolved').length).toBeGreaterThanOrEqual(1)
        expect(screen.getByText('Need a null guard here.')).toBeInTheDocument()
        expect(screen.getByPlaceholderText('Search in file')).toBeInTheDocument()
    })

    it('uses rendered markdown in code mode and falls back to the code canvas in review mode', async () => {
        const thread = makeThread({
            id: 'thread-md',
            filePath: '/repo/README.md',
            absolutePath: '/repo/README.md',
            resolvedLine: 1,
            comments: [
                {
                    id: 'thread-md-root',
                    author: 'agent',
                    createdAt: Date.now(),
                    body: 'Consider tightening this heading.'
                }
            ]
        })
        const api = createApi({
            readSessionFile: vi.fn().mockResolvedValue({
                success: true,
                content: encodeBase64('# Hello Maglev\n\nPreview text'),
                hash: 'md-hash'
            }),
            getSessionFileReviewThreads: vi.fn().mockResolvedValue({
                success: true,
                threads: [thread]
            })
        })

        renderPreview(api, '/repo/README.md')

        expect(await screen.findByTestId('markdown-renderer')).toHaveTextContent('# Hello Maglev')
        expect(screen.getByRole('button', { name: 'Rendered' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Source' })).toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: 'Review' }))

        expect(await screen.findByText('Review annotations')).toBeInTheDocument()
        expect(screen.getByPlaceholderText('Search in file')).toBeInTheDocument()
        expect(screen.getByText('Consider tightening this heading.')).toBeInTheDocument()

        await waitFor(() => {
            expect(screen.queryByTestId('markdown-renderer')).not.toBeInTheDocument()
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
