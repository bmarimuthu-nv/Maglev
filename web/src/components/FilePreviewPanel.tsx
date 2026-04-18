import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAppContext } from '@/lib/app-context'
import { queryKeys } from '@/lib/query-keys'
import { decodeBase64, encodeBase64 } from '@/lib/utils'
import { isBinaryContent } from '@/lib/file-utils'
import { useShikiHighlighter, resolveLanguageFromPath } from '@/lib/shiki'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'

function CloseIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
    )
}

function isMarkdownFile(filePath: string): boolean {
    return /\.(md|mdx|markdown)$/i.test(filePath)
}

export function FilePreviewPanel(props: {
    sessionId: string
    filePath: string
    api: import('@/api/client').ApiClient | null
    onClose: () => void
}) {
    const { scopeKey } = useAppContext()
    const { sessionId, filePath, api, onClose } = props

    const fileQuery = useQuery({
        queryKey: queryKeys.sessionFile(scopeKey, sessionId, filePath),
        queryFn: async () => {
            if (!api) throw new Error('API unavailable')
            return await api.readSessionFile(sessionId, filePath)
        },
        enabled: Boolean(api && filePath),
        retry: false,
    })

    const decoded = fileQuery.data?.success && fileQuery.data.content
        ? decodeBase64(fileQuery.data.content)
        : { text: '', ok: true }
    const content = decoded.text
    const fileHash = fileQuery.data?.success ? (fileQuery.data.hash ?? null) : null
    const binary = fileQuery.data?.success ? (!decoded.ok || isBinaryContent(content)) : false
    const markdown = isMarkdownFile(filePath)
    const language = useMemo(() => resolveLanguageFromPath(filePath), [filePath])
    const highlighted = useShikiHighlighter(content, markdown ? undefined : language)
    const fileName = filePath.split('/').pop() ?? filePath

    const [viewMode, setViewMode] = useState<'rendered' | 'source'>('rendered')
    const [isEditing, setIsEditing] = useState(false)
    const [draft, setDraft] = useState('')
    const [isSaving, setIsSaving] = useState(false)
    const [saveError, setSaveError] = useState<string | null>(null)

    // Reset view mode when file changes
    useEffect(() => {
        setViewMode('rendered')
        setIsEditing(false)
        setDraft('')
        setSaveError(null)
    }, [filePath])

    const startEditing = useCallback(() => {
        setDraft(content)
        setIsEditing(true)
        setViewMode('source')
    }, [content])

    const cancelEditing = useCallback(() => {
        setIsEditing(false)
        setDraft('')
        setSaveError(null)
    }, [])

    const saveFile = useCallback(async () => {
        if (!api || isSaving) return
        setIsSaving(true)
        setSaveError(null)
        try {
            const result = await api.writeSessionFile(sessionId, filePath, encodeBase64(draft), fileHash)
            if (!result.success) {
                throw new Error(result.error ?? 'Failed to save file')
            }
            setIsEditing(false)
            void fileQuery.refetch()
        } catch (error) {
            setSaveError(error instanceof Error ? error.message : 'Failed to save')
        } finally {
            setIsSaving(false)
        }
    }, [api, draft, fileHash, filePath, fileQuery, isSaving, sessionId])

    const isDirty = isEditing && draft !== content

    return (
        <div className="flex h-full w-full flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-2 border-b border-[var(--app-border)] px-3 py-2">
                <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium" title={filePath}>{fileName}</div>
                    <div className="truncate text-[11px] text-[var(--app-hint)]">{filePath}</div>
                </div>
                {markdown && !isEditing ? (
                    <div className="flex shrink-0 items-center rounded-md border border-[var(--app-border)] text-[11px]">
                        <button
                            type="button"
                            onClick={() => setViewMode('rendered')}
                            className={`px-2 py-1 rounded-l-md transition-colors ${viewMode === 'rendered' ? 'bg-[var(--app-link)] text-white' : 'text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]'}`}
                        >
                            Preview
                        </button>
                        <button
                            type="button"
                            onClick={() => setViewMode('source')}
                            className={`px-2 py-1 rounded-r-md transition-colors ${viewMode === 'source' ? 'bg-[var(--app-link)] text-white' : 'text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]'}`}
                        >
                            Source
                        </button>
                    </div>
                ) : null}
                {!isEditing && !binary ? (
                    <button
                        type="button"
                        onClick={startEditing}
                        className="shrink-0 rounded-md border border-[var(--app-border)] px-2 py-1 text-[11px] text-[var(--app-fg)] transition-colors hover:bg-[var(--app-subtle-bg)]"
                    >
                        Edit
                    </button>
                ) : null}
                <button
                    type="button"
                    onClick={onClose}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                    title="Close preview"
                >
                    <CloseIcon />
                </button>
            </div>

            {/* Edit toolbar */}
            {isEditing ? (
                <div className="flex items-center gap-2 border-b border-[var(--app-border)] px-3 py-1.5">
                    <button
                        type="button"
                        onClick={() => void saveFile()}
                        disabled={isSaving || !isDirty}
                        className="rounded-md bg-[var(--app-link)] px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-50"
                    >
                        {isSaving ? 'Saving…' : 'Save'}
                    </button>
                    <button
                        type="button"
                        onClick={cancelEditing}
                        disabled={isSaving}
                        className="rounded-md border border-[var(--app-border)] px-2.5 py-1 text-[11px] text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    {saveError ? (
                        <span className="text-[11px] text-red-500">{saveError}</span>
                    ) : null}
                    {isDirty ? (
                        <span className="text-[11px] text-[var(--app-hint)]">Unsaved changes</span>
                    ) : null}
                </div>
            ) : null}

            {/* Content */}
            <div className="flex-1 overflow-auto">
                {fileQuery.isLoading ? (
                    <div className="p-4 text-sm text-[var(--app-hint)]">Loading…</div>
                ) : fileQuery.error ? (
                    <div className="p-4 text-sm text-red-500">
                        {fileQuery.error instanceof Error ? fileQuery.error.message : 'Failed to load file'}
                    </div>
                ) : binary ? (
                    <div className="p-4 text-sm text-[var(--app-hint)]">Binary file cannot be displayed.</div>
                ) : isEditing ? (
                    <textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        className="h-full w-full resize-none bg-[var(--app-code-bg)] p-4 font-mono text-xs text-[var(--app-fg)] focus:outline-none"
                        spellCheck={false}
                    />
                ) : markdown && viewMode === 'rendered' ? (
                    <div className="p-4">
                        <MarkdownRenderer content={content} />
                    </div>
                ) : (
                    <pre className="shiki overflow-auto p-4 text-xs font-mono bg-[var(--app-code-bg)]">
                        <code>{highlighted ?? content}</code>
                    </pre>
                )}
            </div>
        </div>
    )
}
