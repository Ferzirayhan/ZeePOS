import { memo } from 'react'
import { useProductImageUrl } from '../../hooks/useProductImageUrl'

interface ProductImageProps {
  fotoUrl: string | null | undefined
  alt: string
  className?: string
  fallbackIconSize?: string
}

export const ProductImage = memo(function ProductImage({
  fotoUrl,
  alt,
  className = 'h-12 w-12 rounded-[14px] object-cover',
  fallbackIconSize,
}: ProductImageProps) {
  const imageUrl = useProductImageUrl(fotoUrl)

  if (!imageUrl) {
    return (
      <div
        className={`flex items-center justify-center rounded-[14px] bg-[#eff6ff] text-[#2563eb] ${className}`}
      >
        <span
          className="material-symbols-outlined"
          style={fallbackIconSize ? { fontSize: fallbackIconSize } : undefined}
        >
          inventory_2
        </span>
      </div>
    )
  }

  return <img src={imageUrl} alt={alt} className={className} />
})
