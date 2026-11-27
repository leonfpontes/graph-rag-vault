// Two build steps of the app, kept apart from vite.config.ts so tests can run them.
//
// evalData: the evaluation's files reach the app as they are. /data/latest.json (the scoreboard) and
// /data/answers.json (the recorded answers) are evals/results/*.json byte for byte, and
// /data/questions.json is evals/questions.yaml with the fields the app shows. They are read from the
// repository on every request in `pnpm dev` and on every build, so no copy can fall behind.
//
// siteUrl: social cards need absolute URLs. SITE_URL is the public origin; on Vercel it falls back to
// the production domain Vercel gives. A production build without either fails: a relative
// og:image makes every shared link show no picture.
import { readFileSync } from 'node:fs'
import path from 'node:path'

import type { Plugin } from 'vite'
import { parse } from 'yaml'

/** The repository root, from this file (apps/web). */
export const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..')

/** The fields of a question the app shows (RecordedQuestion in @graph-rag/client). */
export function questionsJson(yamlText: string): string {
  const { questions } = parse(yamlText) as { questions: Record<string, unknown>[] }
  return JSON.stringify(
    questions.map((q) => ({
      id: q.id,
      kind: q.kind,
      split: q.split,
      question: q.question,
      expectedSources: q.expectedSources,
      traps: ((q.traps ?? []) as { kind: string }[]).map((t) => t.kind),
    })),
  )
}

/** The data files under /data/ that come from the evaluation, by file name. */
export function evalDataFiles(root: string = REPO_ROOT): Record<string, string> {
  const read = (file: string) => readFileSync(path.join(root, file), 'utf8')
  return {
    'latest.json': read('evals/results/latest.json'),
    'answers.json': read('evals/results/answers.json'),
    'questions.json': questionsJson(read('evals/questions.yaml')),
  }
}

export function evalData(root: string = REPO_ROOT): Plugin {
  return {
    name: 'graph-rag-eval-data',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = /^\/data\/([a-z]+\.json)$/.exec((req.url ?? '').split('?')[0]!)?.[1]
        const files = name ? evalDataFiles(root) : undefined
        if (!name || !files?.[name]) return next()
        res.setHeader('content-type', 'application/json; charset=utf-8')
        res.end(files[name])
      })
    },
    generateBundle() {
      for (const [name, source] of Object.entries(evalDataFiles(root)))
        this.emitFile({ type: 'asset', fileName: `data/${name}`, source })
    },
  }
}

export function siteOrigin(env: Record<string, string | undefined> = process.env): string {
  const vercel = env.VERCEL_PROJECT_PRODUCTION_URL
  const origin = (env.SITE_URL || (vercel ? `https://${vercel}` : '')).replace(/\/$/, '')
  if (!origin && env.VERCEL_ENV === 'production')
    throw new Error(
      'Set SITE_URL (for example https://graph-rag.example.dev): the social cards need an absolute URL.',
    )
  return origin
}

export const siteUrl = (env: Record<string, string | undefined> = process.env): Plugin => ({
  name: 'graph-rag-site-url',
  transformIndexHtml: (html) => html.replaceAll('__SITE_URL__', siteOrigin(env)),
})
