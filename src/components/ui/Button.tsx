import type { ButtonHTMLAttributes, PropsWithChildren } from 'react'
import { cn } from '../../utils/cn'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg' | 'xl'

interface ButtonProps
  extends PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  fullWidth?: boolean
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/20 hover:from-blue-700 hover:to-indigo-700 hover:shadow-lg hover:shadow-blue-500/30 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97]',
  secondary:
    'bg-slate-100 text-slate-700 hover:bg-slate-200/80 hover:text-slate-900 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] border border-slate-200/60',
  ghost:
    'bg-transparent text-blue-600 hover:bg-blue-50/80 active:bg-blue-100/60 active:scale-[0.97]',
  danger:
    'bg-gradient-to-r from-red-600 to-rose-600 text-white shadow-md shadow-red-500/20 hover:from-red-700 hover:to-rose-700 hover:shadow-lg hover:shadow-red-500/30 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97]',
}

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'min-h-[2.25rem] px-3.5 py-1.5 text-xs rounded-xl font-bold',
  md: 'min-h-[2.625rem] px-4 py-2.5 text-sm rounded-2xl font-bold',
  lg: 'min-h-[3rem] px-5 py-3 text-base rounded-2xl font-black',
  xl: 'min-h-[3.5rem] px-6 py-3.5 text-base rounded-2xl font-black tracking-wide',
}

export function Button({
  children,
  className,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  fullWidth = false,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 font-sans transition-all duration-200 ease-out select-none disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none disabled:active:scale-100',
        variantClasses[variant],
        sizeClasses[size],
        fullWidth && 'w-full',
        className,
      )}
      {...props}
    >
      {loading ? (
        <span className="inline-flex h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" />
      ) : null}
      <span>{children}</span>
    </button>
  )
}
