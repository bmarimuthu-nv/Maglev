import { useId, useMemo, useRef, useState } from 'react'
import type { Session } from '@/types/api'
import type { ApiClient } from '@/api/client'
import { isTelegramApp } from '@/hooks/useTelegram'
import { useSessionActions } from '@/hooks/mutations/useSessionActions'
import { SessionActionMenu } from '@/components/SessionActionMenu'
import { SessionEditDialog } from '@/components/SessionEditDialog'
import { StartupCommandDialog } from '@/components/StartupCommandDialog'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useTranslation } from '@/lib/use-translation'
import { useAppContext } from '@/lib/app-context'
import { openSessionExplorerWindow } from '@/utils/sessionExplorer'
import { openSessionReviewWindow } from '@/utils/sessionReview'

function getSessionTitle(session: Session): string {
    if (session.metadata?.name) {
        return session.metadata.name
    }
    if (session.metadata?.summary?.text) {
        return session.metadata.summary.text
    }
    if (session.metadata?.path) {
        const parts = session.metadata.path.split('/').filter(Boolean)
        return parts.length > 0 ? parts[parts.length - 1] : session.id.slice(0, 8)
    }
    return session.id.slice(0, 8)
}

function FilesIcon(props: { className?: string }) {
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
            <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
        </svg>
    )
}

function MoreVerticalIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="currentColor"
            className={props.className}
        >
            <circle cx="12" cy="5" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="12" cy="19" r="2" />
        </svg>
    )
}

export function SessionHeader(props: {
    session: Session
    onBack: () => void
    onViewFiles?: () => void
    api: ApiClient | null
    onSessionDeleted?: () => void
}) {
    const { t } = useTranslation()
    const { baseUrl } = useAppContext()
    const { session, api, onSessionDeleted } = props
    const title = useMemo(() => getSessionTitle(session), [session])
    const worktreeBranch = session.metadata?.worktree?.branch

    const [menuOpen, setMenuOpen] = useState(false)
    const [menuAnchorPoint, setMenuAnchorPoint] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
    const menuId = useId()
    const menuAnchorRef = useRef<HTMLButtonElement | null>(null)
    const [editOpen, setEditOpen] = useState(false)
    const [startupCommandOpen, setStartupCommandOpen] = useState(false)
    const [closeOpen, setCloseOpen] = useState(false)

    const { updateSession, closeSession, setPinned, setShellOptions, isPending } = useSessionActions(
        api,
        session.id,
        session.metadata?.flavor ?? null
    )

    const handleCloseSession = async () => {
        await closeSession()
        onSessionDeleted?.()
    }

    const handleMenuToggle = () => {
        if (!menuOpen && menuAnchorRef.current) {
            const rect = menuAnchorRef.current.getBoundingClientRect()
            setMenuAnchorPoint({ x: rect.right, y: rect.bottom })
        }
        setMenuOpen((open) => !open)
    }

    // In Telegram, don't render header (Telegram provides its own)
    if (isTelegramApp()) {
        return null
    }

    return (
        <>
            <div className="bg-[var(--app-bg)] pt-[env(safe-area-inset-top)]">
                <div className="flex w-full items-center gap-2 p-3">
                    {/* Back button */}
                    <button
                        type="button"
                        onClick={props.onBack}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                    >
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
                    </button>

                    {/* Session info - two lines: title and path */}
                    <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold">
                            {title}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[var(--app-hint)]">
                            <span className="inline-flex items-center gap-1">
                                <span aria-hidden="true">❖</span>
                                {session.metadata?.flavor?.trim() || 'unknown'}
                            </span>
                            {worktreeBranch ? (
                                <span>{t('session.item.worktree')}: {worktreeBranch}</span>
                            ) : null}
                        </div>
                    </div>

                    {props.onViewFiles ? (
                        <button
                            type="button"
                            onClick={props.onViewFiles}
                            className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                            title={t('session.title')}
                        >
                            <FilesIcon />
                        </button>
                    ) : null}

                    <button
                        type="button"
                        onClick={handleMenuToggle}
                        onPointerDown={(e) => e.stopPropagation()}
                        ref={menuAnchorRef}
                        aria-haspopup="menu"
                        aria-expanded={menuOpen}
                        aria-controls={menuOpen ? menuId : undefined}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                        title={t('session.more')}
                    >
                        <MoreVerticalIcon />
                    </button>
                </div>
            </div>

            <SessionActionMenu
                isOpen={menuOpen}
                onClose={() => setMenuOpen(false)}
                sessionActive={session.active}
                canPin={session.metadata?.flavor === 'shell'}
                pinned={session.metadata?.pinned === true}
                onTogglePin={() => {
                    void setPinned(!(session.metadata?.pinned === true))
                }}
                canEditStartupCommand={session.metadata?.flavor === 'shell'}
                onEditStartupCommand={() => setStartupCommandOpen(true)}
                canOpenFolder={Boolean(session.metadata?.path)}
                onOpenFolder={() => {
                    if (!session.metadata?.path) return
                    openSessionExplorerWindow(baseUrl, session.id, { tab: 'directories' })
                }}
                canOpenReview={Boolean(session.active && session.metadata?.path)}
                onOpenReview={() => {
                    if (!session.metadata?.path || !session.active) return
                    openSessionReviewWindow(baseUrl, session.id, { mode: 'branch' })
                }}
                onEdit={() => setEditOpen(true)}
                onCloseSession={() => setCloseOpen(true)}
                anchorPoint={menuAnchorPoint}
                menuId={menuId}
            />

            <SessionEditDialog
                isOpen={editOpen}
                onClose={() => setEditOpen(false)}
                currentName={title}
                currentDirectory={session.metadata?.worktree?.basePath ?? session.metadata?.path ?? ''}
                onSave={updateSession}
                isPending={isPending}
            />

            <StartupCommandDialog
                isOpen={startupCommandOpen}
                onClose={() => setStartupCommandOpen(false)}
                currentCommand={session.metadata?.startupCommand ?? ''}
                currentAutoRespawn={session.metadata?.autoRespawn === true}
                currentPinned={session.metadata?.pinned === true}
                onSave={(options) => setShellOptions(options)}
                isPending={isPending}
            />

            <ConfirmDialog
                isOpen={closeOpen}
                onClose={() => setCloseOpen(false)}
                title={t('dialog.close.title')}
                description={t('dialog.close.description', { name: title })}
                confirmLabel={t('dialog.close.confirm')}
                confirmingLabel={t('dialog.close.confirming')}
                onConfirm={handleCloseSession}
                isPending={isPending}
                destructive
            />
        </>
    )
}
