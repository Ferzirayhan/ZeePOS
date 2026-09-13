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
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden font-black tracking-[-0.06em] shadow-[0_10px_24px_rgba(10,124,114,0.16)]',
        sizeClasses[size],
        inverted
          ? 'bg-white/14 text-white ring-1 ring-white/20'
          : 'bg-[linear-gradient(145deg,#0a7c72_0%,#0b8f83_100%)] text-white',
        className,
      )}
      aria-hidden="true"
    >
      <span className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.26),transparent_48%)]" />
      <span className="absolute inset-x-0 top-0 h-px bg-white/30" />
      <span className="relative flex items-center justify-center">
        <span>{display}</span>
      </span>
    </div>
  )
}
