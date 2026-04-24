import { cn } from '@/lib/utils'

export function MaglevMark(props: { className?: string; size?: 'sm' | 'md' | 'lg' }) {
    const sizeClass = props.size === 'sm'
        ? 'h-10 w-10 text-base'
        : props.size === 'lg'
          ? 'h-14 w-14 text-2xl'
          : 'h-12 w-12 text-xl'

    return (
        <div
            className={cn(
                'inline-flex items-center justify-center rounded-2xl border border-white/45 bg-[linear-gradient(135deg,#f09a7c_0%,#e47353_60%,#d45d44_100%)] font-extrabold tracking-[-0.08em] text-[#fff8f4] shadow-[0_18px_40px_-26px_rgba(228,115,83,0.65)]',
                sizeClass,
                props.className
            )}
            aria-hidden="true"
        >
            M
        </div>
    )
}

export function MaglevWordmark(props: { className?: string; compact?: boolean }) {
    return (
        <div className={cn('flex flex-col', props.className)}>
            <span className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--app-hint)]">
                {props.compact ? 'Maglev' : 'Local-first control'}
            </span>
            <span className="text-lg font-extrabold tracking-[-0.04em] text-[var(--app-fg)]">
                maglev
            </span>
        </div>
    )
}
