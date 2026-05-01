import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import { CodeLinesView, type CodeLinesViewHandle } from '@/components/SessionFiles/CodeLinesView'
import { CodeEditSurface, type CodeEditSurfaceHandle } from '@/components/SessionFiles/CodeEditSurface'
import { useAppContext } from '@/lib/app-context'
import { queryKeys } from '@/lib/query-keys'
import { decodeBase64, encodeBase64 } from '@/lib/utils'
import { isBinaryContent } from '@/lib/file-utils'
import type { FileReviewThread, WriteFileConflict } from '@/types/api'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'
import { SourceReviewFileCard } from '@/components/review/SourceReviewFileCard'

function CloseIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
    )
}

function ReloadIcon(props: { spinning?: boolean }) {
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
            className={props.spinning ? 'animate-spin' : undefined}
        >
            <path d="M21 2v6h-6" />
            <path d="M3 12a9 9 0 0 1 15.5-6.36L21 8" />
            <path d="M3 22v-6h6" />
            <path d="M21 12a9 9 0 0 1-15.5 6.36L3 16" />
        </svg>
    )
}

function ArrowDownIcon() {
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
        >
            <path d="M12 5v14" />
            <path d="m19 12-7 7-7-7" />
        </svg>
    )
}

function isMarkdownFile(filePath: string): boolean {
    return /\.(md|mdx|markdown)$/i.test(filePath)
}

function getImageMimeTypeFromPath(filePath: string): string | null {
    const normalized = filePath.toLowerCase()
    if (normalized.endsWith('.png')) return 'image/png'
    if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) return 'image/jpeg'
    if (normalized.endsWith('.gif')) return 'image/gif'
    if (normalized.endsWith('.webp')) return 'image/webp'
    if (normalized.endsWith('.svg')) return 'image/svg+xml'
    if (normalized.endsWith('.bmp')) return 'image/bmp'
    if (normalized.endsWith('.ico')) return 'image/x-icon'
    if (normalized.endsWith('.avif')) return 'image/avif'
    return null
}

function normalizeSourceLines(content: string): string[] {
    const normalized = content.replace(/\r\n/g, '\n')
    const lines = normalized.split('\n')
    return lines.length > 0 ? lines : ['']
}

type DraftSnapshot = {
    draft: string
    updatedAt: number
}

function buildDraftStorageKey(scopeKey: string, sessionId: string, filePath: string): string {
    return `maglev:file-preview-draft:${scopeKey}:${sessionId}:${filePath}`
}

function loadDraftSnapshot(key: string): DraftSnapshot | null {
    try {
        const raw = window.sessionStorage.getItem(key)
        if (!raw) {
            return null
        }
        const parsed = JSON.parse(raw) as Partial<DraftSnapshot>
        if (typeof parsed.draft !== 'string') {
            return null
        }
        return {
            draft: parsed.draft,
            updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now()
        }
    } catch {
        return null
    }
}

function saveDraftSnapshot(key: string, snapshot: DraftSnapshot): void {
    try {
        window.sessionStorage.setItem(key, JSON.stringify(snapshot))
    } catch {
        // Ignore browser storage failures and keep editing locally.
    }
}

function clearDraftSnapshot(key: string): void {
    try {
        window.sessionStorage.removeItem(key)
    } catch {
        // Ignore browser storage failures and keep the UI responsive.
    }
}

function getConflictMessage(conflict: WriteFileConflict): string {
    switch (conflict.type) {
        case 'hash_mismatch':
            return 'This file changed on disk after you opened it.'
        case 'missing_file':
            return 'This file was deleted after you opened it.'
        case 'already_exists':
            return 'This file now exists, so it cannot be created as new without overwriting it.'
    }
}

export function FilePreviewPanel(props: {
    sessionId: string
    filePath: string
    api: ApiClient | null
    onClose: () => void
    presentation?: 'sidebar' | 'overlay'
}) {
    const { scopeKey } = useAppContext()
    const { sessionId, filePath, api, onClose, presentation = 'sidebar' } = props
    const queryClient = useQueryClient()
    const isOverlay = presentation === 'overlay'

    const fileQuery = useQuery({
        queryKey: queryKeys.sessionFile(scopeKey, sessionId, filePath),
        queryFn: async () => {
            if (!api) throw new Error('API unavailable')
            return await api.readSessionFile(sessionId, filePath)
        },
        enabled: Boolean(api && filePath),
        retry: false,
    })

    const reviewThreadsQuery = useQuery({
        queryKey: queryKeys.sessionFileReviewThreads(scopeKey, sessionId, filePath),
        queryFn: async () => {
            if (!api) throw new Error('API unavailable')
            return await api.getSessionFileReviewThreads(sessionId, filePath)
        },
        enabled: Boolean(api && filePath),
        retry: false
    })

    const decoded = fileQuery.data?.success && fileQuery.data.content
        ? decodeBase64(fileQuery.data.content)
        : { text: '', ok: true }
    const content = decoded.text
    const encodedContent = fileQuery.data?.success ? (fileQuery.data.content ?? '') : ''
    const fileHash = fileQuery.data?.success ? (fileQuery.data.hash ?? null) : null
    const binary = fileQuery.data?.success ? (!decoded.ok || isBinaryContent(content)) : false
    const imageMimeType = getImageMimeTypeFromPath(filePath)
    const imagePreviewUrl = binary && imageMimeType && encodedContent
        ? `data:${imageMimeType};base64,${encodedContent}`
        : null
    const markdown = isMarkdownFile(filePath)
    const sourceLines = useMemo(() => normalizeSourceLines(content), [content])
    const fileName = filePath.split('/').pop() ?? filePath
    const buildPreviewLink = useCallback((line: number) => `${window.location.href.split('#')[0]}#L${line}`, [])
    const draftStorageKey = useMemo(() => buildDraftStorageKey(scopeKey, sessionId, filePath), [filePath, scopeKey, sessionId])

    const [viewMode, setViewMode] = useState<'rendered' | 'source'>('rendered')
    const [panelMode, setPanelMode] = useState<'read' | 'review' | 'edit'>('read')
    const [draft, setDraft] = useState('')
    const [isSaving, setIsSaving] = useState(false)
    const [saveError, setSaveError] = useState<string | null>(null)
    const [saveConflict, setSaveConflict] = useState<WriteFileConflict | null>(null)
    const [draftRecovered, setDraftRecovered] = useState(false)
    const [reviewError, setReviewError] = useState<string | null>(null)
    const [reviewSaving, setReviewSaving] = useState(false)
    const [composerLine, setComposerLine] = useState<number | null>(null)
    const [composerText, setComposerText] = useState('')
    const [collapsedResolvedThreadIds, setCollapsedResolvedThreadIds] = useState<Record<string, boolean>>({})
    const codeViewRef = useRef<CodeLinesViewHandle | null>(null)
    const reviewViewRef = useRef<CodeLinesViewHandle | null>(null)
    const editViewRef = useRef<CodeEditSurfaceHandle | null>(null)
    const restoredDraftKeyRef = useRef<string | null>(null)
    const isEditing = panelMode === 'edit'

    useEffect(() => {
        setViewMode('rendered')
        setPanelMode('read')
        setDraft('')
        setSaveError(null)
        setSaveConflict(null)
        setDraftRecovered(false)
        setReviewError(null)
        setComposerLine(null)
        setComposerText('')
        setCollapsedResolvedThreadIds({})
        restoredDraftKeyRef.current = null
    }, [filePath])

    useEffect(() => {
        if (panelMode !== 'review') {
            return
        }
        setViewMode('source')
        setDraft('')
        setSaveError(null)
        setSaveConflict(null)
    }, [panelMode])

    const startEditing = useCallback(() => {
        setDraft(content)
        setPanelMode('edit')
        setViewMode('source')
        setSaveError(null)
        setSaveConflict(null)
        setDraftRecovered(false)
        setReviewError(null)
    }, [content])

    const cancelEditing = useCallback(() => {
        setPanelMode('read')
        setDraft('')
        setSaveError(null)
        setSaveConflict(null)
        setDraftRecovered(false)
        clearDraftSnapshot(draftStorageKey)
    }, [draftStorageKey])

    useEffect(() => {
        if (!fileQuery.data?.success || binary || isEditing || restoredDraftKeyRef.current === draftStorageKey) {
            return
        }
        restoredDraftKeyRef.current = draftStorageKey

        const snapshot = loadDraftSnapshot(draftStorageKey)
        if (!snapshot) {
            return
        }
        if (snapshot.draft === content) {
            clearDraftSnapshot(draftStorageKey)
            return
        }

        setDraft(snapshot.draft)
        setPanelMode('edit')
        setViewMode('source')
        setSaveError(null)
        setSaveConflict(null)
        setReviewError(null)
        setDraftRecovered(true)
    }, [binary, content, draftStorageKey, fileQuery.data, isEditing])

    useEffect(() => {
        if (!isEditing) {
            return
        }
        if (draft === content) {
            clearDraftSnapshot(draftStorageKey)
            return
        }
        saveDraftSnapshot(draftStorageKey, {
            draft,
            updatedAt: Date.now()
        })
    }, [content, draft, draftStorageKey, isEditing])

    const saveFile = useCallback(async (overrideExpectedHash?: string | null) => {
        if (!api || isSaving) return
        setIsSaving(true)
        setSaveError(null)
        setSaveConflict(null)
        try {
            const expectedHash = overrideExpectedHash === undefined ? fileHash : overrideExpectedHash
            const result = await api.writeSessionFile(sessionId, filePath, encodeBase64(draft), expectedHash)
            if (!result.success) {
                if (result.conflict) {
                    setSaveConflict(result.conflict)
                    return
                }
                throw new Error(result.error ?? 'Failed to save file')
            }
            clearDraftSnapshot(draftStorageKey)
            setDraftRecovered(false)
            setPanelMode('read')
            setDraft('')
            await fileQuery.refetch()
            await reviewThreadsQuery.refetch()
        } catch (error) {
            setSaveError(error instanceof Error ? error.message : 'Failed to save')
        } finally {
            setIsSaving(false)
        }
    }, [api, draft, draftStorageKey, fileHash, filePath, fileQuery, isSaving, reviewThreadsQuery, sessionId])

    const discardDraft = useCallback(async () => {
        clearDraftSnapshot(draftStorageKey)
        setDraft('')
        setSaveError(null)
        setSaveConflict(null)
        setDraftRecovered(false)
        setPanelMode('read')
        await fileQuery.refetch()
        await reviewThreadsQuery.refetch()
    }, [draftStorageKey, fileQuery, reviewThreadsQuery])

    const invalidateReviewThreads = useCallback(async () => {
        await queryClient.invalidateQueries({ queryKey: queryKeys.sessionFileReviewThreads(scopeKey, sessionId, filePath) })
        await reviewThreadsQuery.refetch()
    }, [filePath, queryClient, reviewThreadsQuery, scopeKey, sessionId])

    const runReviewMutation = useCallback(async (mutate: () => Promise<{ success: boolean; error?: string }>) => {
        setReviewSaving(true)
        setReviewError(null)
        try {
            const result = await mutate()
            if (!result.success) {
                throw new Error(result.error ?? 'Failed to update review threads')
            }
            await invalidateReviewThreads()
        } catch (error) {
            setReviewError(error instanceof Error ? error.message : 'Failed to update review threads')
        } finally {
            setReviewSaving(false)
        }
    }, [invalidateReviewThreads])

    const handleRefresh = useCallback(async () => {
        if (!api || isEditing || isSaving || reviewSaving) {
            return
        }
        setSaveError(null)
        setSaveConflict(null)
        setDraftRecovered(false)
        setReviewError(null)
        await Promise.all([
            fileQuery.refetch(),
            reviewThreadsQuery.refetch(),
        ])
    }, [api, fileQuery, isEditing, isSaving, reviewSaving, reviewThreadsQuery])

    const isDirty = isEditing && draft !== content
    const isRefreshing = (fileQuery.isFetching && !fileQuery.isLoading) || (reviewThreadsQuery.isFetching && !reviewThreadsQuery.isLoading)
    const reviewThreads = reviewThreadsQuery.data?.success ? (reviewThreadsQuery.data.threads ?? []) : []
    const lineThreads = useMemo(() => {
        const map = new Map<number, FileReviewThread[]>()
        for (const thread of reviewThreads) {
            if (thread.orphaned || thread.resolvedLine == null) {
                continue
            }
            const existing = map.get(thread.resolvedLine) ?? []
            existing.push(thread)
            map.set(thread.resolvedLine, existing)
        }
        return map
    }, [reviewThreads])
    const orphanedThreads = useMemo(
        () => reviewThreads.filter((thread) => thread.orphaned || thread.resolvedLine == null),
        [reviewThreads]
    )
    const unresolvedCount = useMemo(
        () => reviewThreads.filter((thread) => thread.status !== 'resolved').length,
        [reviewThreads]
    )

    const handleScrollToBottom = useCallback(() => {
        if (isEditing) {
            editViewRef.current?.scrollToBottom()
            return
        }
        if (panelMode === 'review') {
            reviewViewRef.current?.scrollToBottom()
            return
        }
        codeViewRef.current?.scrollToBottom()
    }, [isEditing, panelMode])

    const handleCreateThread = useCallback(async (line: number) => {
        const body = composerText.trim()
        if (!api || !body) {
            return
        }
        await runReviewMutation(() => api.createSessionFileReviewThread(sessionId, {
            path: filePath,
            line,
            body,
            author: 'user'
        }))
        setComposerLine(null)
        setComposerText('')
    }, [api, composerText, filePath, runReviewMutation, sessionId])

    const toggleCollapsedThread = useCallback((threadId: string) => {
        setCollapsedResolvedThreadIds((current) => ({
            ...current,
            [threadId]: current[threadId] === false ? true : false
        }))
    }, [])

    const handleResolveThread = useCallback((thread: FileReviewThread) => {
        void runReviewMutation(() => api?.setSessionFileReviewThreadStatus(
            sessionId,
            thread.id,
            thread.status === 'resolved' ? 'open' : 'resolved'
        ) ?? Promise.resolve({ success: false, error: 'API unavailable' }))
    }, [api, runReviewMutation, sessionId])

    const handleDeleteThread = useCallback((thread: FileReviewThread) => {
        if (!window.confirm('Delete this review thread permanently?')) {
            return
        }
        void runReviewMutation(() => api?.deleteSessionFileReviewThread(sessionId, thread.id)
            ?? Promise.resolve({ success: false, error: 'API unavailable' }))
    }, [api, runReviewMutation, sessionId])

    const handleReplyToThread = useCallback((thread: FileReviewThread, body: string) => {
        void runReviewMutation(() => api?.replyToSessionFileReviewThread(sessionId, thread.id, {
            body,
            author: 'user'
        }) ?? Promise.resolve({ success: false, error: 'API unavailable' }))
    }, [api, runReviewMutation, sessionId])

    return (
        <div className={`flex h-full w-full flex-col overflow-hidden ${isOverlay ? 'bg-[var(--app-surface-raised)]' : ''}`}>
            <div className={`border-b border-[var(--app-border)] ${isOverlay ? 'px-4 pb-3 pt-[max(12px,env(safe-area-inset-top))]' : 'px-3 py-2.5'}`}>
                <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-semibold text-[var(--app-fg)]" title={filePath}>
                            {filePath}
                        </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                        <button
                            type="button"
                            onClick={() => void handleRefresh()}
                            disabled={!api || isEditing || isSaving || reviewSaving || fileQuery.isLoading}
                            className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--app-border)] bg-[var(--app-surface-raised)] text-[var(--app-hint)] transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)] disabled:cursor-not-allowed disabled:opacity-50"
                            title={isRefreshing ? 'Reloading file and review threads' : 'Reload file and review threads'}
                        >
                            <ReloadIcon spinning={isRefreshing} />
                        </button>
                        <button
                            type="button"
                            onClick={handleScrollToBottom}
                            disabled={fileQuery.isLoading || binary}
                            className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--app-border)] bg-[var(--app-surface-raised)] text-[var(--app-hint)] transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)] disabled:cursor-not-allowed disabled:opacity-50"
                            title="Scroll to bottom"
                        >
                            <ArrowDownIcon />
                        </button>
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--app-border)] bg-[var(--app-surface-raised)] text-[var(--app-hint)] transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]"
                            title="Close preview"
                        >
                            <CloseIcon />
                        </button>
                    </div>
                </div>

                {!binary ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                        <div className="flex shrink-0 items-center rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface-raised)] p-0.5 text-[10px]">
                            {([
                                ['read', 'Code'],
                                ['review', 'Review'],
                                ['edit', 'Edit']
                            ] as const).map(([value, label]) => (
                                <button
                                    key={value}
                                    type="button"
                                    onClick={() => {
                                        if (value === 'edit') {
                                            if (isEditing) {
                                                return
                                            }
                                            startEditing()
                                            return
                                        }
                                        if (isEditing) {
                                            cancelEditing()
                                        }
                                        setPanelMode(value)
                                    }}
                                    className={`rounded-xl px-2.5 py-1 font-semibold transition-colors ${
                                        panelMode === value
                                            ? 'bg-[var(--app-button)] text-[var(--app-button-text)] shadow-[0_12px_24px_-18px_var(--app-button-shadow)]'
                                            : 'text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]'
                                    }`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                        {markdown && panelMode === 'read' ? (
                            <div className="flex shrink-0 items-center rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface-raised)] p-0.5 text-[10px]">
                                <button
                                    type="button"
                                    onClick={() => setViewMode('rendered')}
                                    className={`rounded-xl px-2.5 py-1 font-semibold transition-colors ${
                                        viewMode === 'rendered'
                                            ? 'bg-[var(--app-button)] text-[var(--app-button-text)] shadow-[0_12px_24px_-18px_var(--app-button-shadow)]'
                                            : 'text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]'
                                    }`}
                                >
                                    Rendered
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setViewMode('source')}
                                    className={`rounded-xl px-2.5 py-1 font-semibold transition-colors ${
                                        viewMode === 'source'
                                            ? 'bg-[var(--app-button)] text-[var(--app-button-text)] shadow-[0_12px_24px_-18px_var(--app-button-shadow)]'
                                            : 'text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]'
                                    }`}
                                >
                                    Source
                                </button>
                            </div>
                        ) : null}
                        {panelMode === 'review' ? (
                            <>
                                <span className="rounded-full border border-[var(--app-border)] bg-[var(--app-surface-raised)] px-2.5 py-1 text-[11px] font-semibold text-[var(--app-fg)]">
                                    {reviewThreads.length} thread{reviewThreads.length === 1 ? '' : 's'}
                                </span>
                                <span className="rounded-full border border-[var(--app-border)] bg-[var(--app-surface-raised)] px-2.5 py-1 text-[11px] font-semibold text-[var(--app-hint)]">
                                    {unresolvedCount} unresolved
                                </span>
                            </>
                        ) : null}
                    </div>
                ) : null}
            </div>

            {isEditing ? (
                <div className="flex flex-wrap items-center gap-2 border-b border-[var(--app-border)] bg-[var(--app-surface-raised)] px-4 py-2">
                    <button
                        type="button"
                        onClick={() => void saveFile()}
                        disabled={isSaving || !isDirty}
                        className="rounded-full bg-[var(--app-button)] px-3 py-1.5 text-[11px] font-semibold text-[var(--app-button-text)] disabled:opacity-50"
                    >
                        {isSaving ? 'Saving…' : 'Save'}
                    </button>
                    <button
                        type="button"
                        onClick={cancelEditing}
                        disabled={isSaving}
                        className="rounded-full border border-[var(--app-border)] px-3 py-1.5 text-[11px] font-semibold text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    {saveError ? <span className="text-[11px] text-[var(--app-badge-error-text)]">{saveError}</span> : null}
                    {draftRecovered ? <span className="text-[11px] text-[var(--app-hint)]">Recovered unsaved draft from this browser session</span> : null}
                    {isDirty ? <span className="text-[11px] text-[var(--app-hint)]">Unsaved changes</span> : null}
                </div>
            ) : panelMode === 'review' && !binary ? (
                <div className="flex flex-wrap items-center gap-2 border-b border-[var(--app-border)] bg-[var(--app-surface-raised)] px-4 py-2 text-[11px]">
                    <span className="rounded-full bg-[var(--review-accent-bg)] px-2.5 py-1 font-semibold text-[var(--review-accent)]">
                        Review annotations
                    </span>
                    <span className="text-[var(--app-hint)]">{reviewThreads.length} total threads</span>
                    <span className="text-[var(--app-hint)]">{unresolvedCount} unresolved</span>
                    {reviewSaving ? <span className="text-[var(--app-hint)]">Saving…</span> : null}
                    {reviewThreadsQuery.isLoading ? <span className="text-[var(--app-hint)]">Loading threads…</span> : null}
                    {reviewError ? <span className="text-[var(--app-badge-error-text)]">{reviewError}</span> : null}
                    {reviewThreadsQuery.data && !reviewThreadsQuery.data.success ? (
                        <span className="text-[var(--app-badge-error-text)]">{reviewThreadsQuery.data.error ?? 'Failed to load review threads'}</span>
                    ) : null}
                </div>
            ) : null}

            {isEditing && saveConflict ? (
                <div className="flex flex-wrap items-center gap-2 border-b border-[var(--app-badge-error-border)] bg-[var(--app-badge-error-bg)] px-4 py-3 text-[11px] text-[var(--app-badge-error-text)]">
                    <span className="font-semibold">{getConflictMessage(saveConflict)}</span>
                    <span className="text-[var(--app-badge-error-text)]/85">Your draft is still intact.</span>
                    <button
                        type="button"
                        onClick={() => void saveFile(saveConflict.currentHash)}
                        disabled={isSaving}
                        className="rounded-full bg-[var(--app-button)] px-3 py-1.5 font-semibold text-[var(--app-button-text)] disabled:opacity-50"
                    >
                        Overwrite with my draft
                    </button>
                    <button
                        type="button"
                        onClick={() => void discardDraft()}
                        disabled={isSaving}
                        className="rounded-full border border-[var(--app-badge-error-border)] px-3 py-1.5 font-semibold text-[var(--app-badge-error-text)] hover:bg-white/40 disabled:opacity-50"
                    >
                        Discard draft
                    </button>
                </div>
            ) : null}

            <div className={`flex-1 overflow-auto ${isOverlay ? 'pb-[env(safe-area-inset-bottom)]' : ''}`}>
                {fileQuery.isLoading ? (
                    <div className="p-4">
                        <div className="rounded-[24px] border border-[var(--app-border)] bg-[var(--app-surface-raised)] px-4 py-6 text-sm text-[var(--app-hint)]">
                            Loading preview…
                        </div>
                    </div>
                ) : fileQuery.error ? (
                    <div className="p-4">
                        <div className="rounded-[24px] border border-[var(--app-badge-error-border)] bg-[var(--app-badge-error-bg)] px-4 py-4 text-sm text-[var(--app-badge-error-text)]">
                            {fileQuery.error instanceof Error ? fileQuery.error.message : 'Failed to load file'}
                        </div>
                    </div>
                ) : binary && imagePreviewUrl ? (
                    <div className="flex h-full min-h-0 items-center justify-center p-4">
                        <div className="flex h-full w-full min-h-0 items-center justify-center overflow-auto rounded-[24px] border border-[var(--app-border)] bg-[var(--app-surface-raised)] p-4">
                            <img
                                src={imagePreviewUrl}
                                alt={fileName}
                                className="block max-h-full max-w-full rounded-xl object-contain shadow-[0_20px_60px_-32px_rgba(0,0,0,0.45)]"
                            />
                        </div>
                    </div>
                ) : binary ? (
                    <div className="p-4">
                        <div className="rounded-[24px] border border-[var(--app-border)] bg-[var(--app-surface-raised)] px-4 py-6 text-sm text-[var(--app-hint)]">
                            Binary file cannot be displayed in the inline preview.
                        </div>
                    </div>
                ) : isEditing ? (
                    <CodeEditSurface
                        ref={editViewRef}
                        draft={draft}
                        filePath={filePath}
                        onChange={setDraft}
                    />
                ) : panelMode === 'review' ? (
                    <div className="p-4">
                        <SourceReviewFileCard
                            codeViewRef={reviewViewRef}
                            filePath={filePath}
                            sourceLines={sourceLines}
                            reviewSaving={reviewSaving}
                            reviewThreads={reviewThreads}
                            lineThreads={lineThreads}
                            orphanedThreads={orphanedThreads}
                            composerLine={composerLine}
                            composerText={composerText}
                            collapsedResolvedThreadIds={collapsedResolvedThreadIds}
                            onComposerLineChange={setComposerLine}
                            onComposerTextChange={setComposerText}
                            onCreateThread={(lineNumber) => {
                                void handleCreateThread(lineNumber)
                            }}
                            onToggleResolvedCollapse={toggleCollapsedThread}
                            onResolveThread={handleResolveThread}
                            onDeleteThread={handleDeleteThread}
                            onReplyToThread={handleReplyToThread}
                        />
                    </div>
                ) : markdown && viewMode === 'rendered' ? (
                    <div className="p-4">
                        <MarkdownRenderer content={content} />
                    </div>
                ) : (
                    <div className="p-4">
                        <CodeLinesView
                            ref={codeViewRef}
                            content={content}
                            filePath={filePath}
                            buildLink={buildPreviewLink}
                        />
                    </div>
                )}
            </div>
        </div>
    )
}
