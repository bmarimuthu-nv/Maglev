import { useState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { FileReviewThread } from '@/types/api'
import { CodeLinesView } from './CodeLinesView'

vi.mock('@/lib/shiki', () => ({
    useShikiLines: () => null,
    resolveLanguageFromPath: () => 'text'
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

function ReviewHarness(props: {
    content?: string
    lineThreads?: Map<number, FileReviewThread[]>
    orphanedThreads?: FileReviewThread[]
    onCreateThread?: (line: number, body: string) => void
    onReplyToThread?: (thread: FileReviewThread, body: string) => void
}) {
    const [composerLine, setComposerLine] = useState<number | null>(null)
    const [composerText, setComposerText] = useState('')

    return (
        <CodeLinesView
            content={props.content ?? ['alpha line', 'beta line', 'gamma line'].join('\n')}
            filePath="/repo/src/example.ts"
            buildLink={(line) => `https://maglev.test/file#L${line}`}
            mode="review"
            lineThreads={props.lineThreads}
            orphanedThreads={props.orphanedThreads}
            composerLine={composerLine}
            composerText={composerText}
            onComposerLineChange={setComposerLine}
            onComposerTextChange={setComposerText}
            onCreateThread={(line) => props.onCreateThread?.(line, composerText)}
            onReplyToThread={props.onReplyToThread}
        />
    )
}

describe('CodeLinesView', () => {
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
        vi.unstubAllGlobals()
    })

    it('supports in-file search navigation', () => {
        render(
            <CodeLinesView
                content={['alpha line', 'beta line', 'another alpha line'].join('\n')}
                filePath="/repo/src/example.ts"
                buildLink={(line) => `https://maglev.test/file#L${line}`}
            />
        )

        const input = screen.getByPlaceholderText('Search in file')
        fireEvent.change(input, { target: { value: 'alpha' } })

        expect(screen.getByText('1 of 2')).toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: 'Next' }))
        expect(screen.getByText('2 of 2')).toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: 'Prev' }))
        expect(screen.getByText('1 of 2')).toBeInTheDocument()
    })

    it('opens an inline composer in review mode and submits a new thread', () => {
        const onCreateThread = vi.fn()

        render(<ReviewHarness onCreateThread={onCreateThread} />)

        fireEvent.click(screen.getByTitle('Add comment on line 2'))
        expect(screen.getByText('Comment on line 2')).toBeInTheDocument()

        fireEvent.change(screen.getByPlaceholderText('Add comment for line 2'), {
            target: { value: 'Please tighten this branch.' }
        })
        fireEvent.click(screen.getByRole('button', { name: 'Save comment' }))

        expect(onCreateThread).toHaveBeenCalledWith(2, 'Please tighten this branch.')
    })

    it('renders inline and orphaned review threads and forwards replies', () => {
        const lineThread = makeThread({
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
        const orphanedThread = makeThread({
            id: 'thread-2',
            resolvedLine: null,
            orphaned: true,
            comments: [
                {
                    id: 'thread-2-root',
                    author: 'agent',
                    createdAt: Date.now(),
                    body: 'This comment lost its anchor.'
                }
            ]
        })
        const onReplyToThread = vi.fn()

        render(
            <ReviewHarness
                lineThreads={new Map([[2, [lineThread]]])}
                orphanedThreads={[orphanedThread]}
                onReplyToThread={onReplyToThread}
            />
        )

        expect(screen.getByText('1 unresolved')).toBeInTheDocument()
        expect(screen.getByText('Need a null guard here.')).toBeInTheDocument()
        expect(screen.getByText('Orphaned')).toBeInTheDocument()
        expect(screen.getByText('This comment lost its anchor.')).toBeInTheDocument()

        fireEvent.change(screen.getAllByPlaceholderText('Reply to thread')[0], {
            target: { value: 'Good catch.' }
        })
        fireEvent.click(screen.getAllByRole('button', { name: 'Reply' })[0])

        expect(onReplyToThread).toHaveBeenCalledWith(lineThread, 'Good catch.')
    })
})
