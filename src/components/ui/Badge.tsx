import type { HTMLAttributes, PropsWithChildren } from 'react'
import { cn } from '../../utils/cn'

type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

interface BadgeProps extends PropsWithChildren<HTMLAttributes<HTMLSpanElement>> {
  variant?: BadgeVariant
  dot?: boolean
}

const badgeClasses: Record<BadgeVariant, string> = {
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200/80',
  warning: 'bg-amber-50 text-amber-700 border-amber-200/80',
  danger: 'bg-red-50 text-red-700 border-red-200/80',
  info: 'bg-blue-50 text-blue-700 border-blue-200/80',
  neutral: 'bg-slate-100 text-slate-700 border-slate-200/80',
}

const dotClasses: Record<BadgeVariant, string> = {
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-red-500',
  info: 'bg-blue-500',
  neutral: 'bg-slate-400',
}

export function Badge({
  children,
  className,
  variant = 'neutral',
  dot = false,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-extrabold tracking-wider uppercase',
        badgeClasses[variant],
        className,
      )}
      {...props}
    >
      {dot ? (
        <span className={cn('h-1.5 w-1.5 rounded-full shrink-0 animate-pulse', dotClasses[variant])} />
      ) : null}
      {children}
    </span>
  )
}
