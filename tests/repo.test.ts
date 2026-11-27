// Repository guards: the team skeleton is in place, nothing internal reaches a repository that will
// be public, and tests only read files that ship with it.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file: string) => readFileSync(path.join(root, file), 'utf8')
const json = (file: string) => JSON.parse(read(file))

/** Tracked files plus new files not ignored by git: what a commit would carry. */
function repoFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: root,
    encoding: 'utf8',
  })
  return out.split('\0').filter((f) => f && existsSync(path.join(root, f)))
}

// Names of private projects, clients and the internal team that must never appear here. They are
// stored encoded so that this file passes its own check: the guard has no exceptions.
const BANNED = [
  'b3BlbmJvdA==',
  'dGltZSBkZXY=',
  'bmljayBmdXJ5',
  'dmVzcGE=',
  'YmF0bWFu',
  'aG9tZW0tYXJhbmhh',
  'ZGVtb2xpZG9y',
  'dG9ueSBzdGFyaw==',
  'b3JbYcOhXWN1bG8=',
  'cHJvZmVzc29yIHg=',
  'YmFyW2HDo11v',
  'YXRyYQ==',
  'dGVycmVpcm8=',
  'Z2lyYWh1Yg==',
  'c29maXNh',
  'YnJhaW5bLV8gXT9jb3BpbG90',
  'X3BsYW5vcw==',
].map((b64) => new RegExp(`\\b${Buffer.from(b64, 'base64').toString('utf8')}\\b`, 'iu'))

/** The only e-mail addresses a public file may carry: the security contact and GitHub's noreply. */
const ALLOWED_EMAIL = /^(contato@leopontes\.com\.br|[\w.+-]+@users\.noreply\.github\.com)$/i
const EMAIL = /[\w.+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi

const BINARY = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf|mp4|webm|pdf|zip|sqlite|db|bin|onnx)$/i

describe('team skeleton', () => {
  it.each([
    'README.md',
    'AGENTS.md',
    'CLAUDE.md',
    'CHANGELOG.md',
    'CONTRIBUTING.md',
    'SECURITY.md',
    'LICENSE',
    '.editorconfig',
    '.gitignore',
    '.env.example',
    '.nvmrc',
    'pnpm-lock.yaml',
    '.github/workflows/ci.yml',
    '.github/workflows/security.yml',
    '.github/dependabot.yml',
    'docs/README.md',
    'docs/ARCHITECTURE.md',
    'docs/adr/0001-pnpm-typescript-atlas.md',
    'docs/adr/0002-sqlite-brute-force-vectors-and-static-demo.md',
  ])('has %s', (file) => {
    expect(existsSync(path.join(root, file))).toBe(true)
  })

  it('is MIT licensed, with the security contact', () => {
    expect(read('LICENSE')).toMatch(/^MIT License/)
    expect(json('package.json').license).toBe('MIT')
    expect(read('SECURITY.md')).toContain('contato@leopontes.com.br')
  })

  it('runs on the Node version the team uses, everywhere', () => {
    const major = read('.nvmrc').trim()
    expect(major).toBe('24')
    expect(json('package.json').engines.node).toBe(`>=${major}.0.0`)
    expect(read('.github/workflows/ci.yml')).toContain('node-version-file: .nvmrc')
  })

  it('keeps Claude Code away from secrets and typechecks on stop', () => {
    const settings = json('.claude/settings.json')
    expect(settings.permissions.deny).toEqual(expect.arrayContaining(['Read(./.env)', 'Read(./.env.local)']))
    const hook = settings.hooks.Stop[0].hooks[0].command as string
    const script = hook.replace('"$CLAUDE_PROJECT_DIR"', root)
    expect(read(path.relative(root, script))).toContain('typecheck')
    expect(statSync(script).mode & 0o111).not.toBe(0)
  })

  it('scans for secrets in CI (with the permission pull requests need) and before each commit', () => {
    const security = read('.github/workflows/security.yml')
    expect(security).toContain('gitleaks/gitleaks-action')
    expect(security).toContain('pull-requests: read')
    expect(security).toContain('fetch-depth: 0')
    expect(read('.githooks/pre-commit')).toContain('gitleaks git --pre-commit --staged')
    expect(statSync(path.join(root, '.githooks/pre-commit')).mode & 0o111).not.toBe(0)
    expect(json('package.json').scripts.prepare).toContain('core.hooksPath .githooks')
  })

  it('measures coverage in CI, with floors, and checks before it builds', () => {
    const ci = read('.github/workflows/ci.yml')
    expect(ci).toContain('pnpm test --coverage') // never `pnpm test -- --coverage`: pnpm passes the -- on
    expect(ci).toContain('pnpm install --frozen-lockfile')
    expect(ci).toContain('pnpm audit --prod')
    expect(read('vitest.config.ts')).toMatch(/thresholds:[\s\S]*lines: 80[\s\S]*lines: 60/)
    expect(json('package.json').scripts.check).toBe(
      'pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm build',
    )
  })

  it('never commits real environment files', () => {
    const files = repoFiles()
    expect(files.filter((f) => /(^|\/)\.env(\.|$)/.test(f) && !f.endsWith('.env.example'))).toEqual([])
    expect(read('.env.example')).not.toMatch(/^[A-Z0-9_]+=\S/m)
  })
})

describe('monorepo', () => {
  const packages = [
    ['packages/vault', '@graph-rag/vault'],
    ['packages/index', '@graph-rag/index'],
    ['packages/search', '@graph-rag/search'],
    ['packages/api', '@graph-rag/api'],
    ['apps/web', '@graph-rag/web'],
    ['evals', '@graph-rag/evals'],
  ] as const

  // docs/adr/0001: every workspace package is private; the demo runs from a clone.
  it.each(packages)('%s is the private package %s with its own build', (dir, name) => {
    const pkg = json(`${dir}/package.json`)
    expect(pkg.name).toBe(name)
    expect(pkg.private).toBe(true)
    expect(pkg.scripts.build).toBeTruthy()
  })

  it.each(packages.filter(([dir]) => dir !== 'apps/web'))(
    '%s resolves to its source on a clean clone (TypeScript condition and Vitest alias)',
    (dir, name) => {
      expect(json(`${dir}/package.json`).exports['.']['graph-rag-source']).toBe('./src/index.ts')
      expect(read('vitest.config.ts')).toContain(
        `${name.replace('/', '\\/')}$/, replacement: src('./${dir}/src/index.ts')`,
      )
    },
  )

  it('runs the end-to-end tests on their own port, never on a server already running', () => {
    const config = read('playwright.config.ts')
    expect(config).toContain('process.env.E2E_PORT')
    expect(config).toContain('reuseExistingServer: false')
    expect(config).toContain('cli.js serve --port ${port}')
  })

  it('takes --port on every command that starts a server, with a strict port', () => {
    const vite = read('apps/web/vite.config.ts')
    expect(vite).toContain('strictPort: true')
    expect(vite).toContain("host: '127.0.0.1'")
    expect(vite).toContain('process.env.PORT')
    for (const script of ['demo', 'serve'])
      expect(json('package.json').scripts[script]).toMatch(/cli\.js serve$/)
    expect(read('packages/api/src/args.ts')).toContain('env.PORT')
  })

  it('uses the published Atlas components in the app', () => {
    const web = json('apps/web/package.json')
    expect(web.dependencies['@leonfpontes/atlas-ui']).toMatch(/^\d+\.\d+\.\d+$/)
  })
})

describe('public repository', () => {
  it('names no private project, client or internal team, with no exceptions', () => {
    const hits: string[] = []
    for (const file of repoFiles()) {
      if (BINARY.test(file)) continue
      const text = read(file)
      for (const word of BANNED) if (word.test(text)) hits.push(`${file}: ${word.source}`)
    }
    expect(hits).toEqual([])
  })

  it('carries no personal e-mail address', () => {
    const hits: string[] = []
    for (const file of repoFiles()) {
      if (BINARY.test(file) || file === 'pnpm-lock.yaml') continue
      for (const email of read(file).match(EMAIL) ?? [])
        if (!ALLOWED_EMAIL.test(email)) hits.push(`${file}: ${email}`)
    }
    expect(hits).toEqual([])
  })

  it('has tests that read only files inside the repository', () => {
    const outside = /(\/Users\/|\/home\/|~\/Documents|\.\.\/\.\.\/\.\.\/)/
    const tests = repoFiles().filter((f) => /\.(test|e2e)\.tsx?$/.test(f) && f !== 'tests/repo.test.ts')
    expect(tests.filter((f) => outside.test(read(f)))).toEqual([])
  })
})
