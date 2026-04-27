import type { Session, TerminalPairLink, TerminalSupervision, WorktreeMetadata } from './schemas'

export type SessionSummaryMetadata = {
    name?: string
    path: string
    branch?: string
    machineId?: string
    summary?: { text: string }
    flavor?: string | null
    worktree?: WorktreeMetadata
    notesPath?: string
    parentSessionId?: string
    pinned?: boolean
    autoRespawn?: boolean
    startupCommand?: string
    shellTerminalId?: string
    shellTerminalState?: 'ready' | 'stale'
    terminalSupervision?: TerminalSupervision
    terminalPair?: TerminalPairLink
}

export type SessionSummary = {
    id: string
    active: boolean
    thinking: boolean
    activeAt: number
    updatedAt: number
    metadata: SessionSummaryMetadata | null
}

export function toSessionSummary(session: Session): SessionSummary {
    const metadata: SessionSummaryMetadata | null = session.metadata ? {
        name: session.metadata.name,
        path: session.metadata.path,
        branch: session.metadata.branch,
        machineId: session.metadata.machineId ?? undefined,
        summary: session.metadata.summary ? { text: session.metadata.summary.text } : undefined,
        flavor: session.metadata.flavor ?? null,
        worktree: session.metadata.worktree,
        notesPath: session.metadata.notesPath,
        parentSessionId: session.metadata.parentSessionId,
        pinned: session.metadata.pinned,
        autoRespawn: session.metadata.autoRespawn,
        startupCommand: session.metadata.startupCommand,
        shellTerminalId: session.metadata.shellTerminalId,
        shellTerminalState: session.metadata.shellTerminalState,
        terminalSupervision: session.metadata.terminalSupervision,
        terminalPair: session.metadata.terminalPair
    } : null

    return {
        id: session.id,
        active: session.active,
        thinking: session.thinking,
        activeAt: session.activeAt,
        updatedAt: session.updatedAt,
        metadata
    }
}
