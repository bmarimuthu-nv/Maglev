type SessionListFilterProps = {
    counts: {
        active: number
        stopped: number
        archived: number
    }
    filters: {
        active: boolean
        stopped: boolean
        archived: boolean
        search: string
    }
    onToggle: (key: 'active' | 'stopped' | 'archived') => void
    onSearchChange: (value: string) => void
    labels: {
        active: string
        stopped: string
        archived: string
        searchPlaceholder: string
    }
}

function FilterChip(props: {
    active: boolean
    count: number
    label: string
    onClick: () => void
}) {
    return (
        <button
            type="button"
            onClick={props.onClick}
            className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[12px] font-medium transition-colors ${
                props.active
                    ? 'border-[var(--app-link)] bg-[color-mix(in_srgb,var(--app-link)_12%,transparent)] text-[var(--app-fg)]'
                    : 'border-[var(--app-border)] bg-transparent text-[var(--app-hint)] hover:text-[var(--app-fg)]'
            }`}
            aria-pressed={props.active}
        >
            <span>{props.label}</span>
            <span className="text-[10px] opacity-80">{props.count}</span>
        </button>
    )
}

export function SessionListFilter(props: SessionListFilterProps) {
    return (
        <div className="px-2.5 pb-1">
            <div className="flex flex-col gap-2 rounded-[14px] bg-[var(--app-secondary-bg)] px-2.5 py-2 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--app-border)_65%,transparent)]">
                <div className="flex flex-wrap items-center gap-2">
                    <FilterChip
                        active={props.filters.active}
                        count={props.counts.active}
                        label={props.labels.active}
                        onClick={() => props.onToggle('active')}
                    />
                    <FilterChip
                        active={props.filters.stopped}
                        count={props.counts.stopped}
                        label={props.labels.stopped}
                        onClick={() => props.onToggle('stopped')}
                    />
                    <FilterChip
                        active={props.filters.archived}
                        count={props.counts.archived}
                        label={props.labels.archived}
                        onClick={() => props.onToggle('archived')}
                    />
                </div>
                <input
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
