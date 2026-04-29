import { useEffect, useRef } from 'react'

type SessionListFilterProps = {
    filters: {
        search: string
    }
    onSearchChange: (value: string) => void
    labels: {
        searchPlaceholder: string
    }
    visible: boolean
}

export function SessionListFilter(props: SessionListFilterProps) {
    const inputRef = useRef<HTMLInputElement | null>(null)

    useEffect(() => {
        if (!props.visible) {
            return
        }
        inputRef.current?.focus()
    }, [props.visible])

    if (!props.visible) {
        return null
    }

    return (
        <div className="px-2.5 pb-1">
            <div className="flex flex-col gap-2 rounded-[14px] bg-[var(--app-secondary-bg)] px-2.5 py-2 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--app-border)_65%,transparent)]">
                <input
                    ref={inputRef}
                    type="search"
                    value={props.filters.search}
                    onChange={(event) => props.onSearchChange(event.target.value)}
                    placeholder={props.labels.searchPlaceholder}
                    className="w-full rounded-xl border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 text-sm text-[var(--app-fg)] outline-none transition-colors placeholder:text-[var(--app-hint)] focus:border-[var(--app-link)]"
                />
            </div>
        </div>
    )
}
