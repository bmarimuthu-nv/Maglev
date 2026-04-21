import { useEffect, useRef, useState } from 'react'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/lib/use-translation'

type SessionEditDialogProps = {
    isOpen: boolean
    onClose: () => void
    currentName: string
    currentDirectory: string
    onSave: (changes: { name?: string; directory?: string }) => Promise<void>
    isPending: boolean
}

export function SessionEditDialog(props: SessionEditDialogProps) {
    const { t } = useTranslation()
    const { isOpen, onClose, currentName, currentDirectory, onSave, isPending } = props
    const [name, setName] = useState(currentName)
    const [directory, setDirectory] = useState(currentDirectory)
    const [error, setError] = useState<string | null>(null)
    const nameInputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        if (!isOpen) {
            return
        }

        setName(currentName)
        setDirectory(currentDirectory)
        setError(null)

        const timer = window.setTimeout(() => {
            nameInputRef.current?.focus()
            nameInputRef.current?.select()
        }, 100)

        return () => window.clearTimeout(timer)
    }, [currentDirectory, currentName, isOpen])

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault()

        const trimmedName = name.trim()
        const trimmedDirectory = directory.trim()

        if (!trimmedDirectory) {
            setError(t('dialog.edit.directoryRequired'))
            return
        }

        const changes: { name?: string; directory?: string } = {}
        if (trimmedName !== currentName) {
            changes.name = trimmedName
        }
        if (trimmedDirectory !== currentDirectory) {
            changes.directory = trimmedDirectory
        }

        if (!changes.name && !changes.directory) {
            onClose()
            return
        }

        setError(null)
        try {
            await onSave(changes)
            onClose()
        } catch {
            setError(t('dialog.edit.error'))
        }
    }

    const handleKeyDown = (event: React.KeyboardEvent) => {
        if (event.key === 'Escape') {
            onClose()
        }
    }

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>{t('dialog.edit.title')}</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
                    <div className="flex flex-col gap-1.5">
                        <label className="text-sm font-medium text-[var(--app-fg)]" htmlFor="session-edit-name">
                            {t('dialog.edit.name')}
                        </label>
                        <input
                            id="session-edit-name"
                            ref={nameInputRef}
                            type="text"
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder={t('dialog.edit.namePlaceholder')}
                            className="w-full rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2.5 text-[var(--app-fg)] placeholder:text-[var(--app-hint)] focus:outline-none focus:ring-2 focus:ring-[var(--app-button)] focus:border-transparent"
                            disabled={isPending}
                            maxLength={255}
                        />
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <label className="text-sm font-medium text-[var(--app-fg)]" htmlFor="session-edit-directory">
                            {t('dialog.edit.directory')}
                        </label>
                        <input
                            id="session-edit-directory"
                            type="text"
                            value={directory}
                            onChange={(event) => setDirectory(event.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder={t('dialog.edit.directoryPlaceholder')}
                            className="w-full rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2.5 text-[var(--app-fg)] placeholder:text-[var(--app-hint)] focus:outline-none focus:ring-2 focus:ring-[var(--app-button)] focus:border-transparent"
                            disabled={isPending}
                        />
                    </div>

                    {error ? (
                        <div className="rounded-md bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                            {error}
                        </div>
                    ) : null}

                    <div className="flex justify-end gap-2">
                        <Button
                            type="button"
                            variant="secondary"
                            onClick={onClose}
                            disabled={isPending}
                        >
                            {t('button.cancel')}
                        </Button>
                        <Button
                            type="submit"
                            disabled={isPending || !directory.trim()}
                        >
                            {isPending ? t('dialog.edit.saving') : t('button.save')}
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    )
}
