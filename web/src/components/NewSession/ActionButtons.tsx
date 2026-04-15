import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/Spinner'
import { useTranslation } from '@/lib/use-translation'

export function ActionButtons(props: {
    isPending: boolean
    canCreate: boolean
    isDisabled: boolean
    onCancel: () => void
    onCreate: () => void
}) {
    const { t } = useTranslation()

    return (
        <div className="sticky bottom-0 z-10 flex gap-2 border-t border-[var(--app-divider)] bg-[var(--app-bg)] px-3 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            <Button
                variant="secondary"
                onClick={props.onCancel}
                disabled={props.isDisabled}
            >
                {t('button.cancel')}
            </Button>
            <Button
                onClick={props.onCreate}
                disabled={!props.canCreate}
                aria-busy={props.isPending}
                className="gap-2"
            >
                {props.isPending ? (
                    <>
                        <Spinner size="sm" label={null} className="text-[var(--app-button-text)]" />
                        {t('newSession.creating')}
                    </>
                ) : (
                    t('newSession.create')
                )}
            </Button>
        </div>
    )
}
