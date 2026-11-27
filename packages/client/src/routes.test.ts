import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { decodeIndex } from '@graph-rag/search'
import { describe, expect, it } from 'vitest'

import { APP_PATHS, matchRoute, NOTE_ID, paths } from './routes.js'

/** The repository root: up from here to pnpm-workspace.yaml. */
function repoRoot(dir = import.meta.dirname): string {
  return existsSync(path.join(dir, 'pnpm-workspace.yaml')) ? dir : repoRoot(path.dirname(dir))
}
const root = repoRoot()

const APP = ['/', '/explore', '/ask', '/evaluation', '/notes/per-maya-okafor', '/notes/q3-review-2026']
const UNKNOWN = [
  '/nope',
  '/asks',
  '/ask/more',
  '/notes',
  '/notes/',
  '/notes/Per-Maya',
  '/notes/a/b',
  '/notes/-x',
  '/index',
  '/api',
]

describe('routes', () => {
  it('names every route of the app, and nothing else', () => {
    expect(matchRoute('/')).toEqual({ name: 'how-it-works' })
    expect(matchRoute('/explore')).toEqual({ name: 'explore' })
    expect(matchRoute('/ask/')).toEqual({ name: 'ask' })
    expect(matchRoute('/evaluation')).toEqual({ name: 'evaluation' })
    expect(matchRoute('/notes/per-maya-okafor')).toEqual({ name: 'note', id: 'per-maya-okafor' })
    for (const p of UNKNOWN) expect(matchRoute(p).name, p).toBe('not-found')
  })

  it('builds links that route back to the same place', () => {
    expect(paths.howItWorks()).toBe('/')
    expect(paths.explore()).toBe('/explore')
    expect(paths.explore('per-maya-okafor')).toBe('/explore?focus=per-maya-okafor')
    expect(paths.ask()).toBe('/ask')
    expect(paths.ask('Who owns RL-1?')).toBe('/ask?q=Who%20owns%20RL-1%3F')
    expect(paths.evaluation()).toBe('/evaluation')
    expect(matchRoute(paths.note('per-maya-okafor'))).toEqual({ name: 'note', id: 'per-maya-okafor' })
    expect(() => paths.note('../etc')).toThrow(/not a note id/)
  })

  it('has a route for every note of the index', () => {
    const index = decodeIndex(readFileSync(path.join(root, 'apps/web/public/data/index.bin')))
    expect(index.notes.length).toBeGreaterThan(100)
    for (const n of index.notes) expect(NOTE_ID.test(n.id), n.id).toBe(true)
  })
})

describe('vercel.json', () => {
  const config = JSON.parse(readFileSync(path.join(root, 'vercel.json'), 'utf8')) as {
    buildCommand: string
    outputDirectory: string
    rewrites: { source: string; destination: string }[]
  }
  /** The path-to-regexp forms the file uses: a group `(a|b)` and `:name(regex)`. */
  const regexOf = (source: string) => new RegExp(`^${source.replace(/:\w+\(([^)]+)\)/g, '($1)')}$`)
  const destination = (p: string) => config.rewrites.find((r) => regexOf(r.source).test(p))?.destination

  it('opens index.html for every route of the app, and only for those', () => {
    // `/` is index.html itself; Vercel strips a trailing slash before the rewrites.
    for (const p of [...Object.values(APP_PATHS).filter((x) => x !== '/'), ...APP.slice(4)])
      expect(destination(p), p).toBe('/index.html')
    for (const p of UNKNOWN) expect(destination(p), p).toBeUndefined()
  })

  it('agrees with the router on every path it is given', () => {
    for (const p of [...APP.filter((x) => x !== '/'), ...UNKNOWN])
      expect(destination(p) === '/index.html', p).toBe(matchRoute(p).name !== 'not-found')
  })

  it('ships a 404.html, which Vercel serves with status 404, so unknown routes get the app 404 page', () => {
    expect(config.buildCommand).toContain(
      `cp ${config.outputDirectory}/index.html ${config.outputDirectory}/404.html`,
    )
    expect(config.outputDirectory).toBe('apps/web/dist')
  })
})
