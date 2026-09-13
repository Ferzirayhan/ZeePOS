import { describe, expect, it } from 'vitest'
import posPage from '../pages/POSPage.tsx?raw'
import { buildServiceWorker } from '../../build/serviceWorkerBuild'

const serviceWorker = buildServiceWorker(['/', '/index.html', '/assets/index-test.js'])
import authStore from '../stores/authStore.ts?raw'

describe('POS final integration guards', () => {
  it('carries exact unit identity through numpad edits', () => {
    expect(posPage).toMatch(/numpadItem[\s\S]*unitId:/)
    expect(posPage).toMatch(/updateQty\(numpadItem\.productId, val, numpadItem\.unitId\)/)
  })

  it('sets a synchronous payment ref before checkout awaits and resets it in finally', () => {
    expect(posPage).toMatch(/processingPaymentRef\.current[\s\S]*return/)
    expect(posPage).toMatch(/processingPaymentRef\.current\s*=\s*true[\s\S]*try\s*\{[\s\S]*await/)
    expect(posPage).toMatch(/finally\s*\{[\s\S]*processingPaymentRef\.current\s*=\s*false/)
  })

  it('syncs held carts to the authenticated tenant and clears them on logout', () => {
    expect(posPage).toMatch(/setHeldCartTenant\(tenantId \|\| null\)/)
    expect(authStore).toMatch(/clearForLogout\(\)/)
  })
})

describe('catalog-only service worker', () => {
  it('versions and pre-caches the app shell', () => {
    expect(serviceWorker).toMatch(/CACHE_NAME\s*=\s*['"]zeepos-shell-[a-f0-9]+/)
    expect(serviceWorker).toMatch(/cache\.addAll\(APP_SHELL\)/)
    expect(serviceWorker).toContain('"/"')
    expect(serviceWorker).toContain('"/index.html"')
    expect(serviceWorker).toContain('"/assets/index-test.js"')
  })

  it('cleans old caches and uses network-first navigation fallback', () => {
    expect(serviceWorker).toMatch(/caches\.keys\(\)[\s\S]*caches\.delete/)
    expect(serviceWorker).toMatch(/mode === 'navigate'[\s\S]*fetch\([\s\S]*caches\.match\('\/index\.html'\)/)
  })

  it('never caches API, auth, Supabase, or mutation requests', () => {
    expect(serviceWorker).toMatch(/method !== 'GET'/)
    expect(serviceWorker).toMatch(/supabase\.co|\/auth\/|\/rest\/v1\//)
  })
})
