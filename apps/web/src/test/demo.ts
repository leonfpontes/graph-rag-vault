// The demo as the screens load it, in tests: the real index file and evaluation files from the
// repository (the same bytes the build serves), through a stubbed fetch. The API answers as the
// public site (no API), the local demo (no key) or local mode (with a key), as a test asks.
import { readFileSync } from 'node:fs'
import path from 'node:path'

import type { DemoOptions } from '@graph-rag/client'

import { evalDataFiles, REPO_ROOT } from '../../build-plugins.ts'

export const INDEX_BYTES = readFileSync(path.join(REPO_ROOT, 'apps/web/public/data/index.bin'))
const FILES = evalDataFiles()

export interface DemoStub {
  mode?: 'static' | 'demo' | 'local'
  /** Replace a data file's text (latest.json, answers.json, questions.json). */
  files?: Record<string, string>
  /** The index file's HTTP status (404 to test the error state). */
  indexStatus?: number
  /** Never answer the index request (the loading state). */
  hangIndex?: boolean
  /** POST /api/answer in local mode. */
  answer?: (body: { question: string; variant?: string }) => Response | Promise<Response>
}

export function demoOptions(stub: DemoStub = {}): DemoOptions & { calls: string[] } {
  const calls: string[] = []
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const doFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
    calls.push(url)
    if (url === '/api/meta')
      return stub.mode && stub.mode !== 'static'
        ? json({ name: 'graph-rag-vault', mode: stub.mode })
        : new Response('', { status: 404 })
    if (url === '/api/answer' && stub.answer)
      return stub.answer(JSON.parse(String(init?.body)) as { question: string })
    if (url === '/data/index.bin') {
      if (stub.hangIndex) return new Promise<Response>(() => {})
      if (stub.indexStatus && stub.indexStatus !== 200) return new Response('', { status: stub.indexStatus })
      return new Response(new Uint8Array(INDEX_BYTES), {
        headers: { 'content-length': String(INDEX_BYTES.byteLength) },
      })
    }
    const name = /^\/data\/([a-z]+\.json)$/.exec(url)?.[1]
    const text = name && (stub.files?.[name] ?? FILES[name])
    if (text) return new Response(text, { headers: { 'content-type': 'application/json' } })
    return new Response('', { status: 404 })
  }) as typeof fetch
  return { fetch: doFetch, metaTimeoutMs: 200, calls }
}

/** A data file as the build serves it (latest.json, answers.json, questions.json). */
export const evalFile = (name: string) => FILES[name]!

/** latest.json, parsed (for tests that build a scoreboard of their own). */
export const latest = () => JSON.parse(FILES['latest.json']!) as Record<string, unknown>
