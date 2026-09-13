import { forwardRef } from 'react'
import type { InputHTMLAttributes, ReactNode } from 'react'
import { cn } from '../../utils/cn'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  helperText?: string
  icon?: ReactNode
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, helperText, className, icon, type = 'text', id, ...props },
  ref,
) {
  return (
    <label className="flex w-full flex-col gap-1.5">
      {label ? (
        <span className="text-xs font-bold text-slate-700 tracking-tight">{label}</span>
      ) : null}
      <span className="relative block">
        {icon ? (
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 transition-colors">
            {icon}
          </span>
        ) : null}
        <input
          ref={ref}
          id={id}
          type={type}
          className={cn(
            'w-full rounded-2xl border border-slate-200/80 bg-white px-4 py-3 text-sm text-slate-800 placeholder:text-slate-400 outline-none transition-all duration-200 shadow-sm focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10 hover:border-slate-300',
            icon && 'pl-11',
            error && 'border-red-400 bg-red-50/20 text-red-900 placeholder:text-red-300 focus:border-red-500 focus:ring-red-500/10',
            className,
          )}
          {...props}
        />
      </span>
      {error ? (
        <span className="flex items-center gap-1 text-xs font-medium text-red-600">
          <span className="material-symbols-outlined text-[14px]">error</span>
          {error}
        </span>
      ) : helperText ? (
        <span className="text-xs text-slate-500 font-medium">{helperText}</span>
      ) : null}
    </label>
  )
})
