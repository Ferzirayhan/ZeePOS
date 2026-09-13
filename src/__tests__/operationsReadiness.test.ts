import { describe, expect, it } from 'vitest'
import workflow from '../../.github/workflows/ci.yml?raw'
import gitignore from '../../.gitignore?raw'
import deployment from '../../docs/DEPLOYMENT.md?raw'
import security from '../../docs/SECURITY.md?raw'
import eslintConfig from '../../eslint.config.js?raw'
import packageJsonText from '../../package.json?raw'
import supabaseConfig from '../../supabase/config.toml?raw'
import viteConfig from '../../vite.config.ts?raw'
import readme from '../../README.md?raw'

const files: Record<string, string> = {
  '.github/workflows/ci.yml': workflow,
  '.gitignore': gitignore,
  'docs/DEPLOYMENT.md': deployment,
  'docs/SECURITY.md': security,
  'eslint.config.js': eslintConfig,
  'package.json': packageJsonText,
  'supabase/config.toml': supabaseConfig,
  'vite.config.ts': viteConfig,
  'README.md': readme,
}
const read = (path: string) => files[path]

describe('continuous integration quality gates', () => {
  it('runs the required Node 20 checks for pushes and pull requests to main', () => {
    const workflow = read('.github/workflows/ci.yml')

    expect(workflow).toMatch(/push:\s*\n\s*branches:\s*\[main\]/)
    expect(workflow).toMatch(/pull_request:\s*\n\s*branches:\s*\[main\]/)
    expect(workflow).toMatch(/node-version:\s*20/)
    for (const command of ['npm ci', 'npm test', 'npm run test:coverage', 'npm run lint', 'npm run build']) {
      expect(workflow).toContain(`run: ${command}`)
    }
  })

  it('explicitly checks migration security invariants and reports high-severity audit findings without blocking', () => {
    const workflow = read('.github/workflows/ci.yml')

    expect(workflow).toContain('securityMigration.test.ts')
    expect(workflow).toContain('transactionInvariants.test.ts')
    expect(workflow).toMatch(/npm audit --audit-level=high[\s\S]*continue-on-error:\s*true/)
  })

  it('configures v8 coverage reports and a coverage command', () => {
    const packageJson = JSON.parse(read('package.json')) as {
      scripts: Record<string, string>
      devDependencies: Record<string, string>
    }
    const viteConfig = read('vite.config.ts')

    expect(packageJson.scripts['test:coverage']).toBe('vitest run --coverage')
    expect(packageJson.devDependencies['@vitest/coverage-v8']).toMatch(/^\^?4\.1\./)
    expect(viteConfig).toMatch(/provider:\s*['"]v8['"]/)
    expect(viteConfig).toMatch(/reporter:\s*\[['"]text['"], ['"]json['"], ['"]html['"]\]/)
    expect(viteConfig).toContain('src/types/**')
    expect(viteConfig).toContain('src/__tests__/**')
    expect(read('eslint.config.js')).toMatch(/globalIgnores\(\[[^\]]*['"]coverage['"]/)
    expect(read('.gitignore')).toMatch(/^coverage\/?$/m)
  })
})

describe('deployment documentation', () => {
  it('documents database preparation and the production migration gate', () => {
    const runbook = read('docs/DEPLOYMENT.md')

    expect(runbook).toContain('supabase link --project-ref')
    expect(runbook).toContain('supabase db push')
    expect(runbook).toMatch(/backup/i)
    expect(runbook).toMatch(/rollback/i)
    expect(runbook).toMatch(/054_security_boundary_hardening\.sql[\s\S]*055_transaction_inventory_invariants\.sql/)
    expect(runbook).toMatch(/must be applied to the live Supabase project before the frontend deploy/i)
  })

  it('documents auth, storage, smoke tests, and the dependency audit posture', () => {
    const runbook = read('docs/DEPLOYMENT.md')
    const security = read('docs/SECURITY.md')

    expect(runbook).toContain('http://localhost:5173')
    expect(runbook).toMatch(/production URL/i)
    expect(runbook).toMatch(/product-images/i)
    expect(runbook).toMatch(/polic/i)
    expect(runbook).toMatch(/smoke test/i)
    expect(security).toContain('npm audit --json')
    expect(security).toMatch(/direct/i)
    expect(security).toMatch(/transitive/i)
    expect(security).toMatch(/non-blocking/i)
  })

  it('aligns local auth redirects and links the runbook from README', () => {
    expect(read('supabase/config.toml')).toContain('site_url = "http://127.0.0.1:5173"')
    expect(read('README.md')).toContain('[Deployment runbook](docs/DEPLOYMENT.md)')
  })
})
