import {
    useCallback,
    useEffect,
    useId,
    useLayoutEffect,
    useRef,
    useState,
    type CSSProperties
} from 'react'
import { useTranslation } from '@/lib/use-translation'

type SessionActionMenuProps = {
    isOpen: boolean
    onClose: () => void
    sessionActive: boolean
    canPin?: boolean
    pinned?: boolean
    onTogglePin?: () => void
    canEditStartupCommand?: boolean
    onEditStartupCommand?: () => void
    canOpenFolder?: boolean
    onOpenFolder?: () => void
    canOpenReview?: boolean
    onOpenReview?: () => void
    canAttachTerminalSupervision?: boolean
    onAttachTerminalSupervision?: () => void
    canPauseTerminalSupervision?: boolean
    terminalSupervisionPaused?: boolean
    onToggleTerminalSupervisionPaused?: () => void
    canDetachTerminalSupervision?: boolean
    onDetachTerminalSupervision?: () => void
    canRestartTerminalPair?: boolean
    onRestartTerminalPair?: () => void
    canRebindTerminalPair?: boolean
    onRebindTerminalPair?: () => void
    canAddTerminalPairSupervisor?: boolean
    onAddTerminalPairSupervisor?: () => void
    canPauseTerminalPair?: boolean
    terminalPairPaused?: boolean
    onToggleTerminalPairPaused?: () => void
    onRename: () => void
    onArchive: () => void
    onDelete: () => void
    anchorPoint: { x: number; y: number }
    menuId?: string
}

function EditIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            <path d="m15 5 4 4" />
        </svg>
    )
}

function ArchiveIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <rect width="20" height="5" x="2" y="3" rx="1" />
            <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
            <path d="M10 12h4" />
        </svg>
    )
}

function TrashIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M3 6h18" />
            <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
            <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
            <line x1="10" x2="10" y1="11" y2="17" />
            <line x1="14" x2="14" y1="11" y2="17" />
        </svg>
    )
}

type MenuPosition = {
    top: number
    left: number
    transformOrigin: string
}

function FolderOpenIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1" />
            <path d="M3 13h7" />
            <path d="M10 17 14 13l-4-4" />
            <path d="M3 17V7" />
            <path d="M13 19h6a2 2 0 0 0 2-2v-4" />
        </svg>
    )
}

function GitPullRequestIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <circle cx="18" cy="18" r="3" />
            <circle cx="6" cy="6" r="3" />
            <path d="M6 9v6a3 3 0 0 0 3 3h6" />
            <path d="M18 9V8a2 2 0 0 0-2-2h-1" />
        </svg>
    )
}

function PinIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M12 17v5" />
            <path d="M8 3h8l-1 5 3 3v2H6v-2l3-3-1-5Z" />
        </svg>
    )
}

function TerminalIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M4 17 10 11 4 5" />
            <path d="M12 19h8" />
        </svg>
    )
}

export function SessionActionMenu(props: SessionActionMenuProps) {
    const { t } = useTranslation()
    const {
        isOpen,
        onClose,
        sessionActive,
        canPin = false,
        pinned = false,
        onTogglePin,
        canEditStartupCommand = false,
        onEditStartupCommand,
        canOpenFolder = false,
        onOpenFolder,
        canOpenReview = false,
        onOpenReview,
        canAttachTerminalSupervision = false,
        onAttachTerminalSupervision,
        canPauseTerminalSupervision = false,
        terminalSupervisionPaused = false,
        onToggleTerminalSupervisionPaused,
        canDetachTerminalSupervision = false,
        onDetachTerminalSupervision,
        canRestartTerminalPair = false,
        onRestartTerminalPair,
        canRebindTerminalPair = false,
        onRebindTerminalPair,
        canAddTerminalPairSupervisor = false,
        onAddTerminalPairSupervisor,
        canPauseTerminalPair = false,
        terminalPairPaused = false,
        onToggleTerminalPairPaused,
        onRename,
        onArchive,
        onDelete,
        anchorPoint,
        menuId
    } = props
    const menuRef = useRef<HTMLDivElement | null>(null)
    const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null)
    const internalId = useId()
    const resolvedMenuId = menuId ?? `session-action-menu-${internalId}`
    const headingId = `${resolvedMenuId}-heading`

    const handleRename = () => {
        onClose()
        onRename()
    }

    const handleOpenFolder = () => {
        onClose()
        onOpenFolder?.()
    }

    const handleOpenReview = () => {
        onClose()
        onOpenReview?.()
    }

    const handleArchive = () => {
        onClose()
        onArchive()
    }

    const handleTogglePin = () => {
        onClose()
        onTogglePin?.()
    }

    const handleEditStartupCommand = () => {
        onClose()
        onEditStartupCommand?.()
    }

    const handleDelete = () => {
        onClose()
        onDelete()
    }

    const handleAttachTerminalSupervision = () => {
        onClose()
        onAttachTerminalSupervision?.()
    }

    const handleToggleTerminalSupervisionPaused = () => {
        onClose()
        onToggleTerminalSupervisionPaused?.()
    }

    const handleDetachTerminalSupervision = () => {
        onClose()
        onDetachTerminalSupervision?.()
    }

    const handleRestartTerminalPair = () => {
        onClose()
        onRestartTerminalPair?.()
    }

    const handleToggleTerminalPairPaused = () => {
        onClose()
        onToggleTerminalPairPaused?.()
    }

    const handleRebindTerminalPair = () => {
        onClose()
        onRebindTerminalPair?.()
    }

    const handleAddTerminalPairSupervisor = () => {
        onClose()
        onAddTerminalPairSupervisor?.()
    }

    const updatePosition = useCallback(() => {
        const menuEl = menuRef.current
        if (!menuEl) return

        const menuRect = menuEl.getBoundingClientRect()
        const viewportWidth = window.innerWidth
        const viewportHeight = window.innerHeight
        const padding = 8
        const gap = 8

        const spaceBelow = viewportHeight - anchorPoint.y
        const spaceAbove = anchorPoint.y
        const openAbove = spaceBelow < menuRect.height + gap && spaceAbove > spaceBelow

        let top = openAbove ? anchorPoint.y - menuRect.height - gap : anchorPoint.y + gap
        let left = anchorPoint.x - menuRect.width / 2
        const transformOrigin = openAbove ? 'bottom center' : 'top center'

        top = Math.min(Math.max(top, padding), viewportHeight - menuRect.height - padding)
        left = Math.min(Math.max(left, padding), viewportWidth - menuRect.width - padding)

        setMenuPosition({ top, left, transformOrigin })
    }, [anchorPoint])

    useLayoutEffect(() => {
        if (!isOpen) return
        updatePosition()
    }, [isOpen, updatePosition])

    useEffect(() => {
        if (!isOpen) {
            setMenuPosition(null)
            return
        }

        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target as Node
            if (menuRef.current?.contains(target)) return
            onClose()
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose()
            }
        }

        const handleReflow = () => {
            updatePosition()
        }

        document.addEventListener('pointerdown', handlePointerDown)
        document.addEventListener('keydown', handleKeyDown)
        window.addEventListener('resize', handleReflow)
        window.addEventListener('scroll', handleReflow, true)

        return () => {
            document.removeEventListener('pointerdown', handlePointerDown)
            document.removeEventListener('keydown', handleKeyDown)
            window.removeEventListener('resize', handleReflow)
            window.removeEventListener('scroll', handleReflow, true)
        }
    }, [isOpen, onClose, updatePosition])

    useEffect(() => {
        if (!isOpen) return

        const frame = window.requestAnimationFrame(() => {
            const firstItem = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')
            firstItem?.focus()
        })

        return () => window.cancelAnimationFrame(frame)
    }, [isOpen])

    if (!isOpen) return null

    const menuStyle: CSSProperties | undefined = menuPosition
        ? {
            top: menuPosition.top,
            left: menuPosition.left,
            transformOrigin: menuPosition.transformOrigin
        }
        : undefined

    const baseItemClassName =
        'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-base transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]'

    return (
        <div
            ref={menuRef}
            className="fixed z-50 min-w-[200px] rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] p-1 shadow-lg animate-menu-pop"
            style={menuStyle}
        >
            <div
                id={headingId}
                className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--app-hint)]"
            >
                {t('session.more')}
            </div>
            <div
                id={resolvedMenuId}
                role="menu"
                aria-labelledby={headingId}
                className="flex flex-col gap-1"
            >
                <button
                    type="button"
                    role="menuitem"
                    className={`${baseItemClassName} hover:bg-[var(--app-subtle-bg)] disabled:cursor-not-allowed disabled:opacity-50`}
                    onClick={handleOpenFolder}
                    disabled={!canOpenFolder || !onOpenFolder}
                >
                    <FolderOpenIcon className="text-[var(--app-hint)]" />
                    {t('session.action.openFolder')}
                </button>

                <button
                    type="button"
                    role="menuitem"
                    className={`${baseItemClassName} hover:bg-[var(--app-subtle-bg)] disabled:cursor-not-allowed disabled:opacity-50`}
                    onClick={handleOpenReview}
                    disabled={!canOpenReview || !onOpenReview}
                >
                    <GitPullRequestIcon className="text-[var(--app-hint)]" />
                    Open Review
                </button>

                {canAttachTerminalSupervision ? (
                    <button
                        type="button"
                        role="menuitem"
                        className={`${baseItemClassName} hover:bg-[var(--app-subtle-bg)]`}
                        onClick={handleAttachTerminalSupervision}
                    >
                        <TerminalIcon className="text-[var(--app-hint)]" />
                        Attach Babysitter
                    </button>
                ) : null}

                {canPauseTerminalSupervision ? (
                    <button
                        type="button"
                        role="menuitem"
                        className={`${baseItemClassName} hover:bg-[var(--app-subtle-bg)]`}
                        onClick={handleToggleTerminalSupervisionPaused}
                    >
                        <TerminalIcon className="text-[var(--app-hint)]" />
                        {terminalSupervisionPaused ? 'Resume Babysitter' : 'Pause Babysitter'}
                    </button>
                ) : null}

                {canDetachTerminalSupervision ? (
                    <button
                        type="button"
                        role="menuitem"
                        className={`${baseItemClassName} hover:bg-[var(--app-subtle-bg)]`}
                        onClick={handleDetachTerminalSupervision}
                    >
                        <TerminalIcon className="text-[var(--app-hint)]" />
                        Detach Babysitter
                    </button>
                ) : null}

                {canRestartTerminalPair ? (
                    <button
                        type="button"
                        role="menuitem"
                        className={`${baseItemClassName} hover:bg-[var(--app-subtle-bg)]`}
                        onClick={handleRestartTerminalPair}
                    >
                        <TerminalIcon className="text-[var(--app-hint)]" />
                        Restart Pair
                    </button>
                ) : null}

                {canRebindTerminalPair ? (
                    <button
                        type="button"
                        role="menuitem"
                        className={`${baseItemClassName} hover:bg-[var(--app-subtle-bg)]`}
                        onClick={handleRebindTerminalPair}
                    >
                        <TerminalIcon className="text-[var(--app-hint)]" />
                        Rebind Pair Side
                    </button>
                ) : null}

                {canAddTerminalPairSupervisor ? (
                    <button
                        type="button"
                        role="menuitem"
                        className={`${baseItemClassName} hover:bg-[var(--app-subtle-bg)]`}
                        onClick={handleAddTerminalPairSupervisor}
                    >
                        <TerminalIcon className="text-[var(--app-hint)]" />
                        Add New Supervisor
                    </button>
                ) : null}

                {canPauseTerminalPair ? (
                    <button
                        type="button"
                        role="menuitem"
                        className={`${baseItemClassName} hover:bg-[var(--app-subtle-bg)]`}
                        onClick={handleToggleTerminalPairPaused}
                    >
                        <TerminalIcon className="text-[var(--app-hint)]" />
                        {terminalPairPaused ? 'Resume Pair' : 'Pause Pair'}
                    </button>
                ) : null}

                {canPin ? (
                    <button
                        type="button"
                        role="menuitem"
                        className={`${baseItemClassName} hover:bg-[var(--app-subtle-bg)]`}
                        onClick={handleTogglePin}
                    >
                        <PinIcon className="text-[var(--app-hint)]" />
                        {pinned ? 'Unpin shell' : 'Pin shell'}
                    </button>
                ) : null}

                {canEditStartupCommand ? (
                    <button
                        type="button"
                        role="menuitem"
                        className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[var(--app-fg)] transition-colors hover:bg-[var(--app-secondary-bg)] focus:bg-[var(--app-secondary-bg)] focus:outline-none"
                        onClick={handleEditStartupCommand}
                    >
                        <TerminalIcon className="text-[var(--app-hint)]" />
                        <span>Edit startup command</span>
                    </button>
                ) : null}

                <button
                    type="button"
                    role="menuitem"
                    className={`${baseItemClassName} hover:bg-[var(--app-subtle-bg)]`}
                    onClick={handleRename}
                >
                    <EditIcon className="text-[var(--app-hint)]" />
                    {t('session.action.rename')}
                </button>

                {sessionActive ? (
                    <button
                        type="button"
                        role="menuitem"
                        className={`${baseItemClassName} text-red-500 hover:bg-red-500/10`}
                        onClick={handleArchive}
                    >
                        <ArchiveIcon className="text-red-500" />
                        {t('session.action.archive')}
                    </button>
                ) : (
                    <button
                        type="button"
                        role="menuitem"
                        className={`${baseItemClassName} text-red-500 hover:bg-red-500/10`}
                        onClick={handleDelete}
                    >
                        <TrashIcon className="text-red-500" />
                        {t('session.action.delete')}
                    </button>
                )}
            </div>
        </div>
    )
}
