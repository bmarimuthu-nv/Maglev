import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MarkdownRenderer } from './MarkdownRenderer'

const mermaidInitialize = vi.fn()
const mermaidRender = vi.fn(async (_id: string, code: string) => ({
    svg: `<svg data-rendered="true"><text>${code}</text></svg>`,
    bindFunctions: vi.fn()
}))

vi.mock('mermaid', () => ({
    default: {
        initialize: mermaidInitialize,
        render: mermaidRender
    }
}))

describe('MarkdownRenderer', () => {
    beforeEach(() => {
        mermaidInitialize.mockClear()
        mermaidRender.mockClear()
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
        expect(screen.getByTestId('mermaid-diagram').innerHTML).toContain('data-maglev-mermaid-contrast="true"')
    })

    it('configures Mermaid with distinct node fill and text colors', async () => {
        render(<MarkdownRenderer content={`\`\`\`mermaid\ngraph TD\nA-->B\n\`\`\``} />)

        await waitFor(() => expect(mermaidInitialize).toHaveBeenCalled())
        const initConfig = mermaidInitialize.mock.calls.at(-1)?.[0]
        expect(initConfig?.themeVariables?.primaryColor).toBeTruthy()
        expect(initConfig?.themeVariables?.primaryTextColor).toBeTruthy()
        expect(initConfig?.themeVariables?.primaryColor).not.toBe(initConfig?.themeVariables?.primaryTextColor)
        expect(initConfig?.themeVariables?.noteBkgColor).not.toBe(initConfig?.themeVariables?.noteTextColor)
    })
})
