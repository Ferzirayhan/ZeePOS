import { describe, expect, it } from 'vitest'
import vercelConfig from '../../vercel.json'

const headers = (vercelConfig as { headers?: { source: string; headers: { key: string; value: string }[] }[] }).headers ?? []

function header(name: string): string | undefined {
  for (const entry of headers) {
    const found = entry.headers.find((h) => h.key.toLowerCase() === name.toLowerCase())
    if (found) return found.value
  }
  return undefined
}

describe('security headers (vercel.json)', () => {
  it('applies headers to all routes', () => {
    const allRoutes = headers.find((entry) => entry.source === '/(.*)')
    expect(allRoutes).toBeDefined()
  })

  it('sets a Content-Security-Policy that allows the fonts and images the app actually loads', () => {
    const csp = header('Content-Security-Policy')
    expect(csp).toBeDefined()
    // Google Fonts (CSS + icon font) are imported in index.css.
    expect(csp).toMatch(/style-src[^;]*fonts\.googleapis\.com/)
    expect(csp).toMatch(/font-src[^;]*fonts\.gstatic\.com/)
    // Unsplash hero images and tenant product images served by Supabase Storage.
    expect(csp).toMatch(/img-src[^;]*images\.unsplash\.com/)
    expect(csp).toMatch(/img-src[^;]*https:\/\/\*\.supabase\.co/)
    expect(csp).toMatch(/connect-src[^;]*https:\/\/\*\.supabase\.co/)
    // Vite dev server and inline styles/scripts for the SPA shell.
    expect(csp).toMatch(/script-src[^;]*'self'/)
    expect(csp).toMatch(/style-src[^;]*'self'/)
    // The app writes inline styles into print popups, so style-src needs 'unsafe-inline'.
    expect(csp).toMatch(/style-src[^;]*'unsafe-inline'/)
  })

  it('severs cross-origin opener access to isolate the POS window', () => {
    const coep = header('Cross-Origin-Opener-Policy')
    expect(coep).toBe('same-origin')
  })

  it('prevents frame embedding (clickjacking) on production routes', () => {
    const frame = header('X-Frame-Options')
    expect(frame).toBe('DENY')
  })

  it('opts into X-Content-Type-Options: nosniff', () => {
    expect(header('X-Content-Type-Options')).toBe('nosniff')
  })

  it('uses strict referrer policy so receipt/tenant URLs do not leak to third parties', () => {
    expect(header('Referrer-Policy')).toBe('strict-origin-when-cross-origin')
  })
})
