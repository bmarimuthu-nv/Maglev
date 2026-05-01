import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { Suggestion } from '@/hooks/useActiveSuggestions'
import { Autocomplete } from '@/components/ChatInput/Autocomplete'
import { FloatingOverlay } from '@/components/ChatInput/FloatingOverlay'
import { useTranslation } from '@/lib/use-translation'

function ShortcutRow(props: {
    label: string
    description?: string
    onClick: () => void
    onRemove?: () => void
    disabled: boolean
}) {
    return (
        <div className="flex items-center gap-2 rounded-md border border-[var(--app-border)] bg-[var(--app-secondary-bg)] px-2 py-2">
            <button
                type="button"
                onClick={props.onClick}
                disabled={props.disabled}
                className="min-w-0 flex-1 text-left disabled:opacity-50"
                title={props.description ?? props.label}
            >
                <div className="truncate text-sm text-[var(--app-fg)]">{props.label}</div>
                {props.description ? (
                    <div className="truncate text-xs text-[var(--app-hint)]">{props.description}</div>
                ) : null}
            </button>
            {props.onRemove ? (
                <button
                    type="button"
                    onClick={props.onRemove}
                    disabled={props.disabled}
                    className="shrink-0 rounded border border-[var(--app-divider)] px-2 py-1 text-xs text-[var(--app-hint)] transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)] disabled:opacity-50"
                >
                    ×
                </button>
            ) : null}
        </div>
    )
}

export function DirectorySection(props: {
    directory: string
    suggestions: readonly Suggestion[]
    selectedIndex: number
    isDisabled: boolean
    hubFolders: Array<{ label: string; path: string; branch?: string }>
    detectedWorktrees: Array<{ path: string; branch?: string; repoRoot: string }>
    isLoadingWorktrees: boolean
    recentPaths: string[]
    savedPaths: string[]
    canSaveCurrentPath: boolean
    isCurrentPathSaved: boolean
    onDirectoryChange: (value: string) => void
    onDirectoryFocus: () => void
    onDirectoryBlur: () => void
    onDirectoryKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void
    onSuggestionSelect: (index: number) => void
    onPathClick: (path: string) => void
    onRefreshWorktrees: () => void
    onSaveCurrentPath: () => void
    onRemoveSavedPath: (path: string) => void
}) {
    const { t } = useTranslation()

    return (
        <div className="flex flex-col gap-1.5 px-3 py-3">
            <label className="text-xs font-medium text-[var(--app-hint)]">
                {t('newSession.directory')}
            </label>
            <div className="relative">
                <input
                    type="text"
                    placeholder={t('newSession.placeholder')}
                    value={props.directory}
                    onChange={(event) => props.onDirectoryChange(event.target.value)}
                    onKeyDown={props.onDirectoryKeyDown}
                    onFocus={props.onDirectoryFocus}
                    onBlur={props.onDirectoryBlur}
                    disabled={props.isDisabled}
                    className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                />
                {props.suggestions.length > 0 && (
                    <div className="absolute top-full left-0 right-0 z-10 mt-1">
                        <FloatingOverlay maxHeight={200}>
                            <Autocomplete
                                suggestions={props.suggestions}
                                selectedIndex={props.selectedIndex}
                                onSelect={props.onSuggestionSelect}
                            />
                        </FloatingOverlay>
                    </div>
                )}
            </div>

            <div className="flex items-center justify-end">
                <button
                    type="button"
                    onClick={props.onSaveCurrentPath}
                    disabled={props.isDisabled || !props.canSaveCurrentPath}
                    className="rounded bg-[var(--app-subtle-bg)] px-2 py-1 text-xs text-[var(--app-fg)] transition-colors hover:bg-[var(--app-secondary-bg)] disabled:opacity-50"
                >
                    {props.isCurrentPathSaved ? t('newSession.savedCurrent') : t('newSession.saveCurrent')}
                </button>
            </div>

            <div className="mt-1 flex flex-col gap-2">
                <span className="text-xs text-[var(--app-hint)]">Folders</span>
                <div className="max-h-64 space-y-3 overflow-y-auto rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2">
                    {props.hubFolders.length > 0 ? (
                        <div className="flex flex-col gap-2">
                            <div className="text-xs font-medium text-[var(--app-hint)]">Hub folders</div>
                            {props.hubFolders.map((folder) => (
                                <ShortcutRow
                                    key={`${folder.label}:${folder.path}`}
                                    label={folder.branch ? `${folder.label} (${folder.branch})` : folder.label}
                                    description={folder.path}
                                    onClick={() => props.onPathClick(folder.path)}
                                    disabled={props.isDisabled}
                                />
                            ))}
                        </div>
                    ) : null}

                    <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between gap-2">
                            <div className="text-xs font-medium text-[var(--app-hint)]">{t('newSession.worktrees')}</div>
                            <button
                                type="button"
                                onClick={props.onRefreshWorktrees}
                                disabled={props.isDisabled || props.isLoadingWorktrees}
                                className="shrink-0 rounded border border-[var(--app-divider)] px-2 py-1 text-xs text-[var(--app-hint)] transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)] disabled:opacity-50"
                            >
                                {props.isLoadingWorktrees ? t('newSession.worktrees.loading') : t('newSession.worktrees.refresh')}
                            </button>
                        </div>
                        {props.detectedWorktrees.length > 0 ? (
                            props.detectedWorktrees.map((worktree) => (
                                <ShortcutRow
                                    key={worktree.path}
                                    label={worktree.branch ? worktree.branch : worktree.path}
                                    description={worktree.path === worktree.repoRoot ? worktree.path : `${worktree.path} · ${worktree.repoRoot}`}
                                    onClick={() => props.onPathClick(worktree.path)}
                                    disabled={props.isDisabled}
                                />
                            ))
                        ) : (
                            <div className="rounded-md border border-dashed border-[var(--app-border)] px-2 py-2 text-xs text-[var(--app-hint)]">
                                {t('newSession.worktrees.empty')}
                            </div>
                        )}
                    </div>

                    {props.recentPaths.length > 0 ? (
                        <div className="flex flex-col gap-2">
                            <div className="text-xs font-medium text-[var(--app-hint)]">{t('newSession.recent')}</div>
                            {props.recentPaths.map((path) => (
                                <ShortcutRow
                                    key={path}
                                    label={path}
                                    onClick={() => props.onPathClick(path)}
                                    disabled={props.isDisabled}
                                />
                            ))}
                        </div>
                    ) : null}

                    {props.savedPaths.length > 0 ? (
                        <div className="flex flex-col gap-2">
                            <div className="text-xs font-medium text-[var(--app-hint)]">{t('newSession.saved')}</div>
                            {props.savedPaths.map((path) => (
                                <ShortcutRow
                                    key={path}
                                    label={path}
                                    onClick={() => props.onPathClick(path)}
                                    onRemove={() => props.onRemoveSavedPath(path)}
                                    disabled={props.isDisabled}
                                />
                            ))}
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    )
}
