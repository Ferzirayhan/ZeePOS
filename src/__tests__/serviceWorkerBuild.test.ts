import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'vite'
import { describe, expect, it } from 'vitest'
import { buildServiceWorker, collectPrecacheAssets, serviceWorkerBuildPlugin } from '../../build/serviceWorkerBuild'

describe('service worker build output', () => {
  it('pre-caches every emitted JavaScript and CSS asset', () => {
    const emittedFiles = [
      'index.html',
      'assets/index-a1b2c3.js',
      'assets/index-d4e5f6.css',
      'assets/logo.svg',
      'reports/stats.json',
    ]

    const assets = collectPrecacheAssets(emittedFiles)
    const worker = buildServiceWorker(assets)

    expect(assets).toEqual([
      '/',
      '/index.html',
      '/assets/index-a1b2c3.js',
      '/assets/index-d4e5f6.css',
    ])
    for (const asset of assets) expect(worker).toContain(JSON.stringify(asset))
  })

  it('bypasses Supabase, API, auth, and non-GET requests', () => {
    const worker = buildServiceWorker(['/index.html', '/assets/app.js'])

    expect(worker).toMatch(/request\.method !== 'GET'/)
    expect(worker).toMatch(/supabase\.co/)
    expect(worker).toMatch(/\/auth\//)
    expect(worker).toMatch(/\/rest\/v1\//)
    expect(worker).toMatch(/\/api\//)
  })

  it('serves emitted shell assets cache-first while keeping navigation network-first', () => {
    const worker = buildServiceWorker(['/index.html', '/assets/app.js'])

    expect(worker).toMatch(/APP_SHELL\.includes\(url\.pathname\)/)
    expect(worker).toMatch(/caches\.match\(request\)[\s\S]*fetch\(request\)/)
    expect(worker).toMatch(/request\.mode === 'navigate'[\s\S]*fetch\(request\)[\s\S]*caches\.match\('\/index\.html'\)/)
  })

  it('injects the actual hashed JavaScript and CSS emitted by Vite', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zeepos-sw-'))
    try {
      await writeFile(join(root, 'index.html'), '<div id="app"></div><script type="module" src="/src.js"></script>')
      await writeFile(join(root, 'src.js'), "import './style.css'; document.querySelector('#app').textContent = 'offline'")
      await writeFile(join(root, 'style.css'), 'body { color: navy; }')

      await build({
        root,
        logLevel: 'silent',
        plugins: [serviceWorkerBuildPlugin()],
        build: { outDir: 'dist' },
      })

      const emittedAssets = await readdir(join(root, 'dist/assets'))
      const worker = await readFile(join(root, 'dist/sw.js'), 'utf8')
      const script = emittedAssets.find((name) => name.endsWith('.js'))
      const stylesheet = emittedAssets.find((name) => name.endsWith('.css'))

      expect(script).toBeDefined()
      expect(stylesheet).toBeDefined()
      expect(worker).toContain(`"/assets/${script}"`)
      expect(worker).toContain(`"/assets/${stylesheet}"`)
      expect(worker).toContain('"/index.html"')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
