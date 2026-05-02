import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { ApiClient } from '@/api/client'
import type { Machine } from '@/types/api'
import { usePlatform } from '@/hooks/usePlatform'
import { useSpawnSession } from '@/hooks/mutations/useSpawnSession'
import { useSessions } from '@/hooks/queries/useSessions'
import { useHubConfig } from '@/hooks/queries/useHubConfig'
import { useHubWorktrees } from '@/hooks/queries/useHubWorktrees'
import { useActiveSuggestions, type Suggestion } from '@/hooks/useActiveSuggestions'
import { useDirectorySuggestions } from '@/hooks/useDirectorySuggestions'
import { useRecentPaths } from '@/hooks/useRecentPaths'
import { ActionButtons } from './ActionButtons'
import { DirectorySection } from './DirectorySection'
import { formatRunnerSpawnError } from '../../utils/formatRunnerSpawnError'

export function NewSession(props: {
    api: ApiClient
    machine: Machine | null
    isLoading?: boolean
    onSuccess: (sessionId: string, agent: 'shell') => void
    onCancel: () => void
}) {
    const { haptic } = usePlatform()
    const { spawnSession, isPending, error: spawnError } = useSpawnSession(props.api)
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
    const [manualWorktreePaths, setManualWorktreePaths] = useState<string[]>([])
    const [error, setError] = useState<string | null>(null)
    const didPrefillDirectoryRef = useRef(false)

    const runnerSpawnError = useMemo(
        () => formatRunnerSpawnError(props.machine),
        [props.machine]
    )

    const recentPaths = useMemo(
        () => getRecentPaths(),
        [getRecentPaths]
    )
    useEffect(() => {
        if (didPrefillDirectoryRef.current || directory.trim() || recentPaths.length === 0) {
            return
        }
        didPrefillDirectoryRef.current = true
        setDirectory(recentPaths[0] ?? '')
    }, [directory, recentPaths])
    const trimmedDirectory = directory.trim()
    const trimmedNotesPath = notesPath.trim()
    const canSaveCurrentPath = trimmedDirectory.length > 0
    const currentPathSaved = isSavedPath(trimmedDirectory)

    const allPaths = useDirectorySuggestions(sessions, recentPaths)
    const worktreeLookupPaths = useMemo(
        () => Array.from(new Set([
            ...hubFolders.map((folder) => folder.path),
            ...recentPaths,
            ...savedPaths,
            ...manualWorktreePaths
        ].map((path) => path.trim()).filter(Boolean))),
        [hubFolders, recentPaths, savedPaths, manualWorktreePaths]
    )
    const {
        worktrees: detectedWorktreesRaw,
        isLoading: isLoadingWorktrees,
        refetch: refetchWorktrees
    } = useHubWorktrees(props.api, worktreeLookupPaths, Boolean(props.machine?.active))

    const pathsToCheck = useMemo(
        () => Array.from(new Set([trimmedDirectory, ...allPaths].filter(Boolean))).slice(0, 1000),
        [allPaths, trimmedDirectory]
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
    const currentDirectoryExists = trimmedDirectory.length > 0 && pathExistence[trimmedDirectory] === true
    const directoryStatus = useMemo((): 'empty' | 'checking' | 'exists' | 'missing' => {
        if (!trimmedDirectory) {
            return 'empty'
        }
        if (!props.machine?.active) {
            return 'empty'
        }
        if (pathExistence[trimmedDirectory] === true) {
            return 'exists'
        }
        if (pathExistence[trimmedDirectory] === false) {
            return 'missing'
        }
        return 'checking'
    }, [pathExistence, props.machine?.active, trimmedDirectory])
    const detectedWorktrees = useMemo(() => {
        const excludedPaths = new Set([
            ...hubFolders.map((folder) => folder.path),
            ...recentPaths,
            ...savedPaths
        ])
        return detectedWorktreesRaw.filter((worktree) => !excludedPaths.has(worktree.path))
    }, [detectedWorktreesRaw, hubFolders, recentPaths, savedPaths])

    const handleRefreshWorktrees = useCallback(() => {
        if (trimmedDirectory && !manualWorktreePaths.includes(trimmedDirectory)) {
            setManualWorktreePaths((current) => Array.from(new Set([...current, trimmedDirectory])))
            return
        }
        void refetchWorktrees()
    }, [manualWorktreePaths, refetchWorktrees, trimmedDirectory])

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
        setError(null)
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
            setError(null)
            setDirectory(suggestion.text)
            clearSuggestions()
            setSuppressSuggestions(true)
        }
    }, [suggestions, clearSuggestions])

    const handleDirectoryChange = useCallback((value: string) => {
        setError(null)
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
        if (!props.machine?.active || !trimmedDirectory) return

        if (!currentDirectoryExists) {
            haptic.notification('error')
            setError('Directory does not exist on the hub machine.')
            return
        }

        setError(null)
        try {
            const result = await spawnSession({
                directory: trimmedDirectory,
                name: name.trim() || undefined,
                notesPath: notesEnabled && trimmedNotesPath ? trimmedNotesPath : undefined,
                createNotesFile: notesEnabled && notesMode === 'create' && trimmedNotesPath.length > 0,
                pinned,
                autoRespawn: pinned ? autoRespawn : undefined,
                startupCommand: startupCommand.trim() || undefined
            })

            if (result.type === 'success') {
                haptic.notification('success')
                addRecentPath(trimmedDirectory)
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
        && currentDirectoryExists
        && !isFormDisabled
        && (!notesEnabled || trimmedNotesPath.length > 0)
    )

    return (
        <div className="flex min-h-full flex-col divide-y divide-[var(--app-divider)]">
            <div className="flex flex-col gap-1.5 px-3 py-3">
                <label className="text-xs font-medium text-[var(--app-hint)]">
                    Session name
                </label>
                <input
                    type="text"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Optional"
                    disabled={isFormDisabled}
                    className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                />
            </div>
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
                detectedWorktrees={detectedWorktrees}
                isLoadingWorktrees={isLoadingWorktrees}
                recentPaths={recentPaths}
                savedPaths={savedPaths}
                canSaveCurrentPath={canSaveCurrentPath}
                isCurrentPathSaved={currentPathSaved}
                directoryStatus={directoryStatus}
                onDirectoryChange={handleDirectoryChange}
                onDirectoryFocus={handleDirectoryFocus}
                onDirectoryBlur={handleDirectoryBlur}
                onDirectoryKeyDown={handleDirectoryKeyDown}
                onSuggestionSelect={handleSuggestionSelect}
                onPathClick={handlePathClick}
                onRefreshWorktrees={handleRefreshWorktrees}
                onSaveCurrentPath={handleSaveCurrentPath}
                onRemoveSavedPath={handleRemoveSavedPath}
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
