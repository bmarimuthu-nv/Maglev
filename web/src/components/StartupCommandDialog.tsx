import { useEffect, useRef, useState } from 'react'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

type StartupCommandDialogProps = {
    isOpen: boolean
    onClose: () => void
    currentCommand?: string | null
    currentAutoRespawn?: boolean
    currentPinned?: boolean
    onSave: (options: { startupCommand: string | null; autoRespawn: boolean }) => Promise<void>
    isPending: boolean
}

export function StartupCommandDialog(props: StartupCommandDialogProps) {
    const { isOpen, onClose, currentCommand, currentAutoRespawn = false, currentPinned = false, onSave, isPending } = props
    const [command, setCommand] = useState(currentCommand ?? '')
    const [autoRespawn, setAutoRespawn] = useState(currentAutoRespawn)
    const [error, setError] = useState<string | null>(null)
    const textareaRef = useRef<HTMLTextAreaElement | null>(null)

    useEffect(() => {
        if (!isOpen) {
            return
        }
        setCommand(currentCommand ?? '')
        setAutoRespawn(currentAutoRespawn)
        setError(null)
        setTimeout(() => {
            textareaRef.current?.focus()
            textareaRef.current?.setSelectionRange(0, textareaRef.current.value.length)
        }, 100)
    }, [isOpen, currentAutoRespawn, currentCommand])

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault()
        setError(null)
        try {
            const trimmed = command.trim()
            await onSave({
                startupCommand: trimmed ? trimmed : null,
                autoRespawn
            })
            onClose()
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to update startup command'
            setError(message)
        }
    }

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>Startup command</DialogTitle>
                    <DialogDescription>
                        Runs when a fresh shell backend is created for this session. Leave empty to clear it.
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
                    <textarea
                        ref={textareaRef}
                        value={command}
                        onChange={(event) => setCommand(event.target.value)}
                        placeholder="Example: f2"
                        className="min-h-32 w-full rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2.5 font-mono text-sm text-[var(--app-fg)] placeholder:text-[var(--app-hint)] focus:outline-none focus:ring-2 focus:ring-[var(--app-button)] focus:border-transparent"
                        disabled={isPending}
                        maxLength={4000}
                    />

                    <label className={`flex items-center justify-between gap-3 rounded-lg border border-[var(--app-border)] px-3 py-2.5 text-sm ${currentPinned ? '' : 'opacity-60'}`}>
                        <div className="min-w-0">
                            <div className="font-medium text-[var(--app-fg)]">Auto-respawn on hub restart</div>
                            <div className="text-xs text-[var(--app-hint)]">Recreate this pinned shell automatically when the hub comes back.</div>
                        </div>
                        <input
                            type="checkbox"
                            checked={autoRespawn}
                            disabled={isPending || !currentPinned}
                            onChange={(event) => setAutoRespawn(event.target.checked)}
                            className="h-4 w-4 shrink-0 accent-[var(--app-link)]"
                        />
                    </label>

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
                            Cancel
                        </Button>
                        <Button type="submit" disabled={isPending}>
                            {isPending ? 'Saving…' : 'Save'}
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    )
}
