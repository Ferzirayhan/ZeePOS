import { describe, expect, it } from 'vitest'
import { buildServiceWorker } from '../../build/serviceWorkerBuild'

const swSource = buildServiceWorker(['/', '/index.html', '/assets/index-test.js'])

const readme = import.meta.glob('../../README.md', {
  query: '?raw',
  import: 'default',
  eager: true,
})['../../README.md'] as string

const guide = import.meta.glob('../../APP_GUIDE.md', {
  query: '?raw',
  import: 'default',
  eager: true,
})['../../APP_GUIDE.md'] as string

describe('service worker catalog-only safety', () => {
  it('hanya meng-cache permintaan GET navigasi dan aset statis', () => {
    expect(swSource).toContain("'GET'")
  })

  it('tidak menyimpan transaksi offline (tidak ada fallback untuk POST/mutasi)', () => {
    expect(swSource).toMatch(/method.*!==.*'GET'/)
  })

  it('memberikan fallback navigasi ke index.html (shell katalog)', () => {
    expect(swSource).toContain('navigate')
    expect(swSource).toContain('/index.html')
  })
})

describe('README offline claim alignment', () => {
  it('menyebutkan katalog-only, bukan penjualan offline', () => {
    expect(readme.toLowerCase()).toContain('katalog')
    expect(readme.toLowerCase()).not.toContain('penjualan offline')
  })
})

describe('APP_GUIDE offline claim alignment', () => {
  it('menyebutkan catalog-only untuk mode offline', () => {
    expect(guide.toLowerCase()).toContain('catalog-only')
  })
})
