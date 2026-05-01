import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
    'inline-flex items-center justify-center whitespace-nowrap rounded-xl border border-transparent text-sm font-semibold transition-[transform,background-color,border-color,box-shadow,color,opacity] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mg-focus)] disabled:pointer-events-none disabled:opacity-50',
    {
        variants: {
            variant: {
                default: 'bg-[var(--app-button)] text-[var(--app-button-text)] shadow-[0_16px_40px_-24px_var(--app-button-shadow)] hover:-translate-y-px hover:bg-[var(--app-button-hover)]',
                secondary: 'border-[var(--app-border)] bg-[var(--app-surface-raised)] text-[var(--app-fg)] shadow-[var(--app-panel-shadow)] hover:-translate-y-px hover:bg-[var(--app-secondary-bg)]',
                outline: 'border-[var(--app-border)] bg-transparent text-[var(--app-fg)] hover:-translate-y-px hover:border-[var(--mg-border-strong)] hover:bg-[var(--app-subtle-bg)]',
                destructive: 'bg-red-600 text-white hover:bg-red-600/90'
            },
            size: {
                default: 'h-10 px-4 py-2',
                sm: 'h-9 rounded-lg px-3',
                lg: 'h-11 rounded-2xl px-8'
            }
        },
        defaultVariants: {
            variant: 'default',
            size: 'default'
        }
    }
)

export interface ButtonProps
    extends React.ButtonHTMLAttributes<HTMLButtonElement>,
        VariantProps<typeof buttonVariants> {
    asChild?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className, variant, size, asChild = false, ...props }, ref) => {
        const Comp = asChild ? Slot : 'button'
        return (
            <Comp
                className={cn(buttonVariants({ variant, size, className }))}
                ref={ref}
                {...props}
            />
        )
    }
)
Button.displayName = 'Button'
