import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ApiClient } from '@/api/client'
import { FileIcon } from '@/components/FileIcon'
import { useSessionDirectory } from '@/hooks/queries/useSessionDirectory'

function ChevronIcon(props: { className?: string; collapsed: boolean }) {
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

function DirectorySkeleton(props: { depth: number; rows?: number }) {
    const rows = props.rows ?? 4
    const indent = 12 + props.depth * 18

    return (
        <div className="animate-pulse">
            {Array.from({ length: rows }).map((_, index) => (
                <div
                    key={`dir-skel-${props.depth}-${index}`}
                    className="flex items-center gap-2 px-3 py-1.5"
                    style={{ paddingLeft: indent }}
                >
                    <div className="h-4 w-4 rounded bg-[var(--app-subtle-bg)]" />
                    <div className="h-3 w-40 rounded bg-[var(--app-subtle-bg)]" />
                </div>
            ))}
        </div>
    )
}

function DirectoryErrorRow(props: { depth: number; message: string }) {
    const indent = 12 + props.depth * 18
    return (
        <div
            className="bg-amber-500/10 px-3 py-2 text-xs text-[var(--app-hint)]"
            style={{ paddingLeft: indent }}
        >
            {props.message}
        </div>
    )
}

function DirectoryFileRow(props: {
    filePath: string
    fileName: string
    childIndent: number
    isActive: boolean
    onOpenFile: (path: string) => void
}) {
    const activeButtonRef = useRef<HTMLButtonElement | null>(null)

    useEffect(() => {
        if (props.isActive) {
            activeButtonRef.current?.scrollIntoView({ block: 'nearest' })
        }
    }, [props.isActive])

    return (
        <button
            ref={activeButtonRef}
            type="button"
            onClick={() => props.onOpenFile(props.filePath)}
            className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors ${
                props.isActive
                    ? 'bg-[var(--app-subtle-bg)] text-[var(--app-fg)]'
                    : 'text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]'
            }`}
            style={{ paddingLeft: props.childIndent }}
        >
            <span className="h-4 w-4 shrink-0" />
            <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                <FileIcon fileName={props.fileName} size={18} />
            </span>
            <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-[var(--app-fg)]">
                    {props.fileName}
                </div>
            </div>
        </button>
    )
}

function DirectoryNode(props: {
    api: ApiClient | null
    sessionId: string
    path: string
    label: string
    depth: number
    onOpenFile: (path: string) => void
    activePath?: string | null
    expanded: Set<string>
    onToggle: (path: string) => void
}) {
    const isExpanded = props.expanded.has(props.path)
    const { entries, error, isLoading } = useSessionDirectory(props.api, props.sessionId, props.path, {
        enabled: isExpanded
    })

    const directories = useMemo(() => entries.filter((entry) => entry.type === 'directory'), [entries])
    const files = useMemo(() => entries.filter((entry) => entry.type === 'file'), [entries])
    const childDepth = props.depth + 1

    const indent = 12 + props.depth * 18
    const childIndent = 12 + childDepth * 18
    const hasActiveDescendant = Boolean(props.activePath && (
        props.path === ''
            ? true
            : props.activePath === props.path || props.activePath.startsWith(`${props.path}/`)
    ))

    return (
        <div>
            <button
                type="button"
                onClick={() => props.onToggle(props.path)}
                className={`flex w-full items-center gap-2 px-3 py-1 text-left text-[11px] font-medium uppercase tracking-wide transition-colors ${
                    hasActiveDescendant
                        ? 'bg-[var(--app-subtle-bg)] text-[var(--app-fg)]'
                        : 'text-[var(--app-hint)]/85 hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]'
                }`}
                style={{ paddingLeft: indent }}
            >
                <ChevronIcon collapsed={!isExpanded} className={`h-3.5 w-3.5 shrink-0 ${hasActiveDescendant ? 'text-[var(--app-link)]' : 'text-[var(--app-hint)]'}`} />
                <span className="truncate">{props.label}</span>
            </button>

            {isExpanded ? (
                isLoading ? (
                    <DirectorySkeleton depth={childDepth} />
                ) : error ? (
                    <DirectoryErrorRow depth={childDepth} message={error} />
                ) : (
                    <div>
                        {directories.map((entry) => {
                            const childPath = props.path ? `${props.path}/${entry.name}` : entry.name
                            return (
                                <DirectoryNode
                                    key={childPath}
                                    api={props.api}
                                    sessionId={props.sessionId}
                                    path={childPath}
                                    label={entry.name}
                                    depth={childDepth}
                                    onOpenFile={props.onOpenFile}
                                    activePath={props.activePath}
                                    expanded={props.expanded}
                                    onToggle={props.onToggle}
                                />
                            )
                        })}

                        {files.map((entry) => {
                            const filePath = props.path ? `${props.path}/${entry.name}` : entry.name
                            const isActive = props.activePath === filePath
                            return (
                                <DirectoryFileRow
                                    key={filePath}
                                    filePath={filePath}
                                    fileName={entry.name}
                                    childIndent={childIndent}
                                    isActive={isActive}
                                    onOpenFile={props.onOpenFile}
                                />
                            )
                        })}

                        {directories.length === 0 && files.length === 0 ? (
                            <div
                                className="px-3 py-2 text-sm text-[var(--app-hint)]"
                                style={{ paddingLeft: childIndent }}
                            >
                                Empty directory.
                            </div>
                        ) : null}
                    </div>
                )
            ) : null}
        </div>
    )
}

export function DirectoryTree(props: {
    api: ApiClient | null
    sessionId: string
    rootLabel: string
    onOpenFile: (path: string) => void
    activePath?: string | null
}) {
    const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['']))

    useEffect(() => {
        if (!props.activePath) {
            return
        }

        const parts = props.activePath.split('/').filter(Boolean)
        const ancestors = new Set<string>([''])
        let current = ''
        for (const part of parts.slice(0, -1)) {
            current = current ? `${current}/${part}` : part
            ancestors.add(current)
        }

        setExpanded((prev) => {
            let changed = false
            const next = new Set(prev)
            for (const ancestor of ancestors) {
                if (!next.has(ancestor)) {
                    next.add(ancestor)
                    changed = true
                }
            }
            return changed ? next : prev
        })
    }, [props.activePath])

    const handleToggle = useCallback((path: string) => {
        setExpanded((prev) => {
            const next = new Set(prev)
            if (next.has(path)) {
                next.delete(path)
            } else {
                next.add(path)
            }
            return next
        })
    }, [])

    return (
        <div>
            <DirectoryNode
                api={props.api}
                sessionId={props.sessionId}
                path=""
                label={props.rootLabel}
                depth={0}
                onOpenFile={props.onOpenFile}
                activePath={props.activePath}
                expanded={expanded}
                onToggle={handleToggle}
            />
        </div>
    )
}
