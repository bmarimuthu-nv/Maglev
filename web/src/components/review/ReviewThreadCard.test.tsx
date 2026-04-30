import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ReviewThreadCard } from './ReviewThreadCard'

describe('ReviewThreadCard', () => {
    it('renders posted review comments as markdown', () => {
        render(
            <ReviewThreadCard
                thread={{
                    id: 'thread-1',
                    status: 'open',
                    comments: [{
                        id: 'comment-1',
                        author: 'Reviewer',
                        createdAt: 1,
                        body: '**Important** note\n\n- first item'
                    }, {
                        id: 'comment-2',
                        author: 'Author',
                        createdAt: 2,
                        body: 'Follow-up comment'
                    }]
                }}
                collapsed={false}
                onToggleResolved={vi.fn()}
                onResolve={vi.fn()}
                onDelete={vi.fn()}
                onReply={vi.fn()}
            />
        )

        expect(screen.getByText('Important').tagName).toBe('STRONG')
        expect(screen.getByText('first item').tagName).toBe('LI')
        expect(screen.getByText('Follow-up comment')).toBeInTheDocument()
        expect(screen.getByPlaceholderText('Add a comment')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Comment' })).toBeInTheDocument()
    })

    it('allows an open outdated thread to be collapsed when requested', () => {
        render(
            <ReviewThreadCard
                thread={{
                    id: 'thread-1',
                    status: 'open',
                    comments: [{
                        id: 'comment-1',
                        author: 'Reviewer',
                        createdAt: 1,
                        body: 'Outdated comment'
                    }]
                }}
                collapsed={false}
                canCollapse
                metaLabel="Outdated"
                onToggleResolved={vi.fn()}
                onResolve={vi.fn()}
                onDelete={vi.fn()}
                onReply={vi.fn()}
            />
        )

        expect(screen.getByRole('button', { name: 'Collapse' })).toBeInTheDocument()
    })
})
