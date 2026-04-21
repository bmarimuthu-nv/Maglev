import { type ComponentPropsWithoutRef, type ReactNode, useEffect, useId, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import { MARKDOWN_PLUGINS } from '@/components/markdown/markdown-text'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { useTheme } from '@/hooks/useTheme'
import { useShikiHighlighter } from '@/lib/shiki'
import { cn } from '@/lib/utils'
import { CheckIcon, CopyIcon } from '@/components/icons'

interface MarkdownRendererProps {
    content: string
    components?: Components
}

function extractText(children: ReactNode): string {
    if (typeof children === 'string') {
        return children
    }
    if (typeof children === 'number') {
        return String(children)
    }
    if (!children || typeof children === 'boolean') {
        return ''
    }
    if (Array.isArray(children)) {
        return children.map(extractText).join('')
    }
    if (typeof children === 'object' && 'props' in children) {
        return extractText((children as { props?: { children?: ReactNode } }).props?.children)
    }
    return ''
}

function CodeHeader(props: { code: string; language?: string }) {
    const { copied, copy } = useCopyToClipboard()
    const language = props.language && props.language !== 'unknown' ? props.language : ''

    return (
        <div className="aui-md-codeheader flex items-center justify-between rounded-t-md bg-[var(--app-code-bg)] px-2 py-1">
            <div className="min-w-0 flex-1 pr-2 text-xs font-mono text-[var(--app-hint)]">
                {language}
            </div>
            <button
                type="button"
                onClick={() => copy(props.code)}
                className="shrink-0 rounded p-1 text-[var(--app-hint)] transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]"
                title="Copy"
            >
                {copied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
            </button>
        </div>
    )
}

function StandaloneCodeBlock(props: { code: string; language?: string }) {
    const highlighted = useShikiHighlighter(props.code, props.language)

    return (
        <div className="aui-md-codeblock min-w-0 w-full max-w-full overflow-hidden rounded-md">
            <CodeHeader code={props.code} language={props.language} />
            <div className="min-w-0 w-full max-w-full overflow-x-auto overflow-y-hidden rounded-b-md bg-[var(--app-code-bg)]">
                <pre className="shiki m-0 w-max min-w-full p-2 text-sm font-mono">
                    <code className="block">{highlighted ?? props.code}</code>
                </pre>
            </div>
        </div>
    )
}

function readThemeColor(name: string, fallback: string): string {
    if (typeof window === 'undefined') {
        return fallback
    }
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    return value || fallback
}

function MermaidBlock(props: { code: string }) {
    const { isDark } = useTheme()
    const containerRef = useRef<HTMLDivElement | null>(null)
    const diagramId = useId().replace(/:/g, '-')
    const [svg, setSvg] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        let active = true

        async function renderDiagram() {
            setSvg(null)
            setError(null)

            try {
                const mermaidModule = await import('mermaid')
                const mermaid = mermaidModule.default
                const appBg = readThemeColor('--app-bg', isDark ? '#1c1c1e' : '#ffffff')
                const appFg = readThemeColor('--app-fg', isDark ? '#ffffff' : '#111827')
                const appHint = readThemeColor('--app-hint', isDark ? '#8e8e93' : '#6b7280')
                const appLink = readThemeColor('--app-link', isDark ? '#ffffff' : '#111827')
                const appBorder = readThemeColor('--app-border', isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.16)')
                const appSecondaryBg = readThemeColor('--app-secondary-bg', isDark ? '#2C2C2E' : '#f3f4f6')
                const appSubtleBg = readThemeColor('--app-subtle-bg', isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)')
                mermaid.initialize({
                    startOnLoad: false,
                    securityLevel: 'strict',
                    theme: 'base',
                    themeVariables: {
                        background: appBg,
                        fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                        primaryColor: appSecondaryBg,
                        primaryTextColor: appFg,
                        primaryBorderColor: appBorder,
                        secondaryColor: appSubtleBg,
                        secondaryTextColor: appFg,
                        secondaryBorderColor: appBorder,
                        tertiaryColor: appBg,
                        tertiaryTextColor: appFg,
                        tertiaryBorderColor: appBorder,
                        mainBkg: appSecondaryBg,
                        secondBkg: appSubtleBg,
                        tertiaryBkg: appBg,
                        nodeBkg: appSecondaryBg,
                        nodeTextColor: appFg,
                        nodeBorder: appBorder,
                        clusterBkg: appBg,
                        clusterBorder: appBorder,
                        defaultLinkColor: appHint,
                        lineColor: appHint,
                        textColor: appFg,
                        titleColor: appFg,
                        edgeLabelBackground: appBg,
                        actorBkg: appSecondaryBg,
                        actorBorder: appBorder,
                        actorTextColor: appFg,
                        labelBoxBkgColor: appBg,
                        labelTextColor: appFg,
                        loopTextColor: appFg,
                        signalColor: appHint,
                        signalTextColor: appFg,
                        noteBkgColor: appBg,
                        noteTextColor: appFg,
                        noteBorderColor: appBorder,
                        activationBorderColor: appBorder,
                        activationBkgColor: appSecondaryBg,
                        sequenceNumberColor: appBg,
                        cScale0: appSecondaryBg,
                        cScaleLabel0: appFg,
                        cScale1: appSubtleBg,
                        cScaleLabel1: appFg,
                        cScale2: appBg,
                        cScaleLabel2: appFg,
                        pie1: appLink,
                        pie2: appHint,
                        pie3: appSecondaryBg,
                        pie4: appSubtleBg,
                        pie5: appBorder,
                    },
                })
                const { svg: renderedSvg, bindFunctions } = await mermaid.render(`maglev-mermaid-${diagramId}`, props.code)
                if (!active) {
                    return
                }
                setSvg(renderedSvg)
                if (bindFunctions) {
                    requestAnimationFrame(() => {
                        if (containerRef.current) {
                            bindFunctions(containerRef.current)
                        }
                    })
                }
            } catch (cause) {
                if (!active) {
                    return
                }
                setError(cause instanceof Error ? cause.message : 'Failed to render Mermaid diagram')
            }
        }

        void renderDiagram()

        return () => {
            active = false
        }
    }, [diagramId, isDark, props.code])

    return (
        <div className="aui-md-mermaid min-w-0 w-full max-w-full overflow-hidden rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] shadow-sm">
            <div className="flex items-center justify-between border-b border-[var(--app-border)] bg-[var(--app-secondary-bg)] px-3 py-2">
                <div className="text-xs font-medium uppercase tracking-wide text-[var(--app-hint)]">Mermaid</div>
                <div className="text-[11px] text-[var(--app-hint)]">{svg ? 'Rendered' : error ? 'Error' : 'Rendering…'}</div>
            </div>
            {error ? (
                <div className="space-y-3 p-3">
                    <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
                        {error}
                    </div>
                    <StandaloneCodeBlock code={props.code} language="mermaid" />
                </div>
            ) : svg ? (
                <div
                    ref={containerRef}
                    data-testid="mermaid-diagram"
                    className="overflow-x-auto px-4 py-4 [&>svg]:mx-auto [&>svg]:h-auto [&>svg]:max-w-full"
                    dangerouslySetInnerHTML={{ __html: svg }}
                />
            ) : (
                <div className="px-4 py-6 text-sm text-[var(--app-hint)]">Rendering diagram…</div>
            )}
        </div>
    )
}

function Code(props: ComponentPropsWithoutRef<'code'>) {
    const language = /language-([\w-]+)/.exec(props.className ?? '')?.[1]
    const code = extractText(props.children).replace(/\n$/, '')

    if (language === 'mermaid') {
        return <MermaidBlock code={code} />
    }

    if (language) {
        return (
            <StandaloneCodeBlock
                language={language}
                code={code}
            />
        )
    }

    return (
        <code
            {...props}
            className={cn(
                'aui-md-code break-words rounded bg-[var(--app-inline-code-bg)] px-[0.3em] py-[0.1em] font-mono text-[0.9em]',
                props.className
            )}
        />
    )
}

function Pre(props: ComponentPropsWithoutRef<'pre'>) {
    return (
        <div className="aui-md-pre-wrapper min-w-0 w-full max-w-full overflow-x-auto overflow-y-hidden">
            <pre
                {...props}
                className={cn(
                    'aui-md-pre m-0 w-max min-w-full rounded-md bg-[var(--app-code-bg)] p-2 text-sm',
                    props.className
                )}
            />
        </div>
    )
}

function A(props: ComponentPropsWithoutRef<'a'>) {
    const rel = props.target === '_blank' ? (props.rel ?? 'noreferrer') : props.rel

    return (
        <a
            {...props}
            rel={rel}
            className={cn('aui-md-a text-[var(--app-link)] underline', props.className)}
        />
    )
}

function Paragraph(props: ComponentPropsWithoutRef<'p'>) {
    return <p {...props} className={cn('aui-md-p my-4 leading-7', props.className)} />
}

function Blockquote(props: ComponentPropsWithoutRef<'blockquote'>) {
    return (
        <blockquote
            {...props}
            className={cn(
                'aui-md-blockquote my-5 border-l-4 border-[var(--app-hint)] pl-4 opacity-85',
                props.className
            )}
        />
    )
}

function UnorderedList(props: ComponentPropsWithoutRef<'ul'>) {
    return <ul {...props} className={cn('aui-md-ul my-4 list-disc space-y-1.5 pl-6', props.className)} />
}

function OrderedList(props: ComponentPropsWithoutRef<'ol'>) {
    return <ol {...props} className={cn('aui-md-ol my-4 list-decimal space-y-1.5 pl-6', props.className)} />
}

function ListItem(props: ComponentPropsWithoutRef<'li'>) {
    return <li {...props} className={cn('aui-md-li', props.className)} />
}

function Hr(props: ComponentPropsWithoutRef<'hr'>) {
    return <hr {...props} className={cn('aui-md-hr my-6 border-[var(--app-divider)]', props.className)} />
}

function Table(props: ComponentPropsWithoutRef<'table'>) {
    const { className, ...rest } = props

    return (
        <div className="aui-md-table-wrapper my-5 max-w-full overflow-x-auto">
            <table {...rest} className={cn('aui-md-table w-full border-collapse', className)} />
        </div>
    )
}

function Thead(props: ComponentPropsWithoutRef<'thead'>) {
    return <thead {...props} className={cn('aui-md-thead', props.className)} />
}

function Tbody(props: ComponentPropsWithoutRef<'tbody'>) {
    return <tbody {...props} className={cn('aui-md-tbody', props.className)} />
}

function Tr(props: ComponentPropsWithoutRef<'tr'>) {
    return <tr {...props} className={cn('aui-md-tr', props.className)} />
}

function Th(props: ComponentPropsWithoutRef<'th'>) {
    return (
        <th
            {...props}
            className={cn(
                'aui-md-th border border-[var(--app-border)] bg-[var(--app-subtle-bg)] px-2 py-1 text-left font-semibold',
                props.className
            )}
        />
    )
}

function Td(props: ComponentPropsWithoutRef<'td'>) {
    return <td {...props} className={cn('aui-md-td border border-[var(--app-border)] px-2 py-1', props.className)} />
}

function H1(props: ComponentPropsWithoutRef<'h1'>) {
    return <h1 {...props} className={cn('aui-md-h1 mb-4 mt-2 text-2xl font-semibold leading-tight tracking-tight', props.className)} />
}

function H2(props: ComponentPropsWithoutRef<'h2'>) {
    return <h2 {...props} className={cn('aui-md-h2 mb-3 mt-8 text-xl font-semibold leading-tight tracking-tight', props.className)} />
}

function H3(props: ComponentPropsWithoutRef<'h3'>) {
    return <h3 {...props} className={cn('aui-md-h3 mb-3 mt-6 text-lg font-semibold leading-snug', props.className)} />
}

function H4(props: ComponentPropsWithoutRef<'h4'>) {
    return <h4 {...props} className={cn('aui-md-h4 mb-2 mt-5 text-base font-semibold leading-snug', props.className)} />
}

function H5(props: ComponentPropsWithoutRef<'h5'>) {
    return <h5 {...props} className={cn('aui-md-h5 mb-2 mt-4 text-sm font-semibold uppercase tracking-wide', props.className)} />
}

function H6(props: ComponentPropsWithoutRef<'h6'>) {
    return <h6 {...props} className={cn('aui-md-h6 mb-2 mt-4 text-sm font-semibold uppercase tracking-wide text-[var(--app-hint)]', props.className)} />
}

function Strong(props: ComponentPropsWithoutRef<'strong'>) {
    return <strong {...props} className={cn('aui-md-strong font-semibold', props.className)} />
}

function Em(props: ComponentPropsWithoutRef<'em'>) {
    return <em {...props} className={cn('aui-md-em italic', props.className)} />
}

function Image(props: ComponentPropsWithoutRef<'img'>) {
    return <img {...props} className={cn('aui-md-img max-w-full rounded', props.className)} />
}

const defaultComponents: Components = {
    pre: Pre,
    code: Code,
    h1: H1,
    h2: H2,
    h3: H3,
    h4: H4,
    h5: H5,
    h6: H6,
    a: A,
    p: Paragraph,
    strong: Strong,
    em: Em,
    blockquote: Blockquote,
    ul: UnorderedList,
    ol: OrderedList,
    li: ListItem,
    hr: Hr,
    table: Table,
    thead: Thead,
    tbody: Tbody,
    tr: Tr,
    th: Th,
    td: Td,
    img: Image,
}

export function MarkdownRenderer(props: MarkdownRendererProps) {
    const mergedComponents = props.components
        ? { ...defaultComponents, ...props.components }
        : defaultComponents

    return (
        <div className={cn('aui-md mx-auto min-w-0 max-w-4xl break-words rounded-2xl border border-[var(--app-border)] bg-[var(--app-secondary-bg)] px-6 py-6 text-base leading-7 shadow-sm')}>
            <ReactMarkdown
                remarkPlugins={MARKDOWN_PLUGINS}
                components={mergedComponents}
            >
                {props.content}
            </ReactMarkdown>
        </div>
    )
}
