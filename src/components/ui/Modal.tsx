import { useEffect } from 'react'
import type { PropsWithChildren, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../../utils/cn'

interface ModalProps extends PropsWithChildren {
  open: boolean
  onClose: () => void
  title?: string
  description?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
}

const sizeClasses = {
  sm: 'max-w-md',
  md: 'max-w-2xl',
  lg: 'max-w-4xl',
  xl: 'max-w-6xl',
}

export function Modal({
  open,
  onClose,
  title,
  description,
  size = 'md',
  children,
}: ModalProps) {
  useEffect(() => {
    if (!open) {
      return undefined
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [onClose, open])

  if (!open) {
    return null
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 sm:p-6 transition-all duration-200">
      <div
        className="absolute inset-0"
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'relative z-[101] flex flex-col max-h-[90vh] w-full rounded-3xl border border-slate-200/80 bg-white shadow-2xl shadow-slate-900/20 overflow-hidden animate-in fade-in zoom-in-95 duration-200',
          sizeClasses[size],
        )}
      >
        {title ? (
          <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-4.5 bg-slate-50/50">
            <div className="min-w-0 flex-1 pr-2">
              <h2 className="text-lg sm:text-xl font-extrabold text-slate-900 tracking-tight">{title}</h2>
              {description ? (
                <div className="mt-0.5 text-xs sm:text-sm text-slate-500 font-medium">{description}</div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Tutup modal"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-800"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
        ) : null}
        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
