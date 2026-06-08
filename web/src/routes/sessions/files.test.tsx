import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@/lib/i18n-context'
import { queryKeys } from '@/lib/query-keys'
import FilesPage from './files'

const navigateMock = vi.fn()
const useSessionFileSearchMock = vi.fn()
const readSessionFileMock = vi.fn()

vi.mock('@tanstack/react-router', () => ({
    useParams: () => ({ sessionId: 'session-1' }),
    useSearch: () => ({}),
    useNavigate: () => navigateMock
}))

vi.mock('@/lib/app-context', () => ({
    useAppContext: () => ({
        api: {
            readSessionFile: readSessionFileMock
        },
        scopeKey: 'test-scope',
        baseUrl: 'http://localhost:3000'
    })
}))

vi.mock('@/hooks/queries/useSession', () => ({
    useSession: () => ({
        session: {
            id: 'session-1',
            active: true,
            metadata: { path: '/tmp/project' }
        }
    })
}))

vi.mock('@/hooks/queries/useSessionFileSearch', () => ({
    useSessionFileSearch: (...args: unknown[]) => useSessionFileSearchMock(...args)
}))

vi.mock('@/components/SessionFiles/DirectoryTree', () => ({
    DirectoryTree: () => <div data-testid="directory-tree" />
}))

vi.mock('@/components/SessionFiles/CodeLinesView', () => ({
    CodeLinesView: () => <div data-testid="code-lines-view" />
}))

function renderPage(queryClient: QueryClient) {
    return render(
        <QueryClientProvider client={queryClient}>
            <I18nProvider>
                <FilesPage />
            </I18nProvider>
        </QueryClientProvider>
    )
}

afterEach(() => {
    cleanup()
    vi.clearAllMocks()
})

describe('FilesPage', () => {
    it('submits file search when clicking the search icon', async () => {
        useSessionFileSearchMock.mockImplementation(() => ({
            files: [],
            error: null,
            isLoading: false,
            refetch: vi.fn()
        }))

        const queryClient = new QueryClient({
            defaultOptions: {
                queries: {
                    retry: false,
                    gcTime: 0
                }
            }
        })

        renderPage(queryClient)

        const input = screen.getByPlaceholderText('Search or absolute path')
        fireEvent.change(input, { target: { value: 'README' } })
        fireEvent.click(screen.getByRole('button', { name: 'Search files' }))

        await waitFor(() => {
            expect(useSessionFileSearchMock).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    readSessionFile: readSessionFileMock
                }),
                'session-1',
                'README',
                expect.objectContaining({
                    enabled: true,
                    limit: 5000
                })
            )
        })
    })

    it('opens an absolute path directly instead of searching for it', async () => {
        readSessionFileMock.mockResolvedValue({
            success: true,
            content: '',
            hash: 'hash'
        })
        useSessionFileSearchMock.mockImplementation(() => ({
            files: [],
            error: null,
            isLoading: false,
            refetch: vi.fn()
        }))

        const queryClient = new QueryClient({
            defaultOptions: {
                queries: {
                    retry: false,
                    gcTime: 0
                }
            }
        })

        renderPage(queryClient)

        const absolutePath = '/tmp/project/src/app.ts'
        const input = screen.getByPlaceholderText('Search or absolute path')
        fireEvent.change(input, { target: { value: absolutePath } })
        fireEvent.click(screen.getByRole('button', { name: 'Search files' }))

        await waitFor(() => {
            expect(readSessionFileMock).toHaveBeenCalledWith('session-1', absolutePath)
        })
        expect(useSessionFileSearchMock.mock.calls.some((call) => call[2] === absolutePath)).toBe(false)
        expect(screen.getAllByText('app.ts').length).toBeGreaterThan(0)
        expect(screen.getByText(absolutePath)).toBeInTheDocument()
    })

    it('filters file results with regex mode', async () => {
        useSessionFileSearchMock.mockImplementation(() => ({
            files: [
                {
                    fileName: 'app.ts',
                    fullPath: 'src/app.ts',
                    filePath: 'src',
                    fileType: 'file'
                },
                {
                    fileName: 'README.md',
                    fullPath: 'README.md',
                    filePath: '',
                    fileType: 'file'
                }
            ],
            error: null,
            isLoading: false,
            refetch: vi.fn()
        }))

        const queryClient = new QueryClient({
            defaultOptions: {
                queries: {
                    retry: false,
                    gcTime: 0
                }
            }
        })

        renderPage(queryClient)

        fireEvent.click(screen.getByRole('button', { name: 'Use regex search' }))
        const input = screen.getByPlaceholderText('Search or absolute path')
        fireEvent.change(input, { target: { value: '.*\\.ts$' } })
        fireEvent.click(screen.getByRole('button', { name: 'Search files' }))

        await waitFor(() => {
            expect(useSessionFileSearchMock).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    readSessionFile: readSessionFileMock
                }),
                'session-1',
                '',
                expect.objectContaining({
                    enabled: true,
                    limit: 5000
                })
            )
        })
        expect(screen.getAllByText('app.ts').length).toBeGreaterThan(0)
        expect(screen.queryByText('README.md')).not.toBeInTheDocument()
    })

    it('refreshes the submitted search query instead of the empty key', async () => {
        useSessionFileSearchMock.mockImplementation(() => ({
            files: [],
            error: null,
            isLoading: false,
            refetch: vi.fn()
        }))

        const queryClient = new QueryClient({
            defaultOptions: {
                queries: {
                    retry: false,
                    gcTime: 0
                }
            }
        })
        const invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries')

        renderPage(queryClient)

        const input = screen.getByPlaceholderText('Search or absolute path')
        fireEvent.change(input, { target: { value: 'README' } })
        fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })

        await waitFor(() => {
            expect(useSessionFileSearchMock).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    readSessionFile: readSessionFileMock
                }),
                'session-1',
                'README',
                expect.objectContaining({
                    enabled: true,
                    limit: 5000
                })
            )
        })

        fireEvent.click(screen.getByTitle('Refresh'))

        await waitFor(() => {
            expect(invalidateQueriesSpy).toHaveBeenCalledWith({
                queryKey: queryKeys.sessionFiles('test-scope', 'session-1', 'README')
            })
        })
    })
})
