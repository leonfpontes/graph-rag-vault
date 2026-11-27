import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { createApi, DEFAULT_PORT, parseServeArgs, serveHttp, staticFile } from './index.js'

const dist = mkdtempSync(path.join(tmpdir(), 'graph-rag-web-'))
mkdirSync(path.join(dist, 'assets'))
writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>graph-rag-vault</title>')
writeFileSync(path.join(dist, 'assets', 'app.js'), 'console.log(1)')
const server = serveHttp(createApi({ mode: 'demo' }), { port: 0, staticDir: dist })
await new Promise((resolve) => server.once('listening', resolve))
const port = (server.address() as AddressInfo).port
const base = `http://127.0.0.1:${port}`
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
  rmSync(dist, { recursive: true, force: true })
})

describe('API', () => {
  const api = createApi()

  it('answers the meta endpoint, local by default', async () => {
    const res = await api(new Request('http://x/api/meta'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(await res.json()).toEqual({ name: 'graph-rag-vault', mode: 'local' })
  })

  it('answers an unknown endpoint with 404, without echoing the path', async () => {
    const res = await api(new Request('http://x/api/%3Cscript%3E'))
    expect(res.status).toBe(404)
    expect(await res.text()).not.toMatch(/script/i)
  })

  it('is read-only: other methods get 405 with Allow', async () => {
    const res = await api(new Request('http://x/api/meta', { method: 'POST', body: '{}' }))
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('GET, HEAD')
  })
})

describe('local server', () => {
  it('serves the API and the built app on one port, with the app for unknown routes', async () => {
    expect(await (await fetch(`${base}/api/meta`)).json()).toEqual({ name: 'graph-rag-vault', mode: 'demo' })
    const asset = await fetch(`${base}/assets/app.js`)
    expect(asset.headers.get('content-type')).toContain('javascript')
    expect(await (await fetch(`${base}/notes/maya-okafor`)).text()).toContain('graph-rag-vault')
    const head = await fetch(`${base}/`, { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(await head.text()).toBe('')
  })

  it('never serves a file outside the app folder', async () => {
    expect(await (await fetch(`${base}/%2e%2e/%2e%2e/etc/passwd`)).text()).toContain('graph-rag-vault')
    expect(staticFile(dist, '/../../etc/passwd')).toBeUndefined() // a raw path that climbs out
    expect(staticFile(dist, '/assets/../index.html')).toBe(path.join(dist, 'index.html'))
    expect(staticFile(dist, '/%E0%A4%A')).toBeUndefined() // broken escape
    expect(staticFile(path.join(dist, 'missing'), '/x')).toBeUndefined()
  })

  it('refuses writes to the app and to the API', async () => {
    expect((await fetch(`${base}/`, { method: 'POST' })).status).toBe(405)
    expect((await fetch(`${base}/api/meta`, { method: 'DELETE' })).status).toBe(405)
  })

  it('without a built app, says how to build it', async () => {
    const bare = serveHttp(createApi(), { port: 0 })
    await new Promise((resolve) => bare.once('listening', resolve))
    const res = await fetch(`http://127.0.0.1:${(bare.address() as AddressInfo).port}/`)
    expect(res.status).toBe(404)
    expect(await res.text()).toContain('pnpm build')
    await new Promise((resolve) => bare.close(resolve))
  })

  it('fails on a busy port instead of moving to another one', async () => {
    const second = serveHttp(createApi(), { port })
    const error = await new Promise<NodeJS.ErrnoException>((resolve) => second.once('error', resolve))
    expect(error.code).toBe('EADDRINUSE')
  })

  it('reports a failing handler as 500 without the error text', async () => {
    const broken = serveHttp(
      async () => {
        throw new Error('secret detail')
      },
      { port: 0 },
    )
    await new Promise((resolve) => broken.once('listening', resolve))
    const errors: unknown[] = []
    const original = console.error
    console.error = (...args: unknown[]) => void errors.push(args)
    try {
      const res = await fetch(`http://127.0.0.1:${(broken.address() as AddressInfo).port}/api/meta`)
      expect(res.status).toBe(500)
      expect(await res.text()).not.toContain('secret detail')
      expect(errors).toHaveLength(1)
    } finally {
      console.error = original
      await new Promise((resolve) => broken.close(resolve))
    }
  })
})

describe('server options', () => {
  it('takes --port, then PORT, then the default, and drops a stray --', () => {
    expect(parseServeArgs(['serve'])).toEqual({ command: 'serve', port: DEFAULT_PORT })
    expect(parseServeArgs(['serve'], { PORT: '9001' }).port).toBe(9001)
    expect(parseServeArgs(['serve', '--', '--port', '8891'], { PORT: '9001' }).port).toBe(8891)
    expect(parseServeArgs([]).command).toBeUndefined()
  })

  it('refuses a port that is not a number from 1 to 65535', () => {
    for (const bad of ['0', '65536', '80a', '-1', '8.5', ''])
      expect(() => parseServeArgs(['serve', `--port=${bad}`]), bad).toThrow(/1 to 65535/)
  })
})
