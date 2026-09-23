import { describe, expect, it } from 'vitest'
import { extractStoragePath } from '../hooks/useProductImageUrl'

describe('extractStoragePath (Task 19.3)', () => {
  it('mengembalikan null untuk input kosong / falsy', () => {
    expect(extractStoragePath(null)).toBeNull()
    expect(extractStoragePath(undefined)).toBeNull()
    expect(extractStoragePath('')).toBeNull()
    expect(extractStoragePath('   ')).toBeNull()
  })

  it('mengembalikan null untuk data URL atau blob URL', () => {
    expect(extractStoragePath('data:image/png;base64,iVBORw0KGgo...')).toBeNull()
    expect(extractStoragePath('blob:http://localhost:5173/uuid')).toBeNull()
  })

  it('mengekstrak path dari full Supabase public URL', () => {
    const url =
      'https://your-project.supabase.co/storage/v1/object/public/products/6ea24cf8-efb3-4472-9558-46088ee11ea8/photo.jpg'
    expect(extractStoragePath(url)).toBe(
      '6ea24cf8-efb3-4472-9558-46088ee11ea8/photo.jpg',
    )
  })

  it('mengekstrak path dari full Supabase public URL dengan query params (cache buster)', () => {
    const url =
      'https://your-project.supabase.co/storage/v1/object/public/products/6ea24cf8-efb3-4472-9558-46088ee11ea8/photo.jpg?v=12345'
    expect(extractStoragePath(url)).toBe(
      '6ea24cf8-efb3-4472-9558-46088ee11ea8/photo.jpg',
    )
  })

  it('mengekstrak path dari full Supabase signed URL', () => {
    const url =
      'https://your-project.supabase.co/storage/v1/object/sign/products/6ea24cf8-efb3-4472-9558-46088ee11ea8/photo.jpg?token=abc'
    expect(extractStoragePath(url)).toBe(
      '6ea24cf8-efb3-4472-9558-46088ee11ea8/photo.jpg',
    )
  })

  it('mengembalikan relative path apa adanya jika sudah berupa path', () => {
    expect(extractStoragePath('6ea24cf8-efb3-4472-9558-46088ee11ea8/photo.jpg')).toBe(
      '6ea24cf8-efb3-4472-9558-46088ee11ea8/photo.jpg',
    )
  })

  it('mengembalikan null untuk external HTTP URL bukan Supabase storage', () => {
    expect(extractStoragePath('https://images.unsplash.com/photo-123')).toBeNull()
  })
})
