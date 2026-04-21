import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { SessionSummary } from '@/types/api'
import type { ApiClient } from '@/api/client'
import { useLongPress } from '@/hooks/useLongPress'
import { usePlatform } from '@/hooks/usePlatform'
import { useSessionActions } from '@/hooks/mutations/useSessionActions'
import { SessionActionMenu } from '@/components/SessionActionMenu'
import { SessionEditDialog } from '@/components/SessionEditDialog'
import { StartupCommandDialog } from '@/components/StartupCommandDialog'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useTranslation } from '@/lib/use-translation'
import { useAppContext } from '@/lib/app-context'
import { queryKeys } from '@/lib/query-keys'
import { openSessionExplorerWindow } from '@/utils/sessionExplorer'
import { openSessionReviewWindow } from '@/utils/sessionReview'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

type SessionGroup = {
    directory: string
    displayName: string
    sessions: SessionSummary[]
    latestUpdatedAt: number
    hasActiveSession: boolean
}

type SessionRow = {
    key: string
    sessions: SessionSummary[]
    paired: boolean
    isChild?: boolean
}

type GroupRenderState = {
    group: SessionGroup
    isCollapsed: boolean
    orderedRows: SessionRow[]
    subgroups: SessionSubgroup[]
    shouldShowSubgroups: boolean
}

type VirtualHeaderItem = {
    key: string
    kind: 'header'
    groupState: GroupRenderState
}

type VirtualSubgroupItem = {
    key: string
    kind: 'subgroup'
    groupState: GroupRenderState
    subgroup: SessionSubgroup
}

type VirtualRowItem = {
    key: string
    kind: 'row'
    groupState: GroupRenderState
    subgroup: SessionSubgroup
    row: SessionRow
    rowIndex: number
}

type VirtualListItem = VirtualHeaderItem | VirtualSubgroupItem | VirtualRowItem

type VirtualItemLayout = {
    item: VirtualListItem
    start: number
    size: number
    end: number
}

type ViewportMetrics = {
    start: number
    height: number
}

const HEADER_HEIGHT_ESTIMATE = 48
const SUBGROUP_HEIGHT_ESTIMATE = 34
const ROW_HEIGHT_ESTIMATE = 112
const PAIRED_ROW_HEIGHT_ESTIMATE = 176
const VIRTUAL_OVERSCAN_PX = 500

type SessionSubgroup = {
    key: string
    label: string
    hint?: string
    rows: SessionRow[]
    kind: 'folder' | 'worktree'
}

type SessionListOrders = {
    groups: string[]
    subgroups: Record<string, string[]>
    rows: Record<string, string[]>
}

function getGroupDisplayName(directory: string): string {
    if (directory === 'Other') return directory
    const parts = directory.split(/[\\/]+/).filter(Boolean)
    if (parts.length === 0) return directory
    if (parts.length === 1) return parts[0]
    return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
}

function groupSessionsByDirectory(sessions: SessionSummary[]): SessionGroup[] {
    const groups = new Map<string, SessionSummary[]>()

    sessions.forEach(session => {
        const path = session.metadata?.worktree?.basePath ?? session.metadata?.path ?? 'Other'
        if (!groups.has(path)) {
            groups.set(path, [])
        }
        groups.get(path)!.push(session)
    })

    return Array.from(groups.entries())
        .map(([directory, groupSessions]) => {
            const sortedSessions = [...groupSessions].sort((a, b) => {
                const rankA = a.active ? 0 : 1
                const rankB = b.active ? 0 : 1
                if (rankA !== rankB) return rankA - rankB
                return b.updatedAt - a.updatedAt
            })
            const latestUpdatedAt = groupSessions.reduce(
                (max, s) => (s.updatedAt > max ? s.updatedAt : max),
                -Infinity
            )
            const hasActiveSession = groupSessions.some(s => s.active)
            const displayName = getGroupDisplayName(directory)

            return { directory, displayName, sessions: sortedSessions, latestUpdatedAt, hasActiveSession }
        })
        .sort((a, b) => {
            if (a.hasActiveSession !== b.hasActiveSession) {
                return a.hasActiveSession ? -1 : 1
            }
            return b.latestUpdatedAt - a.latestUpdatedAt
        })
}

function PlusIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
    )
}

function PinIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
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

function ChevronIcon(props: { className?: string; collapsed?: boolean }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`${props.className ?? ''} transition-transform duration-200 ${props.collapsed ? '' : 'rotate-90'}`}
        >
            <polyline points="9 18 15 12 9 6" />
        </svg>
    )
}

function GripVerticalIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <circle cx="9" cy="5" r="1" />
            <circle cx="9" cy="12" r="1" />
            <circle cx="9" cy="19" r="1" />
            <circle cx="15" cy="5" r="1" />
            <circle cx="15" cy="12" r="1" />
            <circle cx="15" cy="19" r="1" />
        </svg>
    )
}

function getSessionTitle(session: SessionSummary): string {
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

function getAgentLabel(session: SessionSummary): string {
    const flavor = session.metadata?.flavor?.trim()
    if (flavor) return flavor
    return 'unknown'
}

function getTerminalSupervisionTone(session: SessionSummary): string {
    const role = session.metadata?.terminalPair?.role ?? session.metadata?.terminalSupervision?.role
    if (role === 'worker') {
        return 'bg-amber-500/8'
    }
    if (role === 'supervisor') {
        return 'bg-sky-500/8'
    }
    return ''
}

export function getSessionRows(groupSessions: SessionSummary[]): SessionRow[] {
    const byId = new Map(groupSessions.map((session) => [session.id, session]))
    const visited = new Set<string>()

    // Pass 1: match terminal pairs/supervision across ALL sessions first
    // This ensures pair grouping takes priority over parent-child indentation
    const pairRows = new Map<string, SessionRow>()
    for (const session of groupSessions) {
        if (visited.has(session.id)) continue
        const pairId = session.metadata?.terminalPair?.pairId
        const peerId = pairId
            ? groupSessions.find((c) =>
                c.id !== session.id && c.metadata?.terminalPair?.pairId === pairId
            )?.id
            : session.metadata?.terminalSupervision?.peerSessionId
        const peer = peerId ? byId.get(peerId) : undefined
        if (peer && !visited.has(peer.id)) {
            const ordered = [session, peer].sort((a, b) => {
                const aRank = (a.metadata?.terminalPair?.role ?? a.metadata?.terminalSupervision?.role) === 'worker' ? 0 : 1
                const bRank = (b.metadata?.terminalPair?.role ?? b.metadata?.terminalSupervision?.role) === 'worker' ? 0 : 1
                return aRank - bRank
            })
            ordered.forEach((s) => visited.add(s.id))
            const row: SessionRow = {
                key: ordered.map((s) => s.id).join(':'),
                sessions: ordered,
                paired: true
            }
            for (const s of ordered) pairRows.set(s.id, row)
        }
    }

    // Pass 2: classify unpaired sessions into parent-child hierarchy
    const childIds = new Set<string>()
    const childrenByParent = new Map<string, SessionSummary[]>()
    for (const session of groupSessions) {
        if (visited.has(session.id)) continue
        const parentId = session.metadata?.parentSessionId
        if (parentId && byId.has(parentId)) {
            childIds.add(session.id)
            const siblings = childrenByParent.get(parentId) ?? []
            siblings.push(session)
            childrenByParent.set(parentId, siblings)
        }
    }

    // Pass 3: assemble rows in original order — parent + children, pairs inline
    const rows: SessionRow[] = []
    const emitted = new Set<string>()

    for (const session of groupSessions) {
        if (emitted.has(session.id)) continue

        // Emit pair row (once, at position of first member encountered)
        const pairRow = pairRows.get(session.id)
        if (pairRow) {
            pairRow.sessions.forEach((s) => emitted.add(s.id))
            rows.push(pairRow)
            continue
        }

        // Skip child sessions here — they're emitted after their parent
        if (childIds.has(session.id)) continue

        emitted.add(session.id)
        rows.push({
            key: session.id,
            sessions: [session],
            paired: false
        })

        // Emit children right after parent
        const children = childrenByParent.get(session.id)
        if (children) {
            for (const child of children) {
                if (!emitted.has(child.id)) {
                    emitted.add(child.id)
                    rows.push({
                        key: child.id,
                        sessions: [child],
                        paired: false,
                        isChild: true
                    })
                }
            }
        }
    }

    return rows
}

function getSubgroupIdentity(row: SessionRow): { key: string; label: string; hint?: string; kind: 'folder' | 'worktree' } {
    const primarySession = row.sessions[0]
    const worktree = primarySession?.metadata?.worktree
    if (worktree) {
        const label = worktree.name?.trim() || worktree.branch.trim()
        const hint = worktree.name?.trim() && worktree.name !== worktree.branch
            ? worktree.branch
            : undefined
        return {
            key: `worktree:${worktree.worktreePath ?? primarySession.metadata?.path ?? primarySession.id}`,
            label,
            hint,
            kind: 'worktree'
        }
    }

    return {
        key: 'folder:main',
        label: 'Folder',
        kind: 'folder'
    }
}

export function getSessionSubgroups(_groupDirectory: string, orderedRows: SessionRow[]): SessionSubgroup[] {
    const subgroupMap = new Map<string, SessionSubgroup>()

    for (const row of orderedRows) {
        const subgroupIdentity = getSubgroupIdentity(row)
        const existing = subgroupMap.get(subgroupIdentity.key)
        if (existing) {
            existing.rows.push(row)
            continue
        }
        subgroupMap.set(subgroupIdentity.key, {
            key: subgroupIdentity.key,
            label: subgroupIdentity.label,
            hint: subgroupIdentity.hint,
            kind: subgroupIdentity.kind,
            rows: [row]
        })
    }

    const subgroups = Array.from(subgroupMap.values())
    subgroups.sort((left, right) => {
        if (left.kind !== right.kind) {
            return left.kind === 'folder' ? -1 : 1
        }
        return left.label.localeCompare(right.label)
    })

    return subgroups
}

const SESSION_ORDER_KEY = 'maglev-session-order-v2'

function getRowOrderKey(groupDir: string, subgroupKey: string): string {
    return `${groupDir}::${subgroupKey}`
}

function loadSessionOrders(): SessionListOrders {
    try {
        const raw = localStorage.getItem(SESSION_ORDER_KEY)
        const parsed = raw ? JSON.parse(raw) : null
        if (!parsed || typeof parsed !== 'object') {
            return { groups: [], subgroups: {}, rows: {} }
        }
        const candidate = parsed as {
            groups?: unknown
            subgroups?: unknown
            rows?: unknown
        }
        return {
            groups: Array.isArray(candidate.groups) ? candidate.groups.filter((value): value is string => typeof value === 'string') : [],
            subgroups: candidate.subgroups && typeof candidate.subgroups === 'object' ? candidate.subgroups as Record<string, string[]> : {},
            rows: candidate.rows && typeof candidate.rows === 'object' ? candidate.rows as Record<string, string[]> : {},
        }
    } catch {
        return { groups: [], subgroups: {}, rows: {} }
    }
}

function saveSessionOrders(orders: SessionListOrders): void {
    try {
        localStorage.setItem(SESSION_ORDER_KEY, JSON.stringify(orders))
    } catch {
        // ignore
    }
}

export function reconcileOrder<T>(items: T[], savedOrder: string[] | undefined, getKey: (item: T) => string): string[] {
    const currentKeys = items.map(getKey)
    const currentKeySet = new Set(currentKeys)
    const next: string[] = []

    for (const key of savedOrder ?? []) {
        if (currentKeySet.has(key) && !next.includes(key)) {
            next.push(key)
        }
    }

    for (const key of currentKeys) {
        if (!next.includes(key)) {
            next.push(key)
        }
    }

    return next
}

function applyCustomOrder<T>(items: T[], savedOrder: string[] | undefined, getKey: (item: T) => string): T[] {
    const orderedKeys = reconcileOrder(items, savedOrder, getKey)
    const byKey = new Map(items.map((item) => [getKey(item), item]))
    return orderedKeys.map((key) => byKey.get(key)).filter((item): item is T => Boolean(item))
}

function estimateVirtualItemHeight(item: VirtualListItem): number {
    if (item.kind === 'header') {
        return HEADER_HEIGHT_ESTIMATE
    }
    if (item.kind === 'subgroup') {
        return SUBGROUP_HEIGHT_ESTIMATE
    }
    return item.row.paired ? PAIRED_ROW_HEIGHT_ESTIMATE : ROW_HEIGHT_ESTIMATE
}

function isWindowScrollContainer(container: HTMLElement | Window): container is Window {
    return typeof window !== 'undefined' && container === window
}

function findScrollContainer(node: HTMLElement | null): HTMLElement | Window {
    let current = node?.parentElement ?? null
    while (current && typeof window !== 'undefined') {
        const style = window.getComputedStyle(current)
        if (/(auto|scroll)/.test(style.overflowY)) {
            return current
        }
        current = current.parentElement
    }
    return window
}

function getViewportMetrics(root: HTMLElement, container: HTMLElement | Window): ViewportMetrics {
    if (typeof window === 'undefined') {
        return { start: 0, height: 0 }
    }

    if (isWindowScrollContainer(container)) {
        const scrollTop = window.scrollY
        const rootTop = root.getBoundingClientRect().top + scrollTop
        return {
            start: Math.max(0, scrollTop - rootTop),
            height: window.innerHeight
        }
    }

    const containerRect = container.getBoundingClientRect()
    const rootRect = root.getBoundingClientRect()
    const rootTop = rootRect.top - containerRect.top + container.scrollTop
    return {
        start: Math.max(0, container.scrollTop - rootTop),
        height: container.clientHeight
    }
}

function VirtualMeasuredItem(props: {
    itemKey: string
    top: number
    onMeasure: (key: string, height: number) => void
    children: React.ReactNode
}) {
    const ref = useRef<HTMLDivElement | null>(null)

    useLayoutEffect(() => {
        const node = ref.current
        if (!node) {
            return
        }

        const measure = () => {
            const nextHeight = Math.ceil(node.getBoundingClientRect().height)
            props.onMeasure(props.itemKey, nextHeight)
        }

        measure()

        if (typeof ResizeObserver === 'undefined') {
            return
        }

        const observer = new ResizeObserver(() => {
            measure()
        })
        observer.observe(node)
        return () => observer.disconnect()
    }, [props.itemKey, props.onMeasure])

    return (
        <div
            ref={ref}
            className="absolute inset-x-0"
            style={{ transform: `translateY(${props.top}px)` }}
        >
            {props.children}
        </div>
    )
}

function formatRelativeTime(value: number, t: (key: string, params?: Record<string, string | number>) => string): string | null {
    const ms = value < 1_000_000_000_000 ? value * 1000 : value
    if (!Number.isFinite(ms)) return null
    const delta = Date.now() - ms
    if (delta < 60_000) return t('session.time.justNow')
    const minutes = Math.floor(delta / 60_000)
    if (minutes < 60) return t('session.time.minutesAgo', { n: minutes })
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return t('session.time.hoursAgo', { n: hours })
    const days = Math.floor(hours / 24)
    if (days < 7) return t('session.time.daysAgo', { n: days })
    return new Date(ms).toLocaleDateString()
}

function SessionItem(props: {
    session: SessionSummary
    sessions: SessionSummary[]
    onSelect: (sessionId: string) => void
    onClone?: (newSessionId: string) => void
    showPath?: boolean
    api: ApiClient | null
    selected?: boolean
}) {
    const { t } = useTranslation()
    const { baseUrl, scopeKey } = useAppContext()
    const queryClient = useQueryClient()
    const { session: s, sessions, onSelect, onClone, showPath = true, api, selected = false } = props
    const { haptic } = usePlatform()
    const [menuOpen, setMenuOpen] = useState(false)
    const [menuAnchorPoint, setMenuAnchorPoint] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
    const [menuAnchorMode, setMenuAnchorMode] = useState<'centered' | 'context'>('centered')
    const [editOpen, setEditOpen] = useState(false)
    const [startupCommandOpen, setStartupCommandOpen] = useState(false)
    const [closeOpen, setCloseOpen] = useState(false)

    const {
        updateSession,
        closeSession,
        setPinned,
        setShellOptions,
        attachTerminalSupervision,
        setTerminalSupervisionPaused,
        detachTerminalSupervision,
        restartTerminalPair,
        setTerminalPairPaused,
        rebindTerminalPair,
        addTerminalPairSupervisor,
        isPending
    } = useSessionActions(
        api,
        s.id,
        s.metadata?.flavor ?? null
    )
    const [attachOpen, setAttachOpen] = useState(false)
    const [addSupervisorOpen, setAddSupervisorOpen] = useState(false)
    const [pairNameInput, setPairNameInput] = useState('')
    const pairLink = s.metadata?.terminalPair
    const supervision = s.metadata?.terminalSupervision
    const attachCandidates = sessions.filter((candidate) =>
        candidate.id !== s.id
        && candidate.metadata?.flavor === 'shell'
        && candidate.metadata?.shellTerminalState === 'ready'
        && !candidate.metadata?.terminalSupervision
        && !candidate.metadata?.terminalPair
    )

    const handleClone = useCallback(async (startupCommand?: string) => {
        if (!api || !s.metadata?.path) return
        try {
            const result = await api.spawnHubSession(
                s.metadata.path,
                `${getSessionTitle(s)} (clone)`,
                undefined,
                undefined,
                s.metadata.pinned,
                s.metadata.autoRespawn,
                startupCommand ?? s.metadata.startupCommand ?? undefined,
                undefined,
                undefined
            )
            if (result.type === 'success') {
                await queryClient.invalidateQueries({ queryKey: ['sessions', scopeKey] })
                onClone?.(result.sessionId)
            }
        } catch {
            // silently fail - session list will refresh naturally
        }
    }, [api, onClone, queryClient, s, scopeKey])

    const longPressHandlers = useLongPress({
        onLongPress: (point) => {
            haptic.impact('medium')
            setMenuAnchorPoint({ x: point.x, y: point.y })
            setMenuAnchorMode(point.source === 'contextmenu' ? 'context' : 'centered')
            setMenuOpen(true)
        },
        onClick: () => {
            if (!menuOpen) {
                onSelect(s.id)
            }
        },
        threshold: 500
    })

    const sessionName = getSessionTitle(s)
    const statusDotClass = s.active
        ? (s.thinking ? 'bg-[#007AFF]' : 'bg-[var(--app-badge-success-text)]')
        : 'bg-[var(--app-hint)]'
    return (
        <>
            <button
                type="button"
                {...longPressHandlers}
                className={`session-list-item flex w-full flex-col gap-1.5 px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)] select-none ${selected ? 'bg-[var(--app-secondary-bg)]' : ''}`}
                style={{ WebkitTouchCallout: 'none' }}
                aria-current={selected ? 'page' : undefined}
            >
                <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                        <span className="flex h-4 w-4 items-center justify-center" aria-hidden="true">
                            <span
                                className={`h-2 w-2 rounded-full ${statusDotClass}`}
                            />
                        </span>
                        <div className="truncate text-base font-medium">
                            {sessionName}
                        </div>
                        {s.metadata?.pinned ? (
                            <span className="text-[var(--app-link)]" title="Pinned shell">
                                <PinIcon />
                            </span>
                        ) : null}
                    </div>
                    <div className="flex items-center gap-2 shrink-0 text-xs">
                        {s.thinking ? (
                            <span className="text-[#007AFF] animate-pulse">
                                {t('session.item.thinking')}
                            </span>
                        ) : null}
                        <span className="text-[var(--app-hint)]">
                            {formatRelativeTime(s.updatedAt, t)}
                        </span>
                    </div>
                </div>
                {showPath ? (
                    <div className="truncate text-xs text-[var(--app-hint)]">
                        {s.metadata?.path ?? s.id}
                    </div>
                ) : null}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--app-hint)]">
                    <span className="inline-flex items-center gap-2">
                        <span className="flex h-4 w-4 items-center justify-center" aria-hidden="true">
                            ❖
                        </span>
                        {getAgentLabel(s)}
                    </span>
                    {pairLink ? (
                        <span className="rounded-full border border-[var(--app-border)] px-2 py-0.5 text-[11px] uppercase tracking-wide">
                            {pairLink.role}
                            {pairLink.state !== 'active' ? ` ${pairLink.state}` : ''}
                        </span>
                    ) : null}
                    {supervision ? (
                        <span className="rounded-full border border-[var(--app-border)] px-2 py-0.5 text-[11px] uppercase tracking-wide">
                            {supervision.role}
                            {supervision.state === 'paused' ? ' paused' : ''}
                        </span>
                    ) : null}
                    {s.metadata?.worktree?.branch ? (
                        <span>{t('session.item.worktree')}: {s.metadata.worktree.branch}</span>
                    ) : null}
                </div>
            </button>

            <SessionActionMenu
                isOpen={menuOpen}
                onClose={() => setMenuOpen(false)}
                sessionActive={s.active}
                canPin={s.metadata?.flavor === 'shell'}
                pinned={s.metadata?.pinned === true}
                onTogglePin={() => {
                    void setPinned(!(s.metadata?.pinned === true))
                }}
                canEditStartupCommand={s.metadata?.flavor === 'shell'}
                onEditStartupCommand={() => setStartupCommandOpen(true)}
                canOpenFolder={Boolean(s.metadata?.path)}
                onOpenFolder={() => {
                    if (!s.metadata?.path) return
                    openSessionExplorerWindow(baseUrl, s.id, { tab: 'directories' })
                }}
                canOpenReview={Boolean(s.active && s.metadata?.path)}
                onOpenReview={() => {
                    if (!s.metadata?.path || !s.active) return
                    openSessionReviewWindow(baseUrl, s.id, { mode: 'branch' })
                }}
                canAttachTerminalSupervision={s.metadata?.flavor === 'shell' && !supervision && !pairLink}
                onAttachTerminalSupervision={() => setAttachOpen(true)}
                canPauseTerminalSupervision={Boolean(supervision && !pairLink)}
                terminalSupervisionPaused={supervision?.state === 'paused'}
                onToggleTerminalSupervisionPaused={() => {
                    if (!supervision) return
                    void setTerminalSupervisionPaused(supervision.state !== 'paused')
                }}
                canDetachTerminalSupervision={Boolean(supervision && !pairLink)}
                onDetachTerminalSupervision={() => {
                    void detachTerminalSupervision()
                }}
                canRestartTerminalPair={Boolean(pairLink)}
                onRestartTerminalPair={() => {
                    void restartTerminalPair()
                }}
                canRebindTerminalPair={Boolean(pairLink)}
                onRebindTerminalPair={() => setAttachOpen(true)}
                canAddTerminalPairSupervisor={Boolean(!pairLink && !supervision && s.metadata?.flavor === 'shell' && s.metadata?.shellTerminalState === 'ready')}
                onAddTerminalPairSupervisor={() => {
                    setPairNameInput(s.metadata?.name || getSessionTitle(s))
                    setAddSupervisorOpen(true)
                }}
                canPauseTerminalPair={Boolean(pairLink)}
                terminalPairPaused={pairLink?.state === 'paused'}
                onToggleTerminalPairPaused={() => {
                    if (!pairLink) return
                    void setTerminalPairPaused(pairLink.state !== 'paused')
                }}
                canClone={Boolean(s.metadata?.path)}
                onClone={() => void handleClone()}
                onCloneWithClaude={() => void handleClone('claude')}
                onCloneWithCodex={() => void handleClone('codex')}
                onEdit={() => setEditOpen(true)}
                onCloseSession={() => setCloseOpen(true)}
                anchorPoint={menuAnchorPoint}
                anchorMode={menuAnchorMode}
            />

            <Dialog open={attachOpen} onOpenChange={setAttachOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{pairLink ? 'Rebind Pair Side' : 'Attach Babysitter'}</DialogTitle>
                        <DialogDescription>
                            {pairLink
                                ? `Choose the replacement shell for the ${pairLink.role} side of this pair.`
                                : 'Choose the worker terminal this session should supervise.'}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="mt-4 flex max-h-[320px] flex-col gap-2 overflow-y-auto">
                        {attachCandidates.length > 0 ? attachCandidates.map((candidate) => (
                            <button
                                key={candidate.id}
                                type="button"
                                className="rounded-lg border border-[var(--app-border)] px-3 py-3 text-left transition-colors hover:bg-[var(--app-subtle-bg)]"
                                onClick={() => {
                                    const action = pairLink
                                        ? rebindTerminalPair(candidate.id)
                                        : attachTerminalSupervision(candidate.id)
                                    void action.then(() => setAttachOpen(false))
                                }}
                            >
                                <div className="font-medium">{getSessionTitle(candidate)}</div>
                                <div className="mt-1 text-xs text-[var(--app-hint)]">{candidate.metadata?.path ?? candidate.id}</div>
                            </button>
                        )) : (
                            <div className="rounded-lg border border-dashed border-[var(--app-border)] px-3 py-4 text-sm text-[var(--app-hint)]">
                                {pairLink
                                    ? 'No eligible replacement shell sessions are available.'
                                    : 'No eligible worker terminals are available.'}
                            </div>
                        )}
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog open={addSupervisorOpen} onOpenChange={setAddSupervisorOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Add New Supervisor</DialogTitle>
                        <DialogDescription>
                            Upgrade this terminal into a linked worker/supervisor shell pair.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="mt-4 flex flex-col gap-3">
                        <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-medium text-[var(--app-hint)]">Pair tag</label>
                            <input
                                type="text"
                                value={pairNameInput}
                                onChange={(event) => setPairNameInput(event.target.value)}
                                className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                                placeholder="Required"
                                disabled={isPending}
                            />
                        </div>
                        <div className="rounded-lg border border-[var(--app-border)] px-3 py-2 text-sm text-[var(--app-hint)]">
                            This will make the current terminal the worker, spawn a new supervisor shell, and keep both shells linked as <code>{pairNameInput.trim() || '<pair>'} worker</code> and <code>{pairNameInput.trim() || '<pair>'} supervisor</code>.
                        </div>
                        <button
                            type="button"
                            className="inline-flex items-center justify-center rounded-md bg-[var(--app-link)] px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={isPending || pairNameInput.trim().length === 0}
                            onClick={() => {
                                void addTerminalPairSupervisor({
                                    name: pairNameInput.trim()
                                }).then(() => setAddSupervisorOpen(false))
                            }}
                        >
                            Create Shell Pair
                        </button>
                    </div>
                </DialogContent>
            </Dialog>

            <SessionEditDialog
                isOpen={editOpen}
                onClose={() => setEditOpen(false)}
                currentName={sessionName}
                currentDirectory={s.metadata?.worktree?.basePath ?? s.metadata?.path ?? ''}
                onSave={updateSession}
                isPending={isPending}
            />

            <StartupCommandDialog
                isOpen={startupCommandOpen}
                onClose={() => setStartupCommandOpen(false)}
                currentCommand={s.metadata?.startupCommand ?? ''}
                currentAutoRespawn={s.metadata?.autoRespawn === true}
                currentPinned={s.metadata?.pinned === true}
                onSave={(options) => setShellOptions(options)}
                isPending={isPending}
            />

            <ConfirmDialog
                isOpen={closeOpen}
                onClose={() => setCloseOpen(false)}
                title={t('dialog.close.title')}
                description={t('dialog.close.description', { name: sessionName })}
                confirmLabel={t('dialog.close.confirm')}
                confirmingLabel={t('dialog.close.confirming')}
                onConfirm={closeSession}
                isPending={isPending}
                destructive
            />
        </>
    )
}

export function SessionList(props: {
    sessions: SessionSummary[]
    onSelect: (sessionId: string) => void
    onClone?: (newSessionId: string) => void
    onNewSession: () => void
    onRefresh: () => void
    isLoading: boolean
    renderHeader?: boolean
    api: ApiClient | null
    selectedSessionId?: string | null
}) {
    const { t } = useTranslation()
    const { renderHeader = true, api, selectedSessionId } = props
    const { scopeKey } = useAppContext()
    const queryClient = useQueryClient()
    const groups = useMemo(
        () => groupSessionsByDirectory(props.sessions),
        [props.sessions]
    )
    const [clearGroupTarget, setClearGroupTarget] = useState<SessionGroup | null>(null)
    const [collapseOverrides, setCollapseOverrides] = useState<Map<string, boolean>>(
        () => new Map()
    )
    const isGroupCollapsed = (group: SessionGroup): boolean => {
        const override = collapseOverrides.get(group.directory)
        if (override !== undefined) return override
        return !group.hasActiveSession
    }

    const toggleGroup = (directory: string, isCollapsed: boolean) => {
        setCollapseOverrides(prev => {
            const next = new Map(prev)
            next.set(directory, !isCollapsed)
            return next
        })
    }

    useEffect(() => {
        setCollapseOverrides(prev => {
            if (prev.size === 0) return prev
            const next = new Map(prev)
            const knownGroups = new Set(groups.map(group => group.directory))
            let changed = false
            for (const directory of next.keys()) {
                if (!knownGroups.has(directory)) {
                    next.delete(directory)
                    changed = true
                }
            }
            return changed ? next : prev
        })
    }, [groups])

    const [sessionOrders, setSessionOrders] = useState<SessionListOrders>(loadSessionOrders)
    const gripActiveRef = useRef(false)
    const draggedRef = useRef<
        | { kind: 'group'; groupDir: string }
        | { kind: 'subgroup'; groupDir: string; subgroupKey: string }
        | { kind: 'row'; groupDir: string; subgroupKey: string; rowKey: string }
        | null
    >(null)
    const [dropIndicator, setDropIndicator] = useState<
        | { kind: 'group'; insertIndex: number }
        | { kind: 'subgroup'; groupDir: string; insertIndex: number }
        | { kind: 'row'; groupDir: string; subgroupKey: string; insertIndex: number }
        | null
    >(null)
    const clearGroupMutation = useMutation({
        mutationFn: async (group: SessionGroup) => {
            if (!api) {
                throw new Error('Session unavailable')
            }

            const failures: string[] = []
            for (const session of group.sessions) {
                try {
                    await api.closeSession(session.id)
                } catch (error) {
                    const message = error instanceof Error ? error.message : t('dialog.error.default')
                    failures.push(`${getSessionTitle(session)}: ${message}`)
                }
            }

            if (failures.length > 0) {
                const preview = failures.slice(0, 2).join(' ')
                const suffix = failures.length > 2 ? ` (+${failures.length - 2} more)` : ''
                throw new Error(preview + suffix)
            }
        },
        onSettled: async (_data, _error, group) => {
            if (!group) {
                return
            }
            for (const session of group.sessions) {
                queryClient.removeQueries({ queryKey: queryKeys.session(scopeKey, session.id) })
            }
            await queryClient.invalidateQueries({ queryKey: queryKeys.sessions(scopeKey) })
        }
    })

    const handleGroupDragStart = useCallback((groupDir: string, e: React.DragEvent) => {
        if (!gripActiveRef.current) {
            e.preventDefault()
            return
        }
        draggedRef.current = { kind: 'group', groupDir }
        e.dataTransfer.effectAllowed = 'move'
        const el = e.currentTarget as HTMLElement
        requestAnimationFrame(() => {
            el.style.opacity = '0.4'
        })
    }, [])

    const handleSubgroupDragStart = useCallback((groupDir: string, subgroupKey: string, e: React.DragEvent) => {
        if (!gripActiveRef.current) {
            e.preventDefault()
            return
        }
        draggedRef.current = { kind: 'subgroup', groupDir, subgroupKey }
        e.dataTransfer.effectAllowed = 'move'
        const el = e.currentTarget as HTMLElement
        requestAnimationFrame(() => {
            el.style.opacity = '0.4'
        })
    }, [])

    const handleRowDragStart = useCallback((groupDir: string, subgroupKey: string, rowKey: string, e: React.DragEvent) => {
        if (!gripActiveRef.current) {
            e.preventDefault()
            return
        }
        draggedRef.current = { kind: 'row', groupDir, subgroupKey, rowKey }
        e.dataTransfer.effectAllowed = 'move'
        const el = e.currentTarget as HTMLElement
        requestAnimationFrame(() => {
            el.style.opacity = '0.4'
        })
    }, [])

    const handleDragEnd = useCallback((e: React.DragEvent) => {
        (e.currentTarget as HTMLElement).style.opacity = ''
        gripActiveRef.current = false
        draggedRef.current = null
        setDropIndicator(null)
    }, [])

    const handleGroupDragOver = useCallback((groupIndex: number, e: React.DragEvent) => {
        const dragged = draggedRef.current
        if (!dragged || dragged.kind !== 'group') return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'

        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
        const midY = rect.top + rect.height / 2
        const insertIndex = e.clientY < midY ? groupIndex : groupIndex + 1

        setDropIndicator(prev => {
            if (prev?.kind === 'group' && prev.insertIndex === insertIndex) return prev
            return { kind: 'group', insertIndex }
        })
    }, [])

    const handleSubgroupDragOver = useCallback((groupDir: string, subgroupIndex: number, e: React.DragEvent) => {
        const dragged = draggedRef.current
        if (!dragged || dragged.kind !== 'subgroup' || dragged.groupDir !== groupDir) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'

        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
        const midY = rect.top + rect.height / 2
        const insertIndex = e.clientY < midY ? subgroupIndex : subgroupIndex + 1

        setDropIndicator(prev => {
            if (prev?.kind === 'subgroup' && prev.groupDir === groupDir && prev.insertIndex === insertIndex) return prev
            return { kind: 'subgroup', groupDir, insertIndex }
        })
    }, [])

    const handleRowDragOver = useCallback((groupDir: string, subgroupKey: string, rowIndex: number, e: React.DragEvent) => {
        const dragged = draggedRef.current
        if (!dragged || dragged.kind !== 'row' || dragged.groupDir !== groupDir || dragged.subgroupKey !== subgroupKey) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'

        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
        const midY = rect.top + rect.height / 2
        const insertIndex = e.clientY < midY ? rowIndex : rowIndex + 1

        setDropIndicator(prev => {
            if (prev?.kind === 'row' && prev.groupDir === groupDir && prev.subgroupKey === subgroupKey && prev.insertIndex === insertIndex) return prev
            return { kind: 'row', groupDir, subgroupKey, insertIndex }
        })
    }, [])

    const handleGroupDrop = (orderedGroups: SessionGroup[], e: React.DragEvent) => {
        e.preventDefault()
        const dragged = draggedRef.current
        if (!dragged || dragged.kind !== 'group' || !dropIndicator || dropIndicator.kind !== 'group') return

        const currentKeys = orderedGroups.map((group) => group.directory)
        const draggedIdx = currentKeys.indexOf(dragged.groupDir)
        if (draggedIdx === -1) return

        const newKeys = [...currentKeys]
        newKeys.splice(draggedIdx, 1)

        let insertIdx = dropIndicator.insertIndex
        if (draggedIdx < insertIdx) insertIdx--

        newKeys.splice(insertIdx, 0, dragged.groupDir)

        const updated = { ...sessionOrders, groups: newKeys }
        setSessionOrders(updated)
        saveSessionOrders(updated)

        draggedRef.current = null
        setDropIndicator(null)
    }

    const handleSubgroupDrop = (groupDir: string, subgroups: SessionSubgroup[], e: React.DragEvent) => {
        e.preventDefault()
        const dragged = draggedRef.current
        if (!dragged || dragged.kind !== 'subgroup' || dragged.groupDir !== groupDir || !dropIndicator || dropIndicator.kind !== 'subgroup' || dropIndicator.groupDir !== groupDir) return

        const currentKeys = subgroups.map((subgroup) => subgroup.key)
        const draggedIdx = currentKeys.indexOf(dragged.subgroupKey)
        if (draggedIdx === -1) return

        const newKeys = [...currentKeys]
        newKeys.splice(draggedIdx, 1)

        let insertIdx = dropIndicator.insertIndex
        if (draggedIdx < insertIdx) insertIdx--

        newKeys.splice(insertIdx, 0, dragged.subgroupKey)

        const updated = {
            ...sessionOrders,
            subgroups: {
                ...sessionOrders.subgroups,
                [groupDir]: newKeys
            }
        }
        setSessionOrders(updated)
        saveSessionOrders(updated)

        draggedRef.current = null
        setDropIndicator(null)
    }

    const handleRowDrop = (groupDir: string, subgroupKey: string, rows: SessionRow[], e: React.DragEvent) => {
        e.preventDefault()
        const dragged = draggedRef.current
        if (!dragged || dragged.kind !== 'row' || dragged.groupDir !== groupDir || dragged.subgroupKey !== subgroupKey || !dropIndicator || dropIndicator.kind !== 'row' || dropIndicator.groupDir !== groupDir || dropIndicator.subgroupKey !== subgroupKey) return

        const currentKeys = rows.map((row) => row.key)
        const draggedIdx = currentKeys.indexOf(dragged.rowKey)
        if (draggedIdx === -1) return

        const newKeys = [...currentKeys]
        newKeys.splice(draggedIdx, 1)

        let insertIdx = dropIndicator.insertIndex
        if (draggedIdx < insertIdx) insertIdx--

        newKeys.splice(insertIdx, 0, dragged.rowKey)

        const rowOrderKey = getRowOrderKey(groupDir, subgroupKey)
        const updated = {
            ...sessionOrders,
            rows: {
                ...sessionOrders.rows,
                [rowOrderKey]: newKeys
            }
        }
        setSessionOrders(updated)
        saveSessionOrders(updated)

        draggedRef.current = null
        setDropIndicator(null)
    }

    const groupRenderStates = useMemo<GroupRenderState[]>(() => {
        const unorderedStates = groups.map((group) => {
            const isCollapsed = isGroupCollapsed(group)
            const rows = getSessionRows(group.sessions)
            const subgroups = applyCustomOrder(
                getSessionSubgroups(group.directory, rows),
                sessionOrders.subgroups[group.directory],
                (subgroup) => subgroup.key
            ).map((subgroup) => ({
                ...subgroup,
                rows: applyCustomOrder(
                    subgroup.rows,
                    sessionOrders.rows[getRowOrderKey(group.directory, subgroup.key)],
                    (row) => row.key
                )
            }))
            const orderedRows = subgroups.flatMap((subgroup) => subgroup.rows)
            const shouldShowSubgroups = subgroups.length > 1 || subgroups.some((subgroup) => subgroup.kind === 'worktree')
            return {
                group,
                isCollapsed,
                orderedRows,
                subgroups,
                shouldShowSubgroups
            }
        })
        return applyCustomOrder(unorderedStates, sessionOrders.groups, (groupState) => groupState.group.directory)
    }, [groups, sessionOrders, collapseOverrides])

    useEffect(() => {
        const nextOrders: SessionListOrders = {
            groups: reconcileOrder(groupRenderStates, sessionOrders.groups, (groupState) => groupState.group.directory),
            subgroups: {},
            rows: {}
        }

        for (const groupState of groupRenderStates) {
            nextOrders.subgroups[groupState.group.directory] = reconcileOrder(
                groupState.subgroups,
                sessionOrders.subgroups[groupState.group.directory],
                (subgroup) => subgroup.key
            )

            for (const subgroup of groupState.subgroups) {
                nextOrders.rows[getRowOrderKey(groupState.group.directory, subgroup.key)] = reconcileOrder(
                    subgroup.rows,
                    sessionOrders.rows[getRowOrderKey(groupState.group.directory, subgroup.key)],
                    (row) => row.key
                )
            }
        }

        if (JSON.stringify(nextOrders) === JSON.stringify(sessionOrders)) {
            return
        }

        setSessionOrders(nextOrders)
        saveSessionOrders(nextOrders)
    }, [groupRenderStates, sessionOrders])

    const virtualItems = useMemo<VirtualListItem[]>(() => {
        return groupRenderStates.flatMap((groupState) => {
            const items: VirtualListItem[] = [{
                key: `header:${groupState.group.directory}`,
                kind: 'header',
                groupState
            }]
            if (!groupState.isCollapsed) {
                let rowIndex = 0
                for (const subgroup of groupState.subgroups) {
                    if (groupState.shouldShowSubgroups) {
                        items.push({
                            key: `subgroup:${groupState.group.directory}:${subgroup.key}`,
                            kind: 'subgroup',
                            groupState,
                            subgroup
                        })
                    }
                    items.push(...subgroup.rows.map((row) => {
                        const item: VirtualRowItem = {
                            key: `row:${groupState.group.directory}:${row.key}`,
                            kind: 'row',
                            groupState,
                            subgroup,
                            row,
                            rowIndex
                        }
                        rowIndex += 1
                        return item
                    }))
                }
            }
            return items
        })
    }, [groupRenderStates])

    const [measuredHeights, setMeasuredHeights] = useState<Record<string, number>>({})
    const virtualRootRef = useRef<HTMLDivElement | null>(null)
    const scrollContainerRef = useRef<HTMLElement | Window | null>(null)
    const [viewport, setViewport] = useState<ViewportMetrics>({ start: 0, height: 0 })

    useEffect(() => {
        const knownKeys = new Set(virtualItems.map((item) => item.key))
        setMeasuredHeights((prev) => {
            let changed = false
            const next: Record<string, number> = {}
            for (const [key, value] of Object.entries(prev)) {
                if (!knownKeys.has(key)) {
                    changed = true
                    continue
                }
                next[key] = value
            }
            return changed ? next : prev
        })
    }, [virtualItems])

    const handleMeasureItem = useCallback((key: string, height: number) => {
        setMeasuredHeights((prev) => {
            if (prev[key] === height) {
                return prev
            }
            return {
                ...prev,
                [key]: height
            }
        })
    }, [])

    useLayoutEffect(() => {
        const root = virtualRootRef.current
        if (!root || typeof window === 'undefined') {
            return
        }

        const container = findScrollContainer(root)
        scrollContainerRef.current = container
        let frame = 0

        const update = () => {
            frame = 0
            const node = virtualRootRef.current
            const target = scrollContainerRef.current
            if (!node || !target) {
                return
            }
            const next = getViewportMetrics(node, target)
            setViewport((prev) => (
                prev.start === next.start && prev.height === next.height
                    ? prev
                    : next
            ))
        }

        const scheduleUpdate = () => {
            if (frame !== 0) {
                return
            }
            frame = window.requestAnimationFrame(update)
        }

        const resizeObserver = typeof ResizeObserver !== 'undefined'
            ? new ResizeObserver(() => scheduleUpdate())
            : null

        resizeObserver?.observe(root)
        if (!isWindowScrollContainer(container)) {
            resizeObserver?.observe(container)
            container.addEventListener('scroll', scheduleUpdate, { passive: true })
        } else {
            window.addEventListener('scroll', scheduleUpdate, { passive: true })
        }
        window.addEventListener('resize', scheduleUpdate)

        update()

        return () => {
            if (frame !== 0) {
                window.cancelAnimationFrame(frame)
            }
            resizeObserver?.disconnect()
            if (!isWindowScrollContainer(container)) {
                container.removeEventListener('scroll', scheduleUpdate)
            } else {
                window.removeEventListener('scroll', scheduleUpdate)
            }
            window.removeEventListener('resize', scheduleUpdate)
        }
    }, [virtualItems.length])

    const itemLayouts = useMemo<VirtualItemLayout[]>(() => {
        let start = 0
        return virtualItems.map((item) => {
            const size = measuredHeights[item.key] ?? estimateVirtualItemHeight(item)
            const layout = {
                item,
                start,
                size,
                end: start + size
            }
            start += size
            return layout
        })
    }, [measuredHeights, virtualItems])

    const totalVirtualHeight = itemLayouts[itemLayouts.length - 1]?.end ?? 0
    const visibleItemLayouts = useMemo(() => {
        if (itemLayouts.length === 0) {
            return []
        }
        if (viewport.height <= 0) {
            return itemLayouts.slice(0, 40)
        }

        const visibleStart = Math.max(0, viewport.start - VIRTUAL_OVERSCAN_PX)
        const visibleEnd = viewport.start + viewport.height + VIRTUAL_OVERSCAN_PX
        return itemLayouts.filter((layout) => layout.end >= visibleStart && layout.start <= visibleEnd)
    }, [itemLayouts, viewport])

    const renderDragHandle = (variant: 'header' | 'row' = 'row') => (
        <div
            className={
                variant === 'header'
                    ? 'flex w-1.5 items-center justify-center cursor-grab shrink-0 opacity-0 group-hover/drag:opacity-70 transition-opacity'
                    : 'flex w-2 items-center justify-center cursor-grab shrink-0 opacity-0 group-hover/drag:opacity-70 transition-opacity'
            }
            onMouseDown={() => { gripActiveRef.current = true }}
            onMouseUp={() => { gripActiveRef.current = false }}
        >
            <GripVerticalIcon className={variant === 'header' ? 'h-2.5 w-2.5 text-[var(--app-hint)]' : 'h-3 w-3 text-[var(--app-hint)]'} />
        </div>
    )

    const renderVirtualItem = (layout: VirtualItemLayout) => {
        const item = layout.item
        if (item.kind === 'header') {
            const { group, isCollapsed } = item.groupState
            const groupIndex = groupRenderStates.findIndex((groupState) => groupState.group.directory === group.directory)
            const isDropBefore = dropIndicator?.kind === 'group' && dropIndicator.insertIndex === groupIndex
            const isDropAfter = dropIndicator?.kind === 'group'
                && dropIndicator.insertIndex === groupRenderStates.length
                && groupIndex === groupRenderStates.length - 1
            const dropClass = isDropBefore
                ? 'shadow-[inset_0_2px_0_0_#007AFF]'
                : isDropAfter
                    ? 'shadow-[inset_0_-2px_0_0_#007AFF]'
                    : ''
            return (
                <div
                    draggable
                    onDragStart={(e) => handleGroupDragStart(group.directory, e)}
                    onDragEnd={handleDragEnd}
                    onDragOver={(e) => handleGroupDragOver(groupIndex, e)}
                    onDrop={(e) => handleGroupDrop(groupRenderStates.map((groupState) => groupState.group), e)}
                    className={`group/drag flex items-center gap-2 border-b border-[var(--app-divider)] bg-[var(--app-secondary-bg)] px-3 py-2 ${dropClass}`}
                >
                    {renderDragHandle('header')}
                    <button
                        type="button"
                        onClick={() => toggleGroup(group.directory, isCollapsed)}
                        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-[var(--app-subtle-bg)]"
                    >
                        <ChevronIcon
                            className="h-4 w-4 text-[var(--app-hint)]"
                            collapsed={isCollapsed}
                        />
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                            <span className="font-medium text-base break-words" title={group.directory}>
                                {group.displayName}
                            </span>
                            <span className="shrink-0 text-xs text-[var(--app-hint)]">
                                ({group.sessions.length})
                            </span>
                        </div>
                    </button>
                    <button
                        type="button"
                        onClick={() => setClearGroupTarget(group)}
                        disabled={!api || clearGroupMutation.isPending}
                        className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                        title={t('session.group.clearAll')}
                    >
                        {clearGroupMutation.isPending && clearGroupTarget?.directory === group.directory
                            ? t('dialog.clearGroup.confirming')
                            : t('session.group.clearAll')}
                    </button>
                </div>
            )
        }

        if (item.kind === 'subgroup') {
            const subgroupIndex = item.groupState.subgroups.findIndex((subgroup) => subgroup.key === item.subgroup.key)
            const isDropBefore = dropIndicator?.kind === 'subgroup'
                && dropIndicator.groupDir === item.groupState.group.directory
                && dropIndicator.insertIndex === subgroupIndex
            const isDropAfter = dropIndicator?.kind === 'subgroup'
                && dropIndicator.groupDir === item.groupState.group.directory
                && dropIndicator.insertIndex === item.groupState.subgroups.length
                && subgroupIndex === item.groupState.subgroups.length - 1
            const dropClass = isDropBefore
                ? 'shadow-[inset_0_2px_0_0_#007AFF]'
                : isDropAfter
                    ? 'shadow-[inset_0_-2px_0_0_#007AFF]'
                    : ''
            return (
                <div
                    draggable
                    onDragStart={(e) => handleSubgroupDragStart(item.groupState.group.directory, item.subgroup.key, e)}
                    onDragEnd={handleDragEnd}
                    onDragOver={(e) => handleSubgroupDragOver(item.groupState.group.directory, subgroupIndex, e)}
                    onDrop={(e) => handleSubgroupDrop(item.groupState.group.directory, item.groupState.subgroups, e)}
                    className={`group/drag flex items-center gap-2 border-b border-[var(--app-divider)] bg-[var(--app-secondary-bg)]/55 px-3 py-1.5 text-[11px] uppercase tracking-wide text-[var(--app-hint)] ${dropClass}`}
                >
                    {renderDragHandle('header')}
                    <span className="font-medium">{item.subgroup.label}</span>
                    {item.subgroup.hint ? (
                        <span className="rounded-full border border-[var(--app-border)] px-2 py-0.5 normal-case tracking-normal text-[10px] text-[var(--app-fg)]">
                            {item.subgroup.hint}
                        </span>
                    ) : null}
                </div>
            )
        }

        const { row, groupState } = item
        const subgroupRowIndex = item.subgroup.rows.findIndex((subgroupRow) => subgroupRow.key === row.key)
        const isDropBefore = dropIndicator?.kind === 'row'
            && dropIndicator.groupDir === groupState.group.directory
            && dropIndicator.subgroupKey === item.subgroup.key
            && dropIndicator.insertIndex === subgroupRowIndex
        const isDropAfter = dropIndicator?.kind === 'row'
            && dropIndicator.groupDir === groupState.group.directory
            && dropIndicator.subgroupKey === item.subgroup.key
            && dropIndicator.insertIndex === item.subgroup.rows.length
            && subgroupRowIndex === item.subgroup.rows.length - 1
        const dropClass = isDropBefore
            ? 'shadow-[inset_0_2px_0_0_#007AFF]'
            : isDropAfter
                ? 'shadow-[inset_0_-2px_0_0_#007AFF]'
                : ''

        return (
            <div
                draggable
                onDragStart={(e) => handleRowDragStart(groupState.group.directory, item.subgroup.key, row.key, e)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => handleRowDragOver(groupState.group.directory, item.subgroup.key, subgroupRowIndex, e)}
                onDrop={(e) => handleRowDrop(groupState.group.directory, item.subgroup.key, item.subgroup.rows, e)}
                className={`group/drag flex items-stretch border-b border-[var(--app-divider)] ${dropClass}`}
            >
                {renderDragHandle('row')}
                <div className={`flex-1 min-w-0 ${row.paired ? 'rounded-xl border border-[var(--app-divider)]/70 bg-[var(--app-secondary-bg)]/40 mx-2 my-2 overflow-hidden' : ''} ${row.isChild ? 'pl-5 border-l-2 border-l-[var(--app-hint)]/20' : ''}`}>
                    {row.sessions.map((session, index) => (
                        <div
                            key={session.id}
                            className={`${getTerminalSupervisionTone(session)} ${row.paired && index > 0 ? 'border-t border-[var(--app-divider)]/60' : ''}`}
                        >
                            <SessionItem
                                session={session}
                                sessions={props.sessions}
                                onSelect={props.onSelect}
                                onClone={props.onClone}
                                showPath={false}
                                api={api}
                                selected={session.id === selectedSessionId}
                            />
                        </div>
                    ))}
                </div>
            </div>
        )
    }

    return (
        <div className="mx-auto w-full max-w-content flex flex-col">
            {renderHeader ? (
                <div className="flex items-center justify-between px-3 py-1">
                    <div className="text-xs text-[var(--app-hint)]">
                        {t('sessions.count', { n: props.sessions.length, m: groups.length })}
                    </div>
                    <button
                        type="button"
                        onClick={props.onNewSession}
                        className="session-list-new-button p-1.5 rounded-full text-[var(--app-link)] transition-colors"
                        title={t('sessions.new')}
                    >
                        <PlusIcon className="h-5 w-5" />
                    </button>
                </div>
            ) : null}

            <div
                ref={virtualRootRef}
                className="relative"
                style={{ height: totalVirtualHeight > 0 ? `${totalVirtualHeight}px` : undefined }}
                onDragLeave={(e) => {
                    const related = e.relatedTarget as Node | null
                    if (!related || !e.currentTarget.contains(related)) {
                        setDropIndicator(null)
                    }
                }}
            >
                {visibleItemLayouts.map((layout) => (
                    <VirtualMeasuredItem
                        key={layout.item.key}
                        itemKey={layout.item.key}
                        top={layout.start}
                        onMeasure={handleMeasureItem}
                    >
                        {renderVirtualItem(layout)}
                    </VirtualMeasuredItem>
                ))}
            </div>

            <ConfirmDialog
                isOpen={clearGroupTarget !== null}
                onClose={() => {
                    if (!clearGroupMutation.isPending) {
                        setClearGroupTarget(null)
                    }
                }}
                title={t('dialog.clearGroup.title')}
                description={t('dialog.clearGroup.description', {
                    name: clearGroupTarget?.displayName ?? '',
                    count: clearGroupTarget?.sessions.length ?? 0
                })}
                confirmLabel={t('dialog.clearGroup.confirm')}
                confirmingLabel={t('dialog.clearGroup.confirming')}
                onConfirm={async () => {
                    if (!clearGroupTarget) {
                        return
                    }
                    await clearGroupMutation.mutateAsync(clearGroupTarget)
                    setClearGroupTarget(null)
                }}
                isPending={clearGroupMutation.isPending}
                destructive
            />
        </div>
    )
}
