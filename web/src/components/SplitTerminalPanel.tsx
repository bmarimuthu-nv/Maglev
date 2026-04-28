import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Terminal } from '@xterm/xterm'
import { useAppContext } from '@/lib/app-context'
import { useSession } from '@/hooks/queries/useSession'
import { useTerminalSocket } from '@/hooks/useTerminalSocket'
import { getOrCreateTerminalId } from '@/lib/terminal-session-store'
import { TerminalView } from '@/components/Terminal/TerminalView'

const TERMINAL_TAKEOVER_MESSAGE = 'Terminal is attached in another browser. Reconnect here to take over.'

function CloseIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
    )
}

function ConnectionDot(props: { status: string }) {
    const color = props.status === 'connected'
        ? 'bg-emerald-500'
        : props.status === 'connecting'
        ? 'bg-amber-400 animate-pulse'
        : 'bg-[var(--app-hint)]'
    return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />
}

export function SplitTerminalPanel(props: {
    sessionId: string
    onClose: () => Promise<void> | void
    onNavigate?: (sessionId: string) => void
    onUnsplit?: (sessionId: string) => Promise<void> | void
    isClosing?: boolean
    starting?: boolean
    title?: string
    subtitle?: string
}) {
    const { sessionId, onClose, onNavigate, onUnsplit, isClosing = false, starting = false, title, subtitle } = props
    const { api, token, baseUrl } = useAppContext()
    const { session, isLoading: sessionLoading } = useSession(api, sessionId)
    const isShellSession = session?.metadata?.flavor === 'shell'
    const [isTerminalFocused, setIsTerminalFocused] = useState(false)

    const terminalId = useMemo(() => {
        if (sessionLoading) return null
        if (session?.metadata?.shellTerminalId) return session.metadata.shellTerminalId
        if (isShellSession) return null
        return getOrCreateTerminalId(baseUrl, sessionId)
    }, [baseUrl, isShellSession, sessionId, sessionLoading, session?.metadata?.shellTerminalId])

    const terminalRef = useRef<Terminal | null>(null)
    const inputDisposableRef = useRef<{ dispose: () => void } | null>(null)
    const connectOnceRef = useRef(false)
    const lastSizeRef = useRef<{ cols: number; rows: number } | null>(null)

    const {
        state: terminalState,
        connect,
        reconnectView,
        write,
        resize,
        disconnect,
        onOutput,
        onExit,
        takeOver,
    } = useTerminalSocket({
        token,
        sessionId,
        terminalId,
        baseUrl,
        createIfMissing: sessionLoading ? false : !isShellSession
    })

    useEffect(() => {
        onOutput((data) => {
            terminalRef.current?.write(data)
        })
    }, [onOutput])

    useEffect(() => {
        onExit(() => {
            terminalRef.current?.write('\r\n[process exited]')
            connectOnceRef.current = false
        })
    }, [onExit])

    const handleTerminalMount = useCallback(
        (terminal: Terminal) => {
            terminalRef.current = terminal
            inputDisposableRef.current?.dispose()
            inputDisposableRef.current = terminal.onData((data) => {
                write(data)
            })
            if (terminalState.status === 'connected') {
                terminal.focus()
            }
        },
        [terminalState.status, write]
    )

    const errorMessage = terminalState.status === 'error' ? terminalState.error : null
    const canTakeOver = errorMessage === TERMINAL_TAKEOVER_MESSAGE

    const handleResize = useCallback(
        (cols: number, rows: number) => {
            lastSizeRef.current = { cols, rows }
            if (!session?.active || !terminalId || sessionLoading) return
            if (canTakeOver) return
            if (!connectOnceRef.current) {
                connectOnceRef.current = true
                reconnectView(cols, rows)
            } else {
                resize(cols, rows)
            }
        },
        [session?.active, canTakeOver, reconnectView, resize, sessionLoading, terminalId]
    )

    useEffect(() => {
        if (!session?.active || !terminalId || sessionLoading) return
        if (connectOnceRef.current) return
        const size = lastSizeRef.current
        if (!size) return
        if (canTakeOver) return
        connectOnceRef.current = true
        connect(size.cols, size.rows)
    }, [session?.active, canTakeOver, connect, sessionLoading, terminalId])

    useEffect(() => {
        connectOnceRef.current = false
    }, [sessionId])

    useEffect(() => {
        if (session?.active === false) {
            disconnect()
            connectOnceRef.current = false
        }
    }, [disconnect, session?.active])

    useEffect(() => {
        if (terminalState.status === 'error') {
            if (!canTakeOver) {
                connectOnceRef.current = false
            }
            return
        }
    }, [canTakeOver, terminalState.status])

    useEffect(() => {
        if (terminalState.status !== 'error' || canTakeOver) {
            return
        }
        if (!session?.active || !terminalId || sessionLoading) {
            return
        }
        const size = lastSizeRef.current
        if (!size || connectOnceRef.current) {
            return
        }

        const timer = window.setTimeout(() => {
            if (connectOnceRef.current) {
                return
            }
            connectOnceRef.current = true
            connect(size.cols, size.rows)
        }, 250)

        return () => window.clearTimeout(timer)
    }, [canTakeOver, connect, session?.active, sessionLoading, terminalId, terminalState.status])

    useEffect(() => {
        if (terminalState.status !== 'connected') {
            return
        }
        const frame = requestAnimationFrame(() => {
            terminalRef.current?.focus()
        })
        return () => cancelAnimationFrame(frame)
    }, [terminalState.status])

    useEffect(() => {
        return () => {
            inputDisposableRef.current?.dispose()
            connectOnceRef.current = false
        }
    }, [])

    const sessionName = session?.metadata?.name ?? session?.metadata?.summary?.text ?? sessionId.slice(0, 8)
    const panelTitle = title ?? (session?.metadata?.childRole === 'review-terminal' ? 'Review terminal' : sessionName)
    const isSplitTerminalChild = session?.metadata?.childRole === 'split-terminal'

    const startupPending = starting || sessionLoading || !session || (isShellSession && (!session.metadata?.shellTerminalId || session.metadata?.shellTerminalState !== 'ready'))

    return (
        <div className="flex h-full w-full flex-col overflow-hidden p-3">
            <div
                className={`flex h-full w-full flex-col overflow-hidden rounded-xl border bg-[var(--app-bg)] transition-[border-color,box-shadow] duration-150 ${
                    isTerminalFocused
                        ? 'border-[var(--app-link)] shadow-[0_0_0_1px_var(--app-link),0_12px_32px_rgba(37,99,235,0.10)]'
                        : 'border-[var(--app-border)]'
                }`}
            >
                <div className="flex items-center gap-2 border-b border-[var(--app-border)] px-3 py-2">
                    <ConnectionDot status={terminalState.status} />
                    <div className="min-w-0 flex-1">
                        <div className="truncate text-[12px] font-medium text-[var(--app-fg)]">
                            {panelTitle}
                        </div>
                        {subtitle ? (
                            <div className="truncate text-[10px] text-[var(--app-hint)]">{subtitle}</div>
                        ) : null}
                    </div>
                    {isSplitTerminalChild && onUnsplit ? (
                        <button
                            type="button"
                            onClick={() => {
                                void onUnsplit(sessionId)
                            }}
                            className="shrink-0 rounded-full border border-[var(--app-border)] px-2.5 py-1 text-[10px] font-medium text-[var(--app-fg)] transition-colors hover:bg-[var(--app-secondary-bg)]"
                            title={`Unsplit ${sessionName}`}
                        >
                            Unsplit
                        </button>
                    ) : onNavigate ? (
                        <button
                            type="button"
                            onClick={() => onNavigate(sessionId)}
                            className="shrink-0 rounded-full border border-[var(--app-border)] px-2.5 py-1 text-[10px] font-medium text-[var(--app-fg)] transition-colors hover:bg-[var(--app-secondary-bg)]"
                            title={`Open ${sessionName} in the full terminal view`}
                        >
                            Open full
                        </button>
                    ) : null}
                    <button
                        type="button"
                        onClick={() => {
                            void onClose()
                        }}
                        disabled={isClosing}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-[var(--app-hint)]"
                        title={isClosing ? 'Closing split…' : 'Close split'}
                    >
                        <CloseIcon />
                    </button>
                </div>
                {errorMessage ? (
                    <div className="border-b border-[var(--app-badge-error-border)] bg-[var(--app-badge-error-bg)] px-3 py-2 text-xs text-[var(--app-badge-error-text)]">
                        <div>{errorMessage}</div>
                        {canTakeOver ? (
                            <div className="mt-2">
                                <button
                                    type="button"
                                    onClick={takeOver}
                                    className="rounded-full border border-[var(--app-badge-error-border)] px-3 py-1 font-medium transition-colors hover:bg-[var(--app-badge-error-bg)]"
                                >
                                    Take over here
                                </button>
                            </div>
                        ) : null}
                    </div>
                ) : startupPending ? (
                    <div className="border-b border-[var(--app-border)] bg-[var(--app-subtle-bg)] px-3 py-2 text-xs text-[var(--app-hint)]">
                        Starting review shell…
                    </div>
                ) : null}
                <div className="flex-1 overflow-hidden p-2">
                    <TerminalView
                        onMount={handleTerminalMount}
                        onResize={handleResize}
                        onFocusChange={setIsTerminalFocused}
                        className="h-full w-full"
                    />
                </div>
            </div>
        </div>
    )
}
