import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { CanvasAddon } from '@xterm/addon-canvas'
import '@xterm/xterm/css/xterm.css'
import { useTheme } from '@/hooks/useTheme'
import { useTerminalCopyOnSelect } from '@/hooks/useTerminalCopyOnSelect'
import { ensureBuiltinFontLoaded, getFontProvider } from '@/lib/terminalFont'

function resolveThemeColors(isDark: boolean) {
    const styles = getComputedStyle(document.documentElement)
    const background = styles.getPropertyValue('--app-bg').trim() || '#000000'
    const foreground = styles.getPropertyValue('--app-fg').trim() || '#ffffff'
    const selectionBackground = styles.getPropertyValue('--app-subtle-bg').trim() || 'rgba(255, 255, 255, 0.2)'
    const cursor = foreground

    if (isDark) {
        return {
            background,
            foreground: foreground || '#d0d7de',
            cursor,
            selectionBackground,
            black: '#1f2428',
            red: '#c4435b',
            green: '#3f8f5b',
            yellow: '#b98412',
            blue: '#4f8cc9',
            magenta: '#9b72cf',
            cyan: '#2f8f9d',
            white: '#d0d7de',
            brightBlack: '#6e7681',
            brightRed: '#e05d6f',
            brightGreen: '#57ab5a',
            brightYellow: '#c69026',
            brightBlue: '#6cb6ff',
            brightMagenta: '#b083f0',
            brightCyan: '#56d4dd',
            brightWhite: '#f0f6fc'
        }
    }

    return {
        background,
        foreground: foreground || '#24292f',
        cursor,
        selectionBackground,
        black: '#24292f',
        red: '#c93c37',
        green: '#2f7d4a',
        yellow: '#9a6700',
        blue: '#0969da',
        magenta: '#8250df',
        cyan: '#1b7c83',
        white: '#f6f8fa',
        brightBlack: '#57606a',
        brightRed: '#e5534b',
        brightGreen: '#46954a',
        brightYellow: '#b97a00',
        brightBlue: '#218bff',
        brightMagenta: '#a475f9',
        brightCyan: '#3192aa',
        brightWhite: '#ffffff'
    }
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
    onFocusChange?: (focused: boolean) => void
}) {
    const { isDark } = useTheme()
    const { copyOnSelect } = useTerminalCopyOnSelect()
    const containerRef = useRef<HTMLDivElement | null>(null)
    const terminalRef = useRef<Terminal | null>(null)
    const onMountRef = useRef(props.onMount)
    const onResizeRef = useRef(props.onResize)
    const suppressFocusRef = useRef(Boolean(props.suppressFocus))
    const onFocusChangeRef = useRef(props.onFocusChange)
    const copyOnSelectRef = useRef(copyOnSelect)

    useEffect(() => {
        onMountRef.current = props.onMount
    }, [props.onMount])

    useEffect(() => {
        onResizeRef.current = props.onResize
    }, [props.onResize])

    useEffect(() => {
        onFocusChangeRef.current = props.onFocusChange
    }, [props.onFocusChange])

    useEffect(() => {
        copyOnSelectRef.current = copyOnSelect
    }, [copyOnSelect])

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
        const theme = resolveThemeColors(isDark)
        const terminal = new Terminal({
            cursorBlink: true,
            fontFamily: fontProvider.getFontFamily(),
            fontSize: 13,
            scrollback: 0,
            theme,
            rightClickSelectsWord: true,
            macOptionClickForcesSelection: true,
            // This is a real tmux/PTTY byte stream, not a plain log viewer.
            // Converting bare LF to CRLF breaks cursor-driven TUIs and causes stacked redraws.
            convertEol: false,
            customGlyphs: true
        })
        terminalRef.current = terminal
        let selectionCopyTimer: ReturnType<typeof setTimeout> | null = null

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
        const handleFocusIn = () => {
            onFocusChangeRef.current?.(true)
        }
        const handleFocusOut = (event: FocusEvent) => {
            if (event.relatedTarget instanceof Node && container.contains(event.relatedTarget)) {
                return
            }
            onFocusChangeRef.current?.(false)
        }
        container.addEventListener('pointerdown', handlePointerDown, { signal: abortController.signal })
        container.addEventListener('focusin', handleFocusIn, { signal: abortController.signal })
        container.addEventListener('focusout', handleFocusOut, { signal: abortController.signal })

        const observer = new ResizeObserver(() => {
            requestAnimationFrame(() => {
                fitAddon.fit()
                onResizeRef.current?.(terminal.cols, terminal.rows)
            })
        })
        observer.observe(container)

        const selectionDisposable = terminal.onSelectionChange(() => {
            if (!copyOnSelectRef.current) {
                return
            }

            if (selectionCopyTimer) {
                clearTimeout(selectionCopyTimer)
            }

            selectionCopyTimer = setTimeout(() => {
                if (!copyOnSelectRef.current || !terminal.hasSelection()) {
                    return
                }
                const selection = terminal.getSelection()
                if (!selection) {
                    return
                }
                void navigator.clipboard?.writeText(selection).catch(() => {
                    // ignore clipboard permission failures
                })
            }, 120)
        })

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
            if (selectionCopyTimer) {
                clearTimeout(selectionCopyTimer)
            }
            selectionDisposable.dispose()
            fitAddon.dispose()
            webLinksAddon.dispose()
            canvasAddon.dispose()
            terminalRef.current = null
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
            onFocusChangeRef.current?.(false)
            abortController.abort()
        }
    }, [])

    useEffect(() => {
        const terminal = terminalRef.current
        if (!terminal) {
            return
        }
        terminal.options.theme = resolveThemeColors(isDark)
        if (terminal.rows > 0) {
            terminal.refresh(0, terminal.rows - 1)
        }
    }, [isDark])

    return (
        <div
            ref={containerRef}
            className={`terminal-shell-view h-full w-full ${props.className ?? ''}`}
        />
    )
}
