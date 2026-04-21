import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MarkdownRenderer } from './MarkdownRenderer'

vi.mock('mermaid', () => ({
    default: {
        initialize: vi.fn(),
        render: vi.fn(async (_id: string, code: string) => ({
            svg: `<svg data-rendered="true"><text>${code}</text></svg>`,
            bindFunctions: vi.fn()
        }))
    }
}))

describe('MarkdownRenderer', () => {
    beforeEach(() => {
        Object.defineProperty(window, 'matchMedia', {
            configurable: true,
            writable: true,
            value: vi.fn().mockReturnValue({
                matches: false,
                media: '',
                onchange: null,
                addListener: vi.fn(),
                removeListener: vi.fn(),
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
                dispatchEvent: vi.fn()
            })
        })
    })

    it('renders standalone markdown without assistant thread context', () => {
        render(<MarkdownRenderer content={`# Notes\n\n- one\n- two\n\n\`\`\`ts\nconst value = 1\n\`\`\``} />)

        expect(screen.getByText('Notes')).toBeInTheDocument()
        expect(screen.getByText('one')).toBeInTheDocument()
        expect(screen.getByText('two')).toBeInTheDocument()
        expect(screen.getByText('const value = 1')).toBeInTheDocument()
    })

    it('renders mermaid diagrams from fenced code blocks', async () => {
        render(<MarkdownRenderer content={`# Diagram\n\n\`\`\`mermaid\ngraph TD\nA-->B\n\`\`\``} />)

        await waitFor(() => expect(screen.getByTestId('mermaid-diagram')).toBeInTheDocument())
        expect(screen.getByText('Diagram')).toBeInTheDocument()
    })
})
