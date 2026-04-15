import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { CanvasAddon } from '@xterm/addon-canvas'
import '@xterm/xterm/css/xterm.css'
import { ensureBuiltinFontLoaded, getFontProvider } from '@/lib/terminalFont'

function resolveThemeColors(): { background: string; foreground: string; selectionBackground: string } {
    const styles = getComputedStyle(document.documentElement)
    const background = styles.getPropertyValue('--app-bg').trim() || '#000000'
    const foreground = styles.getPropertyValue('--app-fg').trim() || '#ffffff'
    const selectionBackground = styles.getPropertyValue('--app-subtle-bg').trim() || 'rgba(255, 255, 255, 0.2)'
    return { background, foreground, selectionBackground }
}

function configureTerminalTextarea(terminal: Terminal): void {
    const textarea = (terminal as unknown as { textarea?: HTMLTextAreaElement | null }).textarea
    if (!textarea) {
        return
    }

    textarea.spellcheck = false
    textarea.inputMode = 'text'
    textarea.enterKeyHint = 'enter'
    textarea.setAttribute('autocapitalize', 'off')
    textarea.setAttribute('autocomplete', 'off')
    textarea.setAttribute('autocorrect', 'off')
    textarea.setAttribute('data-gramm', 'false')
    textarea.setAttribute('data-gramm_editor', 'false')
    textarea.setAttribute('data-enable-grammarly', 'false')
}

export function TerminalView(props: {
    onMount?: (terminal: Terminal) => void
    onResize?: (cols: number, rows: number) => void
    className?: string
    suppressFocus?: boolean
}) {
    const containerRef = useRef<HTMLDivElement | null>(null)
    const onMountRef = useRef(props.onMount)
    const onResizeRef = useRef(props.onResize)
    const suppressFocusRef = useRef(Boolean(props.suppressFocus))

    useEffect(() => {
        onMountRef.current = props.onMount
    }, [props.onMount])

    useEffect(() => {
        onResizeRef.current = props.onResize
    }, [props.onResize])

    useEffect(() => {
        suppressFocusRef.current = Boolean(props.suppressFocus)
        const terminal = (containerRef.current as (HTMLDivElement & { __xterm?: Terminal | null }) | null)?.__xterm
        if (!terminal) {
            return
        }
        if (props.suppressFocus) {
            terminal.blur()
        }
    }, [props.suppressFocus])

    useEffect(() => {
        const container = containerRef.current
        if (!container) return

        const abortController = new AbortController()

        const fontProvider = getFontProvider()
        const { background, foreground, selectionBackground } = resolveThemeColors()
        const terminal = new Terminal({
            cursorBlink: true,
            fontFamily: fontProvider.getFontFamily(),
            fontSize: 13,
            scrollback: 0,
            theme: {
                background,
                foreground,
                cursor: foreground,
                selectionBackground
            },
            // This is a real tmux/PTTY byte stream, not a plain log viewer.
            // Converting bare LF to CRLF breaks cursor-driven TUIs and causes stacked redraws.
            convertEol: false,
            customGlyphs: true
        })

        const fitAddon = new FitAddon()
        const webLinksAddon = new WebLinksAddon()
        const canvasAddon = new CanvasAddon()
        terminal.loadAddon(fitAddon)
        terminal.loadAddon(webLinksAddon)
        terminal.loadAddon(canvasAddon)
        terminal.open(container)
        ;(container as HTMLDivElement & { __xterm?: Terminal | null }).__xterm = terminal
        configureTerminalTextarea(terminal)
        const handlePointerDown = () => {
            if (suppressFocusRef.current) {
                return
            }
            terminal.focus()
        }
        container.addEventListener('pointerdown', handlePointerDown, { signal: abortController.signal })

        const observer = new ResizeObserver(() => {
            requestAnimationFrame(() => {
                fitAddon.fit()
                onResizeRef.current?.(terminal.cols, terminal.rows)
            })
        })
        observer.observe(container)

        const refreshFont = (forceRemeasure = false) => {
            if (abortController.signal.aborted) return
            const nextFamily = fontProvider.getFontFamily()

            if (forceRemeasure && terminal.options.fontFamily === nextFamily) {
                terminal.options.fontFamily = `${nextFamily}, "__maglev_font_refresh__"`
                requestAnimationFrame(() => {
                    if (abortController.signal.aborted) return
                    terminal.options.fontFamily = nextFamily
                    if (terminal.rows > 0) {
                        terminal.refresh(0, terminal.rows - 1)
                    }
                    fitAddon.fit()
                    onResizeRef.current?.(terminal.cols, terminal.rows)
                })
                return
            }

            terminal.options.fontFamily = nextFamily
            if (terminal.rows > 0) {
                terminal.refresh(0, terminal.rows - 1)
            }
            fitAddon.fit()
            onResizeRef.current?.(terminal.cols, terminal.rows)
        }

        void ensureBuiltinFontLoaded().then(loaded => {
            if (!loaded) return
            refreshFont(true)
        })

        // Cleanup on abort
        abortController.signal.addEventListener('abort', () => {
            observer.disconnect()
            fitAddon.dispose()
            webLinksAddon.dispose()
            canvasAddon.dispose()
            terminal.dispose()
        })

        requestAnimationFrame(() => {
            fitAddon.fit()
            onResizeRef.current?.(terminal.cols, terminal.rows)
            if (!suppressFocusRef.current) {
                terminal.focus()
            }
        })
        onMountRef.current?.(terminal)

        return () => {
            ;(container as HTMLDivElement & { __xterm?: Terminal | null }).__xterm = null
            abortController.abort()
        }
    }, [])

    return (
        <div
            ref={containerRef}
            className={`terminal-shell-view h-full w-full ${props.className ?? ''}`}
        />
    )
}
