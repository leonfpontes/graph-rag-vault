import { readFileSync } from 'node:fs'
import path from 'node:path'

import { loadQuestions } from '@graph-rag/evals'
import { describe, expect, it, vi } from 'vitest'

import { evalData, evalDataFiles, questionsJson, REPO_ROOT, siteOrigin, siteUrl } from '../build-plugins.ts'

const read = (file: string) => readFileSync(path.join(REPO_ROOT, file), 'utf8')

describe('evaluation data for the app', () => {
  it('serves the scoreboard and the recorded answers byte for byte, never a copy', () => {
    const files = evalDataFiles()
    expect(files['latest.json']).toBe(read('evals/results/latest.json'))
    expect(files['answers.json']).toBe(read('evals/results/answers.json'))
  })

  it('writes the questions with the fields the app shows, as evals reads them', () => {
    const yaml = read('evals/questions.yaml')
    expect(JSON.parse(questionsJson(yaml))).toEqual(
      loadQuestions(yaml).map((q) => ({
        id: q.id,
        kind: q.kind,
        split: q.split,
        question: q.question,
        expectedSources: q.expectedSources,
        traps: q.traps.map((t) => t.kind),
      })),
    )
    expect(evalDataFiles()['questions.json']).toBe(questionsJson(yaml))
  })

  it('emits the three files under data/ in the build', () => {
    const plugin = evalData()
    const emitFile = vi.fn()
    ;(plugin.generateBundle as unknown as (this: unknown) => void).call({ emitFile })
    expect(emitFile.mock.calls.map(([f]) => f.fileName).sort()).toEqual([
      'data/answers.json',
      'data/latest.json',
      'data/questions.json',
    ])
    expect(emitFile.mock.calls.every(([f]) => f.type === 'asset')).toBe(true)
  })

  it('serves them in pnpm dev, read again on each request, and leaves other paths alone', () => {
    let middleware!: (req: { url?: string }, res: unknown, next: () => void) => void
    const hook = evalData().configureServer as unknown as (server: unknown) => void
    hook({ middlewares: { use: (fn: typeof middleware) => (middleware = fn) } })
    const res = { setHeader: vi.fn(), end: vi.fn() }
    const next = vi.fn()
    middleware({ url: '/data/latest.json?t=1' }, res, next)
    expect(res.setHeader).toHaveBeenCalledWith('content-type', 'application/json; charset=utf-8')
    expect(res.end).toHaveBeenCalledWith(read('evals/results/latest.json'))
    for (const url of ['/data/index.bin', '/data/other.json', '/ask', undefined])
      middleware({ url }, { setHeader: vi.fn(), end: vi.fn() }, next)
    expect(next).toHaveBeenCalledTimes(4)
  })
})

describe('site URL for the social cards', () => {
  it('uses SITE_URL, else the Vercel production domain, and fails a production build with neither', () => {
    expect(siteOrigin({ SITE_URL: 'https://graph.example.dev/' })).toBe('https://graph.example.dev')
    expect(siteOrigin({ VERCEL_PROJECT_PRODUCTION_URL: 'graph-rag.vercel.app' })).toBe(
      'https://graph-rag.vercel.app',
    )
    expect(siteOrigin({})).toBe('')
    expect(() => siteOrigin({ VERCEL_ENV: 'production' })).toThrow(/SITE_URL/)
  })

  it('writes absolute og:image and og:url into index.html', () => {
    const html = read('apps/web/index.html')
    for (const tag of ['og:url" content="__SITE_URL__/"', 'og:image" content="__SITE_URL__/og.png"'])
      expect(html).toContain(tag)
    const transform = siteUrl({ SITE_URL: 'https://graph.example.dev' }).transformIndexHtml as (
      h: string,
    ) => string
    const out = transform(html)
    expect(out).toContain('<meta property="og:image" content="https://graph.example.dev/og.png" />')
    expect(out).not.toContain('__SITE_URL__')
  })
})

describe('pnpm dev', () => {
  it("proxies /api with the page's own Host, so the answer route accepts its Origin", async () => {
    const { default: config } = await import('../vite.config.ts')
    const proxy = (
      config as { server?: { proxy?: Record<string, { changeOrigin?: boolean; target?: string }> } }
    ).server?.proxy?.['/api']
    expect(proxy?.changeOrigin).toBe(false)
    expect(proxy?.target).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
  })
})
