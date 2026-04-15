import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { ApiClient } from '@/api/client'
import type { Machine } from '@/types/api'
import { usePlatform } from '@/hooks/usePlatform'
import { useSpawnSession } from '@/hooks/mutations/useSpawnSession'
import { useSessions } from '@/hooks/queries/useSessions'
import { useHubConfig } from '@/hooks/queries/useHubConfig'
import { useActiveSuggestions, type Suggestion } from '@/hooks/useActiveSuggestions'
import { useDirectorySuggestions } from '@/hooks/useDirectorySuggestions'
import { useRecentPaths } from '@/hooks/useRecentPaths'
import type { SessionType } from './types'
import { ActionButtons } from './ActionButtons'
import { DirectorySection } from './DirectorySection'
import { SessionTypeSelector } from './SessionTypeSelector'
import { formatRunnerSpawnError } from '../../utils/formatRunnerSpawnError'

export function NewSession(props: {
    api: ApiClient
    machine: Machine | null
    isLoading?: boolean
    onSuccess: (sessionId: string, agent: 'shell') => void
    onCancel: () => void
}) {
    const { haptic } = usePlatform()
    const { spawnSession, spawnTerminalPair, isPending, error: spawnError } = useSpawnSession(props.api)
    const { sessions } = useSessions(props.api)
    const { folders: hubFolders } = useHubConfig(props.api)
    const isFormDisabled = Boolean(isPending || props.isLoading)
    const {
        getRecentPaths,
        addRecentPath,
        savedPaths,
        addSavedPath,
        removeSavedPath,
        isSavedPath
    } = useRecentPaths()

    const [directory, setDirectory] = useState('')
    const [launchMode, setLaunchMode] = useState<'single' | 'pair'>('single')
    const [name, setName] = useState('')
    const [notesEnabled, setNotesEnabled] = useState(false)
    const [notesMode, setNotesMode] = useState<'existing' | 'create'>('create')
    const [notesPath, setNotesPath] = useState('notes.txt')
    const [pinned, setPinned] = useState(true)
    const [autoRespawn, setAutoRespawn] = useState(true)
    const [startupCommand, setStartupCommand] = useState('')
    const [suppressSuggestions, setSuppressSuggestions] = useState(false)
    const [isDirectoryFocused, setIsDirectoryFocused] = useState(false)
    const [pathExistence, setPathExistence] = useState<Record<string, boolean>>({})
    const [sessionType, setSessionType] = useState<SessionType>('simple')
    const [worktreeName, setWorktreeName] = useState('')
    const [error, setError] = useState<string | null>(null)
    const worktreeInputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        if (sessionType === 'worktree') {
            worktreeInputRef.current?.focus()
        }
    }, [sessionType])

    const runnerSpawnError = useMemo(
        () => formatRunnerSpawnError(props.machine),
        [props.machine]
    )

    const recentPaths = useMemo(
        () => getRecentPaths(),
        [getRecentPaths]
    )
    useEffect(() => {
        if (directory.trim() || recentPaths.length === 0) {
            return
        }
        setDirectory(recentPaths[0] ?? '')
    }, [directory, recentPaths])
    const trimmedDirectory = directory.trim()
    const trimmedNotesPath = notesPath.trim()
    const canSaveCurrentPath = trimmedDirectory.length > 0
    const currentPathSaved = isSavedPath(trimmedDirectory)

    const allPaths = useDirectorySuggestions(sessions, recentPaths)

    const pathsToCheck = useMemo(
        () => Array.from(new Set(allPaths)).slice(0, 1000),
        [allPaths]
    )

    useEffect(() => {
        let cancelled = false

        if (!props.machine?.active || pathsToCheck.length === 0) {
            setPathExistence({})
            return () => { cancelled = true }
        }

        void props.api.checkHubPathsExists(pathsToCheck)
            .then((result) => {
                if (cancelled) return
                setPathExistence(result.exists ?? {})
            })
            .catch(() => {
                if (cancelled) return
                setPathExistence({})
            })

        return () => {
            cancelled = true
        }
    }, [pathsToCheck, props.api, props.machine])

    const verifiedPaths = useMemo(
        () => allPaths.filter((path) => pathExistence[path]),
        [allPaths, pathExistence]
    )

    const getSuggestions = useCallback(async (query: string): Promise<Suggestion[]> => {
        const lowered = query.toLowerCase()
        return verifiedPaths
            .filter((path) => path.toLowerCase().includes(lowered))
            .slice(0, 8)
            .map((path) => ({
                key: path,
                text: path,
                label: path
            }))
    }, [verifiedPaths])

    const activeQuery = (!isDirectoryFocused || suppressSuggestions) ? null : directory

    const [suggestions, selectedIndex, moveUp, moveDown, clearSuggestions] = useActiveSuggestions(
        activeQuery,
        getSuggestions,
        { allowEmptyQuery: true, autoSelectFirst: false }
    )

    const handlePathClick = useCallback((path: string) => {
        setDirectory(path)
    }, [])

    const handleSaveCurrentPath = useCallback(() => {
        if (!trimmedDirectory) {
            return
        }
        addSavedPath(trimmedDirectory)
    }, [addSavedPath, trimmedDirectory])

    const handleRemoveSavedPath = useCallback((path: string) => {
        removeSavedPath(path)
    }, [removeSavedPath])

    const handleSuggestionSelect = useCallback((index: number) => {
        const suggestion = suggestions[index]
        if (suggestion) {
            setDirectory(suggestion.text)
            clearSuggestions()
            setSuppressSuggestions(true)
        }
    }, [suggestions, clearSuggestions])

    const handleDirectoryChange = useCallback((value: string) => {
        setSuppressSuggestions(false)
        setDirectory(value)
    }, [])

    const handleDirectoryFocus = useCallback(() => {
        setSuppressSuggestions(false)
        setIsDirectoryFocused(true)
    }, [])

    const handleDirectoryBlur = useCallback(() => {
        setIsDirectoryFocused(false)
    }, [])

    const handleDirectoryKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
        if (suggestions.length === 0) return

        if (event.key === 'ArrowUp') {
            event.preventDefault()
            moveUp()
        }

        if (event.key === 'ArrowDown') {
            event.preventDefault()
            moveDown()
        }

        if (event.key === 'Enter' || event.key === 'Tab') {
            if (selectedIndex >= 0) {
                event.preventDefault()
                handleSuggestionSelect(selectedIndex)
            }
        }

        if (event.key === 'Escape') {
            clearSuggestions()
        }
    }, [suggestions, selectedIndex, moveUp, moveDown, clearSuggestions, handleSuggestionSelect])

    async function handleCreate() {
        if (!props.machine?.active || !directory.trim()) return

        setError(null)
        try {
            if (launchMode === 'pair') {
                const result = await spawnTerminalPair({
                    directory: directory.trim(),
                    name: name.trim()
                })
                if (result.type === 'success') {
                    haptic.notification('success')
                    addRecentPath(directory.trim())
                    if (result.pair.workerSessionId) {
                        props.onSuccess(result.pair.workerSessionId, 'shell')
                    } else {
                        props.onCancel()
                    }
                    return
                }
                haptic.notification('error')
                setError(result.message)
                return
            }

            const result = await spawnSession({
                directory: directory.trim(),
                name: name.trim() || undefined,
                notesPath: notesEnabled && trimmedNotesPath ? trimmedNotesPath : undefined,
                createNotesFile: notesEnabled && notesMode === 'create' && trimmedNotesPath.length > 0,
                pinned,
                autoRespawn: pinned ? autoRespawn : undefined,
                startupCommand: startupCommand.trim() || undefined,
                sessionType,
                worktreeName: sessionType === 'worktree' ? (worktreeName.trim() || undefined) : undefined
            })

            if (result.type === 'success') {
                haptic.notification('success')
                addRecentPath(directory.trim())
                props.onSuccess(result.sessionId, 'shell')
                return
            }

            haptic.notification('error')
            setError(result.message)
        } catch (e) {
            haptic.notification('error')
            setError(e instanceof Error ? e.message : 'Failed to create session')
        }
    }

    const machineLabel = props.machine?.metadata?.displayName ?? props.machine?.metadata?.host ?? 'Offline'
    const canCreate = Boolean(
        props.machine?.active
        && directory.trim()
        && (launchMode === 'single' || name.trim())
        && !isFormDisabled
        && (!notesEnabled || trimmedNotesPath.length > 0)
    )

    return (
        <div className="flex min-h-full flex-col divide-y divide-[var(--app-divider)]">
            <div className="flex items-center gap-2 px-3 py-3">
                <button
                    type="button"
                    onClick={() => setLaunchMode('single')}
                    disabled={isFormDisabled}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                        launchMode === 'single'
                            ? 'bg-[var(--app-link)] text-[var(--app-bg)]'
                            : 'bg-[var(--app-subtle-bg)] text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)]'
                    } disabled:opacity-50`}
                >
                    Single
                </button>
                <button
                    type="button"
                    onClick={() => setLaunchMode('pair')}
                    disabled={isFormDisabled}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                        launchMode === 'pair'
                            ? 'bg-[var(--app-link)] text-[var(--app-bg)]'
                            : 'bg-[var(--app-subtle-bg)] text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)]'
                    } disabled:opacity-50`}
                >
                    Pair
                </button>
            </div>
            <div className="flex flex-col gap-1.5 px-3 py-3">
                <label className="text-xs font-medium text-[var(--app-hint)]">
                    {launchMode === 'pair' ? 'Pair name' : 'Session name'}
                </label>
                <input
                    type="text"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder={launchMode === 'pair' ? 'Required' : 'Optional'}
                    disabled={isFormDisabled}
                    className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                />
            </div>
            {launchMode === 'pair' ? (
                <div className="flex flex-col gap-3 px-3 py-3">
                    <div className="text-xs font-medium text-[var(--app-hint)]">Shell pair</div>
                    <div className="text-xs text-[var(--app-hint)]">
                        Creates two pinned shell sessions named <code>{name.trim() || '<pair>'} worker</code> and <code>{name.trim() || '<pair>'} supervisor</code>,
                        keeps them linked for recovery, and restores them as plain shells.
                    </div>
                </div>
            ) : null}
            <div className="flex flex-col gap-2 px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                        <div className="text-xs font-medium text-[var(--app-hint)]">Notes file</div>
                        <div className="text-xs text-[var(--app-hint)]">Workspace-relative path. Open from the terminal top bar.</div>
                    </div>
                    <button
                        type="button"
                        onClick={() => setNotesEnabled((value) => !value)}
                        disabled={isFormDisabled}
                        className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                            notesEnabled
                                ? 'bg-[var(--app-link)] text-[var(--app-bg)]'
                                : 'bg-[var(--app-subtle-bg)] text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)]'
                        } disabled:opacity-50`}
                    >
                        {notesEnabled ? 'Enabled' : 'Off'}
                    </button>
                </div>
                {notesEnabled ? (
                    <>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => setNotesMode('create')}
                                disabled={isFormDisabled}
                                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                                    notesMode === 'create'
                                        ? 'bg-[var(--app-link)] text-[var(--app-bg)]'
                                        : 'bg-[var(--app-subtle-bg)] text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)]'
                                } disabled:opacity-50`}
                            >
                                Create new
                            </button>
                            <button
                                type="button"
                                onClick={() => setNotesMode('existing')}
                                disabled={isFormDisabled}
                                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                                    notesMode === 'existing'
                                        ? 'bg-[var(--app-link)] text-[var(--app-bg)]'
                                        : 'bg-[var(--app-subtle-bg)] text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)]'
                                } disabled:opacity-50`}
                            >
                                Use existing
                            </button>
                        </div>
                        <input
                            type="text"
                            value={notesPath}
                            onChange={(event) => setNotesPath(event.target.value)}
                            placeholder={notesMode === 'create' ? 'notes.txt' : 'docs/notes.txt'}
                            disabled={isFormDisabled}
                            className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                        />
                        <div className="text-xs text-[var(--app-hint)]">
                            {notesMode === 'create'
                                ? `Creates ${trimmedDirectory || '<workspace>'}/${trimmedNotesPath || 'notes.txt'}`
                                : 'Reads and autosaves an existing workspace-relative file.'}
                        </div>
                    </>
                ) : null}
            </div>
            {launchMode === 'single' ? (
                <div className="flex flex-col gap-3 px-3 py-3">
                    <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                            <div className="text-xs font-medium text-[var(--app-hint)]">Pinned shell</div>
                            <div className="text-xs text-[var(--app-hint)]">Auto-recreate this shell if its backend terminal dies.</div>
                        </div>
                        <button
                            type="button"
                            onClick={() => setPinned((value) => !value)}
                            disabled={isFormDisabled}
                            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                                pinned
                                    ? 'bg-[var(--app-link)] text-[var(--app-bg)]'
                                    : 'bg-[var(--app-subtle-bg)] text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)]'
                            } disabled:opacity-50`}
                        >
                            {pinned ? 'Pinned' : 'Off'}
                        </button>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                            <div className="text-xs font-medium text-[var(--app-hint)]">Auto-respawn on hub restart</div>
                            <div className="text-xs text-[var(--app-hint)]">Recreate this pinned shell automatically after the hub restarts.</div>
                        </div>
                        <button
                            type="button"
                            onClick={() => setAutoRespawn((value) => !value)}
                            disabled={isFormDisabled || !pinned}
                            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                                autoRespawn && pinned
                                    ? 'bg-[var(--app-link)] text-[var(--app-bg)]'
                                    : 'bg-[var(--app-subtle-bg)] text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)]'
                            } disabled:opacity-50`}
                        >
                            {autoRespawn && pinned ? 'Enabled' : 'Off'}
                        </button>
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-medium text-[var(--app-hint)]">
                            Startup command
                        </label>
                        <textarea
                            value={startupCommand}
                            onChange={(event) => setStartupCommand(event.target.value)}
                            placeholder="Optional command to run when this shell terminal is created"
                            disabled={isFormDisabled}
                            className="min-h-24 w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                            autoCapitalize="none"
                            autoCorrect="off"
                            spellCheck={false}
                        />
                    </div>
                </div>
            ) : null}
            <div className="flex items-center justify-between gap-3 px-3 py-3">
                <div className="min-w-0">
                    <div className="text-xs uppercase tracking-wide text-[var(--app-hint)]">Hub machine</div>
                    <div className="truncate text-sm font-medium text-[var(--app-fg)]">{machineLabel}</div>
                </div>
                <div className={`rounded-full px-2 py-1 text-xs ${props.machine?.active ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
                    {props.isLoading ? 'Loading' : props.machine?.active ? 'Online' : 'Offline'}
                </div>
            </div>
            {runnerSpawnError ? (
                <div className="px-3 py-2 text-xs text-red-600">
                    Runner last spawn error: {runnerSpawnError}
                </div>
            ) : null}
            <DirectorySection
                directory={directory}
                suggestions={suggestions}
                selectedIndex={selectedIndex}
                isDisabled={isFormDisabled}
                hubFolders={hubFolders}
                recentPaths={recentPaths}
                savedPaths={savedPaths}
                canSaveCurrentPath={canSaveCurrentPath}
                isCurrentPathSaved={currentPathSaved}
                onDirectoryChange={handleDirectoryChange}
                onDirectoryFocus={handleDirectoryFocus}
                onDirectoryBlur={handleDirectoryBlur}
                onDirectoryKeyDown={handleDirectoryKeyDown}
                onSuggestionSelect={handleSuggestionSelect}
                onPathClick={handlePathClick}
                onSaveCurrentPath={handleSaveCurrentPath}
                onRemoveSavedPath={handleRemoveSavedPath}
            />
            <SessionTypeSelector
                sessionType={sessionType}
                worktreeName={worktreeName}
                worktreeInputRef={worktreeInputRef}
                isDisabled={isFormDisabled}
                onSessionTypeChange={setSessionType}
                onWorktreeNameChange={setWorktreeName}
            />
            {(error ?? spawnError) ? (
                <div className="px-3 py-2 text-sm text-red-600">
                    {error ?? spawnError}
                </div>
            ) : null}

            <ActionButtons
                isPending={isPending}
                canCreate={canCreate}
                isDisabled={isFormDisabled}
                onCancel={props.onCancel}
                onCreate={handleCreate}
            />
        </div>
    )
}
