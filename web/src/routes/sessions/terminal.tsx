import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import type { Terminal } from '@xterm/xterm'
import { useAppContext } from '@/lib/app-context'
import { useAppGoBack } from '@/hooks/useAppGoBack'
import { useSession } from '@/hooks/queries/useSession'
import { useSessions } from '@/hooks/queries/useSessions'
import { useTerminalSocket } from '@/hooks/useTerminalSocket'
import { useLongPress } from '@/hooks/useLongPress'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { useSessionFileSearch } from '@/hooks/queries/useSessionFileSearch'
import { rankFiles } from '@/lib/file-search'
import { getOpenFileShortcut, matchShortcutEvent } from '@/lib/open-file-shortcut'
import { useTranslation } from '@/lib/use-translation'
import { getOrCreateTerminalId } from '@/lib/terminal-session-store'
import { useAutoScroll } from '@/hooks/useAutoScroll'
import { FilePreviewPanel } from '@/components/FilePreviewPanel'
import { SplitTerminalPanel } from '@/components/SplitTerminalPanel'
import { TerminalView } from '@/components/Terminal/TerminalView'
import { LoadingState } from '@/components/LoadingState'
import { Button } from '@/components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from '@/components/ui/dialog'

const TERMINAL_TAKEOVER_MESSAGE = 'Terminal is attached in another browser. Reconnect here to take over.'
const SPLIT_TERMINAL_WIDTH_KEY = 'maglev:splitTerminalWidth'
const SPLIT_TERMINAL_DEFAULT_WIDTH = 480
const SPLIT_TERMINAL_MIN_WIDTH = 280
const SPLIT_TERMINAL_MAX_WIDTH = 900
const FILE_PREVIEW_WIDTH_KEY = 'maglev:filePreviewWidth'
const FILE_PREVIEW_DEFAULT_WIDTH = 480
const FILE_PREVIEW_MIN_WIDTH = 280
const FILE_PREVIEW_MAX_WIDTH = 800
function BackIcon() {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <polyline points="15 18 9 12 15 6" />
        </svg>
    )
}

function ConnectionIndicator(props: { status: 'idle' | 'connecting' | 'connected' | 'error' }) {
    const isConnected = props.status === 'connected'
    const isConnecting = props.status === 'connecting'
    const label = isConnected ? 'Connected' : isConnecting ? 'Connecting' : 'Offline'
    const colorClass = isConnected
        ? 'bg-emerald-500'
        : isConnecting
          ? 'bg-amber-400 animate-pulse'
          : 'bg-[var(--app-hint)]'

    return (
        <div className="flex items-center" aria-label={label} title={label} role="status">
            <span className={`h-2.5 w-2.5 rounded-full ${colorClass}`} />
        </div>
    )
}

function getTerminalBufferText(terminal: Terminal | null): string {
    if (!terminal) {
        return ''
    }

    if (typeof terminal.hasSelection === 'function' && terminal.hasSelection()) {
        return terminal.getSelection()
    }

    const lines: string[] = []
    const buffer = terminal.buffer.active
    for (let i = 0; i < buffer.length; i++) {
        const line = buffer.getLine(i)
        if (!line) {
            continue
        }
        lines.push(line.translateToString(true))
    }
    return lines.join('\n').trim()
}

type QuickInput = {
    label: string
    sequence?: string
    description: string
    modifier?: 'ctrl' | 'alt'
    popup?: {
        label: string
        sequence: string
        description: string
    }
}

type ModifierState = {
    ctrl: boolean
    alt: boolean
}

function applyModifierState(sequence: string, state: ModifierState): string {
    let modified = sequence
    if (state.alt) {
        modified = `\u001b${modified}`
    }
    if (state.ctrl && modified.length === 1) {
        const code = modified.toUpperCase().charCodeAt(0)
        if (code >= 64 && code <= 95) {
            modified = String.fromCharCode(code - 64)
        }
    }
    return modified
}

function shouldResetModifiers(sequence: string, state: ModifierState): boolean {
    if (!sequence) {
        return false
    }
    return state.ctrl || state.alt
}

const QUICK_INPUT_ROWS: QuickInput[][] = [
    [
        { label: 'Esc', sequence: '\u001b', description: 'Escape' },
        {
            label: '/',
            sequence: '/',
            description: 'Forward slash',
            popup: { label: '?', sequence: '?', description: 'Question mark' },
        },
        {
            label: '-',
            sequence: '-',
            description: 'Hyphen',
            popup: { label: '|', sequence: '|', description: 'Pipe' },
        },
        { label: 'Enter', sequence: '\r', description: 'Enter' },
        { label: '↑', sequence: '\u001b[A', description: 'Arrow up' },
        { label: 'End', sequence: '\u001b[F', description: 'End' },
        { label: 'PgUp', sequence: '\u001b[5~', description: 'Page up' },
    ],
    [
        { label: 'Tab', sequence: '\t', description: 'Tab' },
        { label: 'Ctrl', description: 'Control', modifier: 'ctrl' },
        { label: 'Alt', description: 'Alternate', modifier: 'alt' },
        { label: '←', sequence: '\u001b[D', description: 'Arrow left' },
        { label: '↓', sequence: '\u001b[B', description: 'Arrow down' },
        { label: '→', sequence: '\u001b[C', description: 'Arrow right' },
        { label: 'PgDn', sequence: '\u001b[6~', description: 'Page down' },
    ],
]

function QuickKeyButton(props: {
    input: QuickInput
    disabled: boolean
    isActive: boolean
    onPress: (sequence: string) => void
    onToggleModifier: (modifier: 'ctrl' | 'alt') => void
}) {
    const { input, disabled, isActive, onPress, onToggleModifier } = props
    const modifier = input.modifier
    const popupSequence = input.popup?.sequence
    const popupDescription = input.popup?.description
    const hasPopup = Boolean(popupSequence)
    const longPressDisabled = disabled || Boolean(modifier) || !hasPopup

    const handleClick = useCallback(() => {
        if (modifier) {
            onToggleModifier(modifier)
            return
        }
        onPress(input.sequence ?? '')
    }, [modifier, onToggleModifier, onPress, input.sequence])

    const handlePointerDown = useCallback((event: PointerEvent<HTMLButtonElement>) => {
        if (event.pointerType === 'touch') {
            event.preventDefault()
        }
    }, [])

    const longPressHandlers = useLongPress({
        onLongPress: () => {
            if (popupSequence && !modifier) {
                onPress(popupSequence)
            }
        },
        onClick: handleClick,
        disabled: longPressDisabled,
    })

    return (
        <button
            type="button"
            {...longPressHandlers}
            onPointerDown={handlePointerDown}
            disabled={disabled}
            aria-pressed={modifier ? isActive : undefined}
            className={`flex-1 border-l border-[var(--app-border)] px-2 py-1.5 text-xs font-medium text-[var(--app-fg)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-button)] focus-visible:ring-inset disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent first:border-l-0 active:bg-[var(--app-subtle-bg)] sm:px-3 sm:text-sm ${
                isActive ? 'bg-[var(--app-link)] text-[var(--app-bg)]' : 'hover:bg-[var(--app-subtle-bg)]'
            }`}
            aria-label={input.description}
            title={popupDescription ? `${input.description} (long press: ${popupDescription})` : input.description}
        >
            {input.label}
        </button>
    )
}

export default function TerminalPage() {
    const { t } = useTranslation()
    const { sessionId } = useParams({ from: '/sessions/$sessionId/terminal' })
    const { api, token, baseUrl } = useAppContext()
    const navigate = useNavigate()
    const goBack = useAppGoBack()
    const { session, isLoading: sessionLoading, refetch: refetchSession } = useSession(api, sessionId)
    const { sessions: allSessions } = useSessions(api)
    const loadedSessionId = session?.id ?? null
    const isShellSession = session?.metadata?.flavor === 'shell'
    const terminalId = useMemo(
        () => {
            if (sessionLoading) {
                return null
            }
            if (session?.metadata?.shellTerminalId) {
                return session.metadata.shellTerminalId
            }
            if (isShellSession) {
                return null
            }
            return getOrCreateTerminalId(baseUrl, sessionId)
        },
        [baseUrl, isShellSession, sessionId, sessionLoading, session?.metadata?.shellTerminalId]
    )
    const terminalRef = useRef<Terminal | null>(null)
    const inputDisposableRef = useRef<{ dispose: () => void } | null>(null)
    const connectOnceRef = useRef(false)
    const lastSizeRef = useRef<{ cols: number; rows: number } | null>(null)
    const modifierStateRef = useRef<ModifierState>({ ctrl: false, alt: false })
    const touchModeRef = useRef<{ startY: number | null; active: boolean }>({ startY: null, active: false })
    const scrollAccumRef = useRef<{ delta: number; timer: ReturnType<typeof setTimeout> | null }>({ delta: 0, timer: null })
    const tmuxCopyModeActiveRef = useRef(false)
    const { autoScroll } = useAutoScroll()
    const [exitInfo, setExitInfo] = useState<{ code: number | null; signal: string | null } | null>(null)
    const [ctrlActive, setCtrlActive] = useState(false)
    const [altActive, setAltActive] = useState(false)
    const [tmuxCopyModeActive, setTmuxCopyModeActive] = useState(false)
    const [keyboardVisible, setKeyboardVisible] = useState(false)
    const [pasteDialogOpen, setPasteDialogOpen] = useState(false)
    const [manualPasteText, setManualPasteText] = useState('')
    const [textDialogOpen, setTextDialogOpen] = useState(false)
    const [terminalTextSnapshot, setTerminalTextSnapshot] = useState('')
    const [notesDialogOpen, setNotesDialogOpen] = useState(false)
    const [notesSetupOpen, setNotesSetupOpen] = useState(false)
    const [notesSetupSaving, setNotesSetupSaving] = useState(false)
    const [notesContent, setNotesContent] = useState('')
    const [notesSavedContent, setNotesSavedContent] = useState('')
    const [notesLoading, setNotesLoading] = useState(false)
    const [notesSaving, setNotesSaving] = useState(false)
    const [notesError, setNotesError] = useState<string | null>(null)
    const [notesLoaded, setNotesLoaded] = useState(false)
    const [notesSearchQuery, setNotesSearchQuery] = useState('')
    const [notesSearchMatchCount, setNotesSearchMatchCount] = useState(0)
    const [openFileDialogOpen, setOpenFileDialogOpen] = useState(false)
    const [openFileQuery, setOpenFileQuery] = useState('')
    const [openFileActiveIndex, setOpenFileActiveIndex] = useState(0)
    const [previewFilePath, setPreviewFilePath] = useState<string | null>(null)
    const [previewPanelWidth, setPreviewPanelWidth] = useState(() => {
        try {
            const saved = localStorage.getItem(FILE_PREVIEW_WIDTH_KEY)
            return saved ? Math.max(FILE_PREVIEW_MIN_WIDTH, Math.min(FILE_PREVIEW_MAX_WIDTH, Number(saved))) : FILE_PREVIEW_DEFAULT_WIDTH
        } catch { return FILE_PREVIEW_DEFAULT_WIDTH }
    })
    const [splitSessionId, setSplitSessionId] = useState<string | null>(null)
    const [splitPanelWidth, setSplitPanelWidth] = useState(() => {
        try {
            const saved = localStorage.getItem(SPLIT_TERMINAL_WIDTH_KEY)
            return saved ? Math.max(SPLIT_TERMINAL_MIN_WIDTH, Math.min(SPLIT_TERMINAL_MAX_WIDTH, Number(saved))) : SPLIT_TERMINAL_DEFAULT_WIDTH
        } catch { return SPLIT_TERMINAL_DEFAULT_WIDTH }
    })

    // Auto-restore split pane: find an active child session of the current session
    useEffect(() => {
        if (splitSessionId || !loadedSessionId) return
        const child = allSessions.find(
            (s) => s.active && s.metadata?.parentSessionId === loadedSessionId
        )
        if (child) {
            setSplitSessionId(child.id)
        }
    }, [allSessions, loadedSessionId, splitSessionId])

    const { copied, copy } = useCopyToClipboard()
    const notesAutosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const notesSaveInFlightRef = useRef(false)
    const notesTextareaRef = useRef<HTMLTextAreaElement | null>(null)
    const notesSearchInputRef = useRef<HTMLInputElement | null>(null)
    const openFileInputRef = useRef<HTMLInputElement | null>(null)
    const openFileShortcut = useMemo(() => getOpenFileShortcut(), [])
    const [isRespawningPinnedShell, setIsRespawningPinnedShell] = useState(false)
    const [pinnedShellRespawnError, setPinnedShellRespawnError] = useState<string | null>(null)
    const respawnAttemptedRef = useRef(false)

    const focusTerminalIfAllowed = useCallback(() => {
        if (keyboardVisible) {
            return
        }
        terminalRef.current?.focus()
    }, [keyboardVisible])

    const blurTerminal = useCallback(() => {
        terminalRef.current?.blur()
    }, [])

    const fileSearchInventory = useSessionFileSearch(api, loadedSessionId, '', {
        enabled: openFileDialogOpen && Boolean(loadedSessionId && session?.active && session?.metadata?.path),
        limit: 5000
    })
    const openFileResults = useMemo(
        () => openFileQuery.trim()
            ? rankFiles(fileSearchInventory.files, openFileQuery).slice(0, 200)
            : fileSearchInventory.files.slice(0, 200),
        [fileSearchInventory.files, openFileQuery]
    )

    const {
        state: terminalState,
        connect,
        reconnectView,
        write,
        resize,
        disconnect,
        onOutput,
        onExit,
        replay,
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
        onExit((code, signal) => {
            setExitInfo({ code, signal })
            terminalRef.current?.write(`\r\n[process exited${code !== null ? ` with code ${code}` : ''}]`)
            connectOnceRef.current = false
        })
    }, [onExit])

    useEffect(() => {
        modifierStateRef.current = { ctrl: ctrlActive, alt: altActive }
    }, [ctrlActive, altActive])

    useEffect(() => {
        tmuxCopyModeActiveRef.current = tmuxCopyModeActive
    }, [tmuxCopyModeActive])

    const resetModifiers = useCallback(() => {
        setCtrlActive(false)
        setAltActive(false)
    }, [])

    const dispatchSequence = useCallback(
        (sequence: string, modifierState: ModifierState) => {
            write(applyModifierState(sequence, modifierState))
            if (shouldResetModifiers(sequence, modifierState)) {
                resetModifiers()
            }
        },
        [write, resetModifiers]
    )

    const handleTerminalMount = useCallback(
        (terminal: Terminal) => {
            terminalRef.current = terminal
            inputDisposableRef.current?.dispose()
            inputDisposableRef.current = terminal.onData((data) => {
                // Detect 'q' keypress while in tmux copy-mode to sync UI state
                if (data === 'q' && tmuxCopyModeActiveRef.current) {
                    setTmuxCopyModeActive(false)
                }
                const modifierState = modifierStateRef.current
                dispatchSequence(data, modifierState)
            })
            if (terminalState.status === 'connected') {
                focusTerminalIfAllowed()
            }
        },
        [dispatchSequence, focusTerminalIfAllowed, terminalState.status]
    )

    const errorMessage = terminalState.status === 'error' ? terminalState.error : null
    const canTakeOver = errorMessage === TERMINAL_TAKEOVER_MESSAGE

    const handleResize = useCallback(
        (cols: number, rows: number) => {
            lastSizeRef.current = { cols, rows }
            if (!session?.active) {
                return
            }
            if (!terminalId || sessionLoading) {
                return
            }
            if (canTakeOver) {
                return
            }
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
        if (!session?.active) {
            return
        }
        if (!terminalId || sessionLoading) {
            return
        }
        if (connectOnceRef.current) {
            return
        }
        const size = lastSizeRef.current
        if (!size) {
            return
        }
        if (canTakeOver) {
            return
        }
        connectOnceRef.current = true
        connect(size.cols, size.rows)
    }, [session?.active, canTakeOver, connect, sessionLoading, terminalId])

    useEffect(() => {
        connectOnceRef.current = false
        setExitInfo(null)
    }, [sessionId])

    useEffect(() => {
        return () => {
            inputDisposableRef.current?.dispose()
            connectOnceRef.current = false
        }
    }, [])

    useEffect(() => {
        if (session?.active === false) {
            disconnect()
            connectOnceRef.current = false
        }
    }, [session?.active, disconnect])

    useEffect(() => {
        if (terminalState.status === 'error') {
            if (!canTakeOver) {
                connectOnceRef.current = false
            }
            return
        }
        if (terminalState.status === 'connecting' || terminalState.status === 'connected') {
            setExitInfo(null)
        }
    }, [terminalState.status, canTakeOver])

    useEffect(() => {
        if (terminalState.status !== 'connected') {
            return
        }
        focusTerminalIfAllowed()
    }, [focusTerminalIfAllowed, terminalState.status])

    useEffect(() => {
        respawnAttemptedRef.current = false
        setIsRespawningPinnedShell(false)
        setPinnedShellRespawnError(null)
    }, [sessionId])

    const quickInputDisabled = !session?.active || terminalState.status !== 'connected'
    const writePlainInput = useCallback((text: string) => {
        if (!text || quickInputDisabled) {
            return false
        }
        write(text)
        resetModifiers()
        focusTerminalIfAllowed()
        return true
    }, [focusTerminalIfAllowed, quickInputDisabled, write, resetModifiers])

    const handlePasteAction = useCallback(async () => {
        if (quickInputDisabled) {
            return
        }
        const readClipboard = navigator.clipboard?.readText
        if (readClipboard) {
            try {
                const clipboardText = await readClipboard.call(navigator.clipboard)
                if (!clipboardText) {
                    return
                }
                if (writePlainInput(clipboardText)) {
                    return
                }
            } catch {
                // Fall through to manual paste modal.
            }
        }
        setManualPasteText('')
        setPasteDialogOpen(true)
    }, [quickInputDisabled, writePlainInput])

    const handleManualPasteSubmit = useCallback(() => {
        if (!manualPasteText.trim()) {
            return
        }
        if (writePlainInput(manualPasteText)) {
            setPasteDialogOpen(false)
            setManualPasteText('')
        }
    }, [manualPasteText, writePlainInput])

    const handleCopyAction = useCallback(async () => {
        const text = getTerminalBufferText(terminalRef.current)
        if (!text) {
            return
        }
        await copy(text)
        terminalRef.current?.focus()
    }, [copy])

    const handleOpenTextView = useCallback(() => {
        const text = getTerminalBufferText(terminalRef.current)
        if (!text) {
            return
        }
        setTerminalTextSnapshot(text)
        setTextDialogOpen(true)
    }, [])

    const notesPath = session?.metadata?.notesPath?.trim() || null
    const notesDirty = notesContent !== notesSavedContent
    const pinnedShell = session?.metadata?.flavor === 'shell' && session?.metadata?.pinned === true

    useEffect(() => {
        if (!api || !session || !pinnedShell || isRespawningPinnedShell || respawnAttemptedRef.current) {
            return
        }

        const backendUnavailable = errorMessage === 'Shell backend is unavailable. Start a new shell session.'
        const shouldRespawn = session.metadata?.shellTerminalState === 'stale' || !session.active || backendUnavailable
        if (!shouldRespawn) {
            return
        }

        respawnAttemptedRef.current = true
        setIsRespawningPinnedShell(true)
        setPinnedShellRespawnError(null)
        void api.respawnPinnedShellSession(session.id)
            .then((result) => {
                setIsRespawningPinnedShell(false)
                void navigate({
                    to: '/sessions/$sessionId/terminal',
                    params: { sessionId: result.sessionId },
                    replace: true
                })
            })
            .catch((error) => {
                setIsRespawningPinnedShell(false)
                setPinnedShellRespawnError(error instanceof Error ? error.message : 'Failed to recreate pinned shell')
            })
    }, [api, errorMessage, isRespawningPinnedShell, navigate, pinnedShell, session])

    const saveNotes = useCallback(async (content: string) => {
        if (!api) {
            return false
        }
        if (notesSaveInFlightRef.current) {
            return false
        }

        notesSaveInFlightRef.current = true
        setNotesSaving(true)
        setNotesError(null)
        try {
            const result = await api.writeSessionNotes(sessionId, content)
            if (result.error) {
                throw new Error(result.error)
            }
            setNotesSavedContent(content)
            return true
        } catch (error) {
            setNotesError(error instanceof Error ? error.message : 'Failed to save notes')
            return false
        } finally {
            notesSaveInFlightRef.current = false
            setNotesSaving(false)
        }
    }, [api, sessionId])

    const handleNotesSetup = useCallback(async () => {
        if (!api) return
        setNotesSetupSaving(true)
        try {
            await api.writeSessionNotes(sessionId, '')
            await refetchSession()
            setNotesSetupOpen(false)
            setNotesContent('')
            setNotesSavedContent('')
            setNotesLoaded(true)
            setNotesDialogOpen(true)
        } catch (error) {
            setNotesError(error instanceof Error ? error.message : 'Failed to create notes')
        } finally {
            setNotesSetupSaving(false)
        }
    }, [api, refetchSession, sessionId])

    const runNotesEditorCommand = useCallback((command: 'undo' | 'redo') => {
        const textarea = notesTextareaRef.current
        if (!textarea) {
            return
        }
        textarea.focus()
        document.execCommand(command)
    }, [])

    const updateNotesSearchMatchCount = useCallback((content: string, query: string) => {
        const normalizedQuery = query.trim()
        if (!normalizedQuery) {
            setNotesSearchMatchCount(0)
            return
        }
        const haystack = content.toLowerCase()
        const needle = normalizedQuery.toLowerCase()
        let count = 0
        let index = 0
        while (index <= haystack.length) {
            const matchIndex = haystack.indexOf(needle, index)
            if (matchIndex < 0) {
                break
            }
            count += 1
            index = matchIndex + needle.length
        }
        setNotesSearchMatchCount(count)
    }, [])

    const runNotesSearch = useCallback((direction: 'next' | 'previous') => {
        const textarea = notesTextareaRef.current
        const normalizedQuery = notesSearchQuery.trim()
        if (!textarea || !normalizedQuery) {
            return
        }
        const haystack = notesContent.toLowerCase()
        const needle = normalizedQuery.toLowerCase()
        if (!needle) {
            return
        }

        const selectionStart = textarea.selectionStart ?? 0
        const selectionEnd = textarea.selectionEnd ?? selectionStart
        let matchIndex = -1

        if (direction === 'next') {
            const startIndex = selectionEnd
            matchIndex = haystack.indexOf(needle, startIndex)
            if (matchIndex < 0) {
                matchIndex = haystack.indexOf(needle, 0)
            }
        } else {
            const endIndex = Math.max(0, selectionStart - 1)
            matchIndex = haystack.lastIndexOf(needle, endIndex)
            if (matchIndex < 0) {
                matchIndex = haystack.lastIndexOf(needle)
            }
        }

        if (matchIndex < 0) {
            return
        }

        textarea.focus()
        textarea.setSelectionRange(matchIndex, matchIndex + normalizedQuery.length)
        const lineHeight = 24
        const approxTop = Math.max(0, notesContent.slice(0, matchIndex).split('\n').length - 2) * lineHeight
        textarea.scrollTop = approxTop
    }, [notesContent, notesSearchQuery])

    useEffect(() => {
        if (!notesDialogOpen || !api || !notesPath) {
            return
        }
        let cancelled = false
        setNotesLoading(true)
        setNotesError(null)
        void api.readSessionNotes(sessionId)
            .then((result) => {
                if (cancelled) return
                if (!result.success) {
                    setNotesError(result.error ?? 'Failed to load notes')
                    setNotesLoaded(false)
                    return
                }
                const text = result.content ?? ''
                setNotesContent(text)
                setNotesSavedContent(text)
                setNotesLoaded(true)
                updateNotesSearchMatchCount(text, notesSearchQuery)
            })
            .catch((error) => {
                if (cancelled) return
                setNotesError(error instanceof Error ? error.message : 'Failed to load notes')
                setNotesLoaded(false)
            })
            .finally(() => {
                if (!cancelled) setNotesLoading(false)
            })
        return () => {
            cancelled = true
        }
    }, [api, notesDialogOpen, notesPath, sessionId, notesSearchQuery, updateNotesSearchMatchCount])

    useEffect(() => {
        if (!notesDialogOpen || !notesLoaded || !notesDirty) {
            return
        }
        if (notesAutosaveTimerRef.current) {
            clearTimeout(notesAutosaveTimerRef.current)
        }
        notesAutosaveTimerRef.current = setTimeout(() => {
            void saveNotes(notesContent)
        }, 800)
        return () => {
            if (notesAutosaveTimerRef.current) {
                clearTimeout(notesAutosaveTimerRef.current)
                notesAutosaveTimerRef.current = null
            }
        }
    }, [notesContent, notesDialogOpen, notesDirty, notesLoaded, saveNotes])

    useEffect(() => {
        updateNotesSearchMatchCount(notesContent, notesSearchQuery)
    }, [notesContent, notesSearchQuery, updateNotesSearchMatchCount])

    useEffect(() => {
        return () => {
            if (notesAutosaveTimerRef.current) {
                clearTimeout(notesAutosaveTimerRef.current)
            }
        }
    }, [])

    useEffect(() => {
        setOpenFileActiveIndex(0)
    }, [openFileQuery])

    const handleOpenFileDialog = useCallback(() => {
        if (!loadedSessionId || !session?.active || !session?.metadata?.path) {
            return
        }
        setOpenFileDialogOpen(true)
        setOpenFileActiveIndex(0)
        setTimeout(() => {
            openFileInputRef.current?.focus()
        }, 0)
    }, [loadedSessionId, session?.active, session?.metadata?.path])

    const handleOpenExplorerFile = useCallback((path: string) => {
        if (!loadedSessionId) {
            return
        }
        setPreviewFilePath(path)
        setOpenFileDialogOpen(false)
        setOpenFileQuery('')
        setOpenFileActiveIndex(0)
    }, [loadedSessionId])

    const handlePreviewResizeStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        event.preventDefault()
        const startX = event.clientX
        const startWidth = previewPanelWidth

        const onMove = (e: globalThis.PointerEvent) => {
            const delta = startX - e.clientX
            const next = Math.max(FILE_PREVIEW_MIN_WIDTH, Math.min(FILE_PREVIEW_MAX_WIDTH, startWidth + delta))
            setPreviewPanelWidth(next)
            try { localStorage.setItem(FILE_PREVIEW_WIDTH_KEY, String(next)) } catch { /* ignore */ }
        }

        const onUp = () => {
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerup', onUp)
        }

        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
    }, [previewPanelWidth])

    const handleSplitResizeStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        event.preventDefault()
        const startX = event.clientX
        const startWidth = splitPanelWidth

        const onMove = (e: globalThis.PointerEvent) => {
            const delta = startX - e.clientX
            const next = Math.max(SPLIT_TERMINAL_MIN_WIDTH, Math.min(SPLIT_TERMINAL_MAX_WIDTH, startWidth + delta))
            setSplitPanelWidth(next)
            try { localStorage.setItem(SPLIT_TERMINAL_WIDTH_KEY, String(next)) } catch { /* ignore */ }
        }

        const onUp = () => {
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerup', onUp)
        }

        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
    }, [splitPanelWidth])

    const handleSplitTerminal = useCallback(async () => {
        if (!api || !session?.metadata?.path) return
        try {
            const result = await api.spawnHubSession(
                session.metadata.path,
                `${session.metadata.name ?? 'terminal'} (split)`,
                undefined, undefined,
                undefined, undefined, undefined, undefined, undefined,
                sessionId
            )
            if (result.type === 'success') {
                setSplitSessionId(result.sessionId)
            }
        } catch {
            // silently fail
        }
    }, [api, session?.metadata?.path, session?.metadata?.name, sessionId])

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            // Allow the shortcut from the terminal (xterm textarea) since it always has modifiers.
            // Only skip from real user inputs like search fields and dialogs.
            const target = event.target as HTMLElement | null
            const tagName = target?.tagName?.toLowerCase()
            const isXtermTextarea = tagName === 'textarea' && target?.closest('.xterm')
            const isUserInput = !isXtermTextarea && (
                target?.isContentEditable
                || tagName === 'input'
                || tagName === 'textarea'
                || tagName === 'select'
            )

            if (!openFileDialogOpen && !isUserInput && matchShortcutEvent(event, openFileShortcut)) {
                event.preventDefault()
                handleOpenFileDialog()
                return
            }

            if (!openFileDialogOpen) {
                return
            }

            if (event.key === 'Escape') {
                setOpenFileDialogOpen(false)
                setOpenFileQuery('')
                setOpenFileActiveIndex(0)
                return
            }

            if (event.key === 'ArrowDown') {
                event.preventDefault()
                setOpenFileActiveIndex((index) => Math.min(index + 1, Math.max(0, openFileResults.length - 1)))
                return
            }

            if (event.key === 'ArrowUp') {
                event.preventDefault()
                setOpenFileActiveIndex((index) => Math.max(0, index - 1))
                return
            }

            if (event.key === 'Enter') {
                const match = openFileResults[openFileActiveIndex]
                if (match?.fileType === 'file') {
                    event.preventDefault()
                    handleOpenExplorerFile(match.fullPath)
                }
            }
        }

        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [handleOpenExplorerFile, handleOpenFileDialog, openFileActiveIndex, openFileDialogOpen, openFileResults, openFileShortcut])

    const handleQuickInput = useCallback(
        (sequence: string) => {
            if (quickInputDisabled) {
                return
            }
            const modifierState = { ctrl: ctrlActive, alt: altActive }
            dispatchSequence(sequence, modifierState)
            focusTerminalIfAllowed()
        },
        [quickInputDisabled, ctrlActive, altActive, dispatchSequence, focusTerminalIfAllowed]
    )

    const sendTmuxPrefixSequence = useCallback((sequence: string) => {
        if (quickInputDisabled) {
            return
        }
        write('\u0002')
        write(sequence)
        focusTerminalIfAllowed()
    }, [focusTerminalIfAllowed, quickInputDisabled, write])

    const handleTmuxCopyModeToggle = useCallback(() => {
        if (quickInputDisabled) {
            return
        }
        if (tmuxCopyModeActive) {
            write('q')
            setTmuxCopyModeActive(false)
        } else {
            sendTmuxPrefixSequence('[')
            setTmuxCopyModeActive(true)
        }
        resetModifiers()
        focusTerminalIfAllowed()
    }, [focusTerminalIfAllowed, quickInputDisabled, tmuxCopyModeActive, write, sendTmuxPrefixSequence, resetModifiers])

    const handleKeyboardVisibilityToggle = useCallback(() => {
        setKeyboardVisible((value) => {
            const next = !value
            if (next) {
                blurTerminal()
            }
            return next
        })
        resetModifiers()
    }, [blurTerminal, resetModifiers])

    const handleTerminalTouchStart = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
        if (!tmuxCopyModeActive) {
            return
        }
        touchModeRef.current = {
            startY: event.touches[0]?.clientY ?? null,
            active: true
        }
    }, [tmuxCopyModeActive])

    const handleTerminalTouchMove = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
        if (!tmuxCopyModeActive || !touchModeRef.current.active) {
            return
        }

        const currentY = event.touches[0]?.clientY
        const startY = touchModeRef.current.startY
        if (currentY == null || startY == null) {
            return
        }

        const deltaY = currentY - startY
        const threshold = 36
        if (Math.abs(deltaY) < threshold) {
            return
        }

        event.preventDefault()
        write(deltaY > 0 ? '\u001b[5~' : '\u001b[6~')
        touchModeRef.current.startY = currentY
    }, [tmuxCopyModeActive, write])

    const handleTerminalTouchEnd = useCallback(() => {
        touchModeRef.current = { startY: null, active: false }
    }, [])

    const handleTerminalWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
        if (quickInputDisabled) return

        if (tmuxCopyModeActive) {
            // Already in copy-mode: translate wheel into tmux scroll commands
            event.preventDefault()
            const absDelta = Math.abs(event.deltaY)
            if (absDelta < 5) return
            if (absDelta > 200) {
                // Fast scroll → page up/down
                write(event.deltaY < 0 ? '\u001b[5~' : '\u001b[6~')
            } else {
                // Fine scroll → arrow keys (1 line per ~40px, capped at 5)
                const lines = Math.max(1, Math.min(5, Math.round(absDelta / 40)))
                const arrow = event.deltaY < 0 ? '\u001b[A' : '\u001b[B'
                for (let i = 0; i < lines; i++) write(arrow)
            }
            return
        }

        // Auto-scroll detection: accumulate wheel delta and activate copy-mode on threshold
        if (!autoScroll) return

        const accum = scrollAccumRef.current
        accum.delta += Math.abs(event.deltaY)

        if (accum.timer) clearTimeout(accum.timer)
        accum.timer = setTimeout(() => {
            accum.delta = 0
            accum.timer = null
        }, 400)

        if (accum.delta > 150) {
            // Threshold reached → enter tmux copy-mode
            sendTmuxPrefixSequence('[')
            setTmuxCopyModeActive(true)
            resetModifiers()
            accum.delta = 0
            if (accum.timer) {
                clearTimeout(accum.timer)
                accum.timer = null
            }
            // Send initial scroll in the direction the user was scrolling
            event.preventDefault()
            write(event.deltaY < 0 ? '\u001b[5~' : '\u001b[6~')
        }
    }, [autoScroll, quickInputDisabled, tmuxCopyModeActive, sendTmuxPrefixSequence, write, resetModifiers])

    const handleModifierToggle = useCallback(
        (modifier: 'ctrl' | 'alt') => {
            if (quickInputDisabled) {
                return
            }
            if (modifier === 'ctrl') {
                setCtrlActive((value) => !value)
                setAltActive(false)
            } else {
                setAltActive((value) => !value)
                setCtrlActive(false)
            }
            focusTerminalIfAllowed()
        },
        [focusTerminalIfAllowed, quickInputDisabled]
    )

    if (!session) {
        return (
            <div className="flex h-full items-center justify-center">
                <LoadingState label="Loading session…" className="text-sm" />
            </div>
        )
    }

    const subtitle = session.metadata?.path ?? sessionId
    const status = terminalState.status

    return (
        <div className="relative flex h-full flex-col">
            <div className="bg-[var(--app-bg)] pt-[env(safe-area-inset-top)]">
                <div className="border-b border-[var(--app-border)] p-3">
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={goBack}
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                        >
                            <BackIcon />
                        </button>
                        <div className="min-w-0 flex-1">
                            <div className="truncate font-semibold">Terminal</div>
                            <div className="truncate text-xs text-[var(--app-hint)]">{subtitle}</div>
                        </div>
                        <div className="shrink-0">
                            <ConnectionIndicator status={status} />
                        </div>
                    </div>
                    <div className="-mx-3 mt-3 overflow-x-auto px-3">
                        <div className="flex min-w-max items-center gap-2">
                            <button
                                type="button"
                                onClick={handleOpenFileDialog}
                                className="shrink-0 rounded-full border border-[var(--app-border)] px-3 py-1 text-xs font-medium text-[var(--app-fg)] transition-colors hover:bg-[var(--app-secondary-bg)]"
                            >
                                Open file
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    void handleCopyAction()
                                }}
                                className="shrink-0 rounded-full border border-[var(--app-border)] px-3 py-1 text-xs font-medium text-[var(--app-fg)] transition-colors hover:bg-[var(--app-secondary-bg)]"
                            >
                                {copied ? t('button.copied') : t('button.copy')}
                            </button>
                            <button
                                type="button"
                                onClick={handleOpenTextView}
                                className="shrink-0 rounded-full border border-[var(--app-border)] px-3 py-1 text-xs font-medium text-[var(--app-fg)] transition-colors hover:bg-[var(--app-secondary-bg)]"
                            >
                                Text
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    if (notesPath) {
                                        setNotesDialogOpen(true)
                                    } else {
                                        setNotesSetupOpen(true)
                                    }
                                }}
                                className="shrink-0 rounded-full border border-[var(--app-border)] px-3 py-1 text-xs font-medium text-[var(--app-fg)] transition-colors hover:bg-[var(--app-secondary-bg)]"
                            >
                                Notes
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    if (splitSessionId) {
                                        setSplitSessionId(null)
                                    } else {
                                        void handleSplitTerminal()
                                    }
                                }}
                                className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                                    splitSessionId
                                        ? 'border-[var(--app-link)] bg-[var(--app-link)] text-[var(--app-bg)]'
                                        : 'border-[var(--app-border)] text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)]'
                                }`}
                            >
                                {splitSessionId ? 'Close split' : 'Split'}
                            </button>
                            <button
                                type="button"
                                onClick={handleTmuxCopyModeToggle}
                                className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                                    tmuxCopyModeActive
                                        ? 'border-[var(--app-link)] bg-[var(--app-link)] text-[var(--app-bg)]'
                                        : 'border-[var(--app-border)] text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)]'
                                }`}
                            >
                                {tmuxCopyModeActive ? 'Exit scroll' : 'Scroll'}
                            </button>
                            <button
                                type="button"
                                onClick={handleKeyboardVisibilityToggle}
                                className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                                    keyboardVisible
                                        ? 'border-[var(--app-link)] bg-[var(--app-link)] text-[var(--app-bg)]'
                                        : 'border-[var(--app-border)] text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)]'
                                }`}
                            >
                                {keyboardVisible ? 'Hide keys' : 'Keys'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {session.active ? null : (
                <div className="px-3 pt-3">
                    <div className="w-full rounded-md bg-[var(--app-subtle-bg)] p-3 text-sm text-[var(--app-hint)]">
                        Session is inactive. Terminal is unavailable.
                    </div>
                </div>
            )}

            {isRespawningPinnedShell ? (
                <div className="px-3 pt-3">
                    <div className="w-full rounded-md bg-[var(--app-subtle-bg)] p-3 text-sm text-[var(--app-hint)]">
                        Recreating pinned shell…
                    </div>
                </div>
            ) : null}

            {pinnedShellRespawnError ? (
                <div className="px-3 pt-3">
                    <div className="w-full rounded-md border border-[var(--app-badge-error-border)] bg-[var(--app-badge-error-bg)] p-3 text-sm text-[var(--app-badge-error-text)]">
                        {pinnedShellRespawnError}
                    </div>
                </div>
            ) : null}

            {errorMessage ? (
                <div className="w-full px-3 pt-3">
                    <div className="rounded-md border border-[var(--app-badge-error-border)] bg-[var(--app-badge-error-bg)] p-3 text-xs text-[var(--app-badge-error-text)]">
                        <div>{errorMessage}</div>
                        {canTakeOver ? (
                            <div className="mt-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={takeOver}
                                    className="border-[var(--app-badge-error-border)] bg-transparent text-[var(--app-badge-error-text)] hover:bg-[var(--app-badge-error-bg)]"
                                >
                                    Take over here
                                </Button>
                            </div>
                        ) : null}
                    </div>
                </div>
            ) : null}

            {exitInfo ? (
                <div className="w-full px-3 pt-3">
                    <div className="rounded-md border border-[var(--app-border)] bg-[var(--app-subtle-bg)] p-3 text-xs text-[var(--app-hint)]">
                        Terminal exited{exitInfo.code !== null ? ` with code ${exitInfo.code}` : ''}
                        {exitInfo.signal ? ` (${exitInfo.signal})` : ''}.
                    </div>
                </div>
            ) : null}

            <div className="flex flex-1 min-h-0 overflow-hidden bg-[var(--app-bg)]">
                <div className="flex-1 min-w-0 overflow-hidden">
                    <div className="h-full w-full p-3">
                        <div
                            className="h-full w-full"
                            onTouchStart={handleTerminalTouchStart}
                            onTouchMove={handleTerminalTouchMove}
                            onTouchEnd={handleTerminalTouchEnd}
                            onTouchCancel={handleTerminalTouchEnd}
                            onWheel={handleTerminalWheel}
                        >
                            <TerminalView
                                onMount={handleTerminalMount}
                                onResize={handleResize}
                                className="h-full w-full"
                                suppressFocus={keyboardVisible}
                            />
                        </div>
                    </div>
                </div>

                {splitSessionId ? (
                    <div className="relative flex shrink-0 border-l border-[var(--app-border)]" style={{ width: `${splitPanelWidth}px` }}>
                        <div
                            role="separator"
                            aria-orientation="vertical"
                            aria-label="Resize split terminal"
                            onPointerDown={handleSplitResizeStart}
                            className="absolute inset-y-0 left-0 z-10 w-3 -translate-x-1/2 cursor-col-resize"
                        >
                            <div className="mx-auto h-full w-[2px] rounded-full bg-transparent transition-colors hover:bg-[var(--app-link)]" />
                        </div>
                        <SplitTerminalPanel
                            sessionId={splitSessionId}
                            onClose={() => setSplitSessionId(null)}
                            onNavigate={(id) => {
                                setSplitSessionId(null)
                                void navigate({
                                    to: '/sessions/$sessionId/terminal',
                                    params: { sessionId: id },
                                })
                            }}
                        />
                    </div>
                ) : previewFilePath && loadedSessionId ? (
                    <div className="relative flex shrink-0 border-l border-[var(--app-border)]" style={{ width: `${previewPanelWidth}px` }}>
                        <div
                            role="separator"
                            aria-orientation="vertical"
                            aria-label="Resize file preview"
                            onPointerDown={handlePreviewResizeStart}
                            className="absolute inset-y-0 left-0 z-10 w-3 -translate-x-1/2 cursor-col-resize"
                        >
                            <div className="mx-auto h-full w-[2px] rounded-full bg-transparent transition-colors hover:bg-[var(--app-link)]" />
                        </div>
                        <FilePreviewPanel
                            sessionId={loadedSessionId}
                            filePath={previewFilePath}
                            api={api}
                            onClose={() => setPreviewFilePath(null)}
                        />
                    </div>
                ) : null}
            </div>

            {keyboardVisible ? (
                <div className="shrink-0 border-t border-[var(--app-border)] bg-[var(--app-bg)] pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_rgba(0,0,0,0.18)]">
                    <div className="w-full px-3 py-2">
                        <div className="flex flex-col gap-2">
                            <button
                                type="button"
                                onClick={() => {
                                    void handlePasteAction()
                                }}
                                disabled={quickInputDisabled}
                                className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-secondary-bg)] px-3 py-2 text-sm font-medium text-[var(--app-fg)] transition-colors hover:bg-[var(--app-subtle-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-button)] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {t('button.paste')}
                            </button>
                            {QUICK_INPUT_ROWS.map((row, rowIndex) => (
                                <div
                                    key={`terminal-quick-row-${rowIndex}`}
                                    className="flex items-stretch overflow-hidden rounded-md bg-[var(--app-secondary-bg)]"
                                >
                                    {row.map((input) => {
                                        const modifier = input.modifier
                                        const isCtrl = modifier === 'ctrl'
                                        const isAlt = modifier === 'alt'
                                        const isActive = (isCtrl && ctrlActive) || (isAlt && altActive)
                                        return (
                                            <QuickKeyButton
                                                key={input.label}
                                                input={input}
                                                disabled={quickInputDisabled}
                                                isActive={isActive}
                                                onPress={handleQuickInput}
                                                onToggleModifier={handleModifierToggle}
                                            />
                                        )
                                    })}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            ) : null}

            <Dialog
                open={openFileDialogOpen}
                onOpenChange={(open) => {
                    setOpenFileDialogOpen(open)
                    if (!open) {
                        setOpenFileQuery('')
                        setOpenFileActiveIndex(0)
                    }
                }}
            >
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Open file</DialogTitle>
                        <DialogDescription>
                            Search workspace files. Shortcut: {openFileShortcut}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="mt-2">
                        <input
                            ref={openFileInputRef}
                            type="text"
                            value={openFileQuery}
                            onChange={(event) => setOpenFileQuery(event.target.value)}
                            placeholder="Type to fuzzy search files"
                            className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)]"
                            autoCapitalize="none"
                            autoCorrect="off"
                            spellCheck={false}
                        />
                    </div>
                    <div className="mt-3 max-h-[50vh] overflow-y-auto rounded-md border border-[var(--app-border)] bg-[var(--app-bg)]">
                        {fileSearchInventory.isLoading ? (
                            <div className="px-3 py-4 text-sm text-[var(--app-hint)]">Loading files…</div>
                        ) : fileSearchInventory.error ? (
                            <div className="px-3 py-4 text-sm text-[var(--app-badge-error-text)]">{fileSearchInventory.error}</div>
                        ) : openFileResults.length === 0 ? (
                            <div className="px-3 py-4 text-sm text-[var(--app-hint)]">No matching files</div>
                        ) : (
                            <div className="divide-y divide-[var(--app-divider)]">
                                {openFileResults.map((file, index) => (
                                    <button
                                        key={file.fullPath}
                                        type="button"
                                        onClick={() => {
                                            if (file.fileType === 'file') {
                                                handleOpenExplorerFile(file.fullPath)
                                            }
                                        }}
                                        className={`flex w-full items-start justify-between gap-3 px-3 py-2 text-left transition-colors ${
                                            index === openFileActiveIndex
                                                ? 'bg-[var(--app-subtle-bg)]'
                                                : 'hover:bg-[var(--app-subtle-bg)]'
                                        }`}
                                    >
                                        <div className="min-w-0 flex-1">
                                            <div className="truncate text-sm font-medium text-[var(--app-fg)]">{file.fileName}</div>
                                            <div className="truncate text-xs text-[var(--app-hint)]">{file.fullPath}</div>
                                        </div>
                                        <div className="shrink-0 text-[10px] uppercase tracking-wide text-[var(--app-hint)]">
                                            {file.fileType}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog
                open={pasteDialogOpen}
                onOpenChange={(open) => {
                    setPasteDialogOpen(open)
                    if (!open) {
                        setManualPasteText('')
                    }
                }}
            >
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>{t('terminal.paste.fallbackTitle')}</DialogTitle>
                        <DialogDescription>
                            {t('terminal.paste.fallbackDescription')}
                        </DialogDescription>
                    </DialogHeader>
                    <textarea
                        value={manualPasteText}
                        onChange={(event) => setManualPasteText(event.target.value)}
                        placeholder={t('terminal.paste.placeholder')}
                        className="mt-2 min-h-32 w-full resize-y rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)]"
                        autoCapitalize="none"
                        autoCorrect="off"
                    />
                    <div className="mt-3 flex justify-end gap-2">
                        <Button
                            type="button"
                            variant="secondary"
                            onClick={() => {
                                setPasteDialogOpen(false)
                                setManualPasteText('')
                            }}
                        >
                            {t('button.cancel')}
                        </Button>
                        <Button
                            type="button"
                            onClick={handleManualPasteSubmit}
                            disabled={!manualPasteText.trim()}
                        >
                            {t('button.paste')}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog open={notesSetupOpen} onOpenChange={setNotesSetupOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Create Notes</DialogTitle>
                        <DialogDescription>
                            Attach a notes file to this session. Notes are stored in ~/.maglev/notes/ and won't affect your git tree.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="mt-4 flex flex-col gap-3">
                        {notesError ? (
                            <div className="text-xs text-red-500">{notesError}</div>
                        ) : null}
                        <button
                            type="button"
                            className="inline-flex items-center justify-center rounded-md bg-[var(--app-link)] px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={notesSetupSaving}
                            onClick={() => void handleNotesSetup()}
                        >
                            {notesSetupSaving ? 'Creating…' : 'Create notes'}
                        </button>
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog
                open={notesDialogOpen}
                onOpenChange={(open) => {
                    if (!open && notesDirty) {
                        void saveNotes(notesContent)
                    }
                    setNotesDialogOpen(open)
                    if (!open) {
                        setNotesError(null)
                        setNotesLoaded(false)
                        setNotesSearchQuery('')
                        setNotesSearchMatchCount(0)
                    }
                }}
            >
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Notes</DialogTitle>
                        <DialogDescription>
                            {notesPath ?? 'No notes file configured'}
                        </DialogDescription>
                    </DialogHeader>
                    {notesLoading ? (
                        <div className="py-6 text-sm text-[var(--app-hint)]">Loading notes…</div>
                    ) : notesError && !notesLoaded ? (
                        <div className="space-y-3">
                            <div className="rounded-md border border-[var(--app-badge-error-border)] bg-[var(--app-badge-error-bg)] p-3 text-sm text-[var(--app-badge-error-text)]">
                                {notesError}
                            </div>
                            <div className="flex justify-end">
                                <Button
                                    type="button"
                                    onClick={() => {
                                        void saveNotes('').then((ok) => {
                                            if (ok) {
                                                setNotesLoaded(true)
                                                setNotesError(null)
                                            }
                                        })
                                    }}
                                    disabled={notesSaving}
                                >
                                    Create notes file
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                                <input
                                    ref={notesSearchInputRef}
                                    type="text"
                                    value={notesSearchQuery}
                                    onChange={(event) => setNotesSearchQuery(event.target.value)}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter') {
                                            event.preventDefault()
                                            runNotesSearch(event.shiftKey ? 'previous' : 'next')
                                        }
                                    }}
                                    placeholder="Search notes"
                                    className="min-w-0 flex-1 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)]"
                                    autoCapitalize="none"
                                    autoCorrect="off"
                                    spellCheck={false}
                                />
                                <Button
                                    type="button"
                                    variant="secondary"
                                    onClick={() => runNotesSearch('previous')}
                                    disabled={!notesSearchQuery.trim() || notesSearchMatchCount === 0}
                                >
                                    Prev
                                </Button>
                                <Button
                                    type="button"
                                    variant="secondary"
                                    onClick={() => runNotesSearch('next')}
                                    disabled={!notesSearchQuery.trim() || notesSearchMatchCount === 0}
                                >
                                    Next
                                </Button>
                                <span className="text-xs text-[var(--app-hint)]">
                                    {notesSearchQuery.trim()
                                        ? notesSearchMatchCount > 0
                                            ? `${notesSearchMatchCount} match${notesSearchMatchCount === 1 ? '' : 'es'}`
                                            : 'No matches'
                                        : 'Find in notes'}
                                </span>
                            </div>
                            <textarea
                                ref={notesTextareaRef}
                                value={notesContent}
                                onChange={(event) => setNotesContent(event.target.value)}
                                className="mt-2 min-h-[50vh] w-full resize-y rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-3 font-mono text-sm leading-6 text-[var(--app-fg)] focus:outline-none focus:ring-2 focus:ring-[var(--app-link)]"
                                autoCapitalize="none"
                                autoCorrect="off"
                                spellCheck={false}
                            />
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                                <Button
                                    type="button"
                                    variant="secondary"
                                    onClick={() => runNotesEditorCommand('undo')}
                                >
                                    Undo
                                </Button>
                                <Button
                                    type="button"
                                    variant="secondary"
                                    onClick={() => runNotesEditorCommand('redo')}
                                >
                                    Redo
                                </Button>
                                <Button
                                    type="button"
                                    onClick={() => {
                                        void saveNotes(notesContent)
                                    }}
                                    disabled={!notesDirty || notesSaving}
                                >
                                    {notesSaving ? 'Saving…' : 'Save now'}
                                </Button>
                            </div>
                            <div className="mt-3 flex items-center justify-between gap-3 text-xs text-[var(--app-hint)]">
                                <span>
                                    {notesSaving ? 'Saving…' : notesDirty ? 'Unsaved' : 'Saved'}
                                </span>
                                {notesError ? (
                                    <span className="text-[var(--app-badge-error-text)]">{notesError}</span>
                                ) : null}
                            </div>
                        </>
                    )}
                </DialogContent>
            </Dialog>

            <Dialog
                open={textDialogOpen}
                onOpenChange={(open) => {
                    setTextDialogOpen(open)
                    if (!open) {
                        setTerminalTextSnapshot('')
                    }
                }}
            >
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Terminal text</DialogTitle>
                        <DialogDescription>
                            Open terminal text here for native selection and copy.
                        </DialogDescription>
                    </DialogHeader>
                    <textarea
                        value={terminalTextSnapshot}
                        readOnly
                        className="mt-2 min-h-[50vh] w-full resize-y rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-3 font-mono text-xs leading-5 text-[var(--app-fg)] focus:outline-none focus:ring-2 focus:ring-[var(--app-link)]"
                    />
                    <div className="mt-3 flex justify-end gap-2">
                        <Button
                            type="button"
                            variant="secondary"
                            onClick={() => {
                                setTextDialogOpen(false)
                                setTerminalTextSnapshot('')
                            }}
                        >
                            {t('button.close')}
                        </Button>
                        <Button
                            type="button"
                            onClick={() => {
                                void copy(terminalTextSnapshot)
                            }}
                            disabled={!terminalTextSnapshot}
                        >
                            {copied ? t('button.copied') : t('button.copy')}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    )
}
