import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

/**
 * In-memory cache for signed URLs to avoid re-fetching on every render.
 * Maps storage path -> { url: string, expiresAt: number }
 */
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>()

/**
 * Extracts the storage object path from a foto_url string.
 * Handles both:
 * 1. Plain storage path: "tenant-uuid/filename.jpg"
 * 2. Full public URL: "https://.../storage/v1/object/public/products/tenant-uuid/filename.jpg"
 * 3. Full signed URL: "https://.../storage/v1/object/sign/products/tenant-uuid/filename.jpg?token=..."
 */
export function extractStoragePath(fotoUrl: string | null | undefined): string | null {
  if (!fotoUrl) return null

  const trimmed = fotoUrl.trim()
  if (!trimmed) return null

  // If it's a data URL or blob URL, return as-is (not a storage object)
  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
    return null
  }

  // Check if it's a full Supabase URL
  const publicMarker = '/storage/v1/object/public/products/'
  const publicIdx = trimmed.indexOf(publicMarker)
  if (publicIdx !== -1) {
    return decodeURIComponent(trimmed.slice(publicIdx + publicMarker.length).split('?')[0])
  }

  const signMarker = '/storage/v1/object/sign/products/'
  const signIdx = trimmed.indexOf(signMarker)
  if (signIdx !== -1) {
    return decodeURIComponent(trimmed.slice(signIdx + signMarker.length).split('?')[0])
  }

  // If it's already a relative path (e.g. "tenant-uuid/file.jpg")
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    return trimmed
  }

  // External HTTP URL (e.g. Unsplash), not a Supabase storage path
  return null
}

const SIGNED_URL_TTL_SECONDS = 3600
// Refresh 5 minutes before expiration
const REFRESH_BUFFER_MS = 5 * 60 * 1000

/**
 * Hook to resolve a product's foto_url to a signed URL (or direct URL).
 * Follows Kiro gate 3.1 decision: Option B — short-TTL signed URLs.
 */
export function useProductImageUrl(fotoUrl: string | null | undefined): string | null {
  const path = extractStoragePath(fotoUrl)

  // Direct return for non-storage URLs (data URL, external, null)
  const isDirect = !path

  const [signedUrl, setSignedUrl] = useState<string | null>(() => {
    if (!path) return null
    return signedUrlCache.get(path)?.url ?? null
  })

  useEffect(() => {
    if (!path) return

    const cached = signedUrlCache.get(path)
    const now = Date.now()
    if (cached && cached.expiresAt > now + REFRESH_BUFFER_MS) {
      return
    }

    let isMounted = true

    async function fetchSignedUrl() {
      try {
        const { data, error } = await supabase.storage
          .from('products')
          .createSignedUrl(path!, SIGNED_URL_TTL_SECONDS)

        if (error || !data?.signedUrl) return

        signedUrlCache.set(path!, {
          url: data.signedUrl,
          expiresAt: Date.now() + SIGNED_URL_TTL_SECONDS * 1000,
        })

        if (isMounted) {
          setSignedUrl(data.signedUrl)
        }
      } catch {
        // Fallback to original
      }
    }

    void fetchSignedUrl()

    return () => {
      isMounted = false
    }
  }, [path])

  if (isDirect) {
    return fotoUrl ?? null
  }

  return signedUrl ?? (fotoUrl ?? null)
}
