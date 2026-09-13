import { cn } from '../../utils/cn'

interface BrandMarkProps {
  size?: 'sm' | 'md' | 'lg'
  inverted?: boolean
  className?: string
  text?: string
}

const sizeClasses = {
  sm: 'h-9 w-9 rounded-[12px] text-[12px]',
  md: 'h-11 w-11 rounded-[14px] text-[13px]',
  lg: 'h-14 w-14 rounded-[18px] text-[16px]',
}

export function BrandMark({ size = 'md', inverted = false, className, text }: BrandMarkProps) {
  const display = text ? text.slice(0, 3).toUpperCase() : 'ZEE'

  return (
    <div
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden font-extrabold tracking-[-0.04em] shadow-sm select-none',
        sizeClasses[size],
        inverted
          ? 'bg-white/15 text-white ring-1 ring-white/20'
          : 'bg-[#2563eb] text-white shadow-blue-500/20',
        className,
      )}
      aria-hidden="true"
    >
      <span className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.25),transparent_50%)]" />
      <span className="absolute inset-x-0 top-0 h-px bg-white/30" />
      <span className="relative flex items-center justify-center font-black">
        {display}
      </span>
    </div>
  )
}
