import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react'

export type CodeEditSurfaceHandle = {
    scrollToBottom: () => void
}

function CodeEditSurfaceInner(props: {
    draft: string
    filePath: string
    onChange: (value: string) => void
}, ref: React.Ref<CodeEditSurfaceHandle>) {
    const textareaRef = useRef<HTMLTextAreaElement | null>(null)
    const containerRef = useRef<HTMLDivElement | null>(null)
    const rows = useMemo(() => props.draft.split('\n'), [props.draft])

    useEffect(() => {
        const textarea = textareaRef.current
        if (!textarea) {
            return
        }
        textarea.style.height = '0px'
        textarea.style.height = `${textarea.scrollHeight}px`
    }, [props.draft])

    const scrollToBottom = () => {
        if (!containerRef.current) {
            return
        }
        containerRef.current.scrollTo({
            top: containerRef.current.scrollHeight,
            behavior: 'smooth'
        })
    }

    useImperativeHandle(ref, () => ({
        scrollToBottom,
    }), [])

    return (
        <div className="p-4">
            <div ref={containerRef} className="overflow-auto rounded-[22px] border border-[var(--code-border)] bg-[var(--code-bg)] shadow-[0_18px_44px_-36px_rgba(28,18,10,0.42)]">
                <div className="grid grid-cols-[60px_minmax(0,1fr)] items-start font-mono text-[12.5px] font-normal leading-[1.56] antialiased">
                    <div className="border-r border-[var(--code-border)] bg-[var(--code-gutter-bg)]">
                        {rows.map((_, index) => (
                            <div
                                key={`edit-line-number-${index + 1}`}
                                className="px-2 py-1.5 text-right text-[11px] text-[var(--app-hint)]"
                            >
                                {index + 1}
                            </div>
                        ))}
                    </div>

                    <div className="relative min-w-0 bg-[var(--code-bg)]">
                        <textarea
                            ref={textareaRef}
                            value={props.draft}
                            onChange={(event) => props.onChange(event.target.value)}
                            className="block min-h-full w-full resize-none overflow-hidden bg-transparent px-3 py-1.5 font-mono text-[12.5px] leading-[1.56] text-[var(--app-fg)] caret-[var(--app-fg)] focus:outline-none"
                            spellCheck={false}
                            autoCapitalize="none"
                            autoCorrect="off"
                            style={{ tabSize: 4 }}
                        />
                    </div>
                </div>
            </div>
        </div>
    )
}

export const CodeEditSurface = forwardRef(CodeEditSurfaceInner)
