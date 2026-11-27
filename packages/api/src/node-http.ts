// Serves the API (and, for the demo, the built app) on Node's http module. Listens on 127.0.0.1
// only, on the port it is given: a busy port is an error, never the next port. The app's routes
// (@graph-rag/client, matchRoute) get index.html, so a link like /notes/per-maya-okafor opens the
// app; any other path gets index.html with status 404, as Vercel serves 404.html, so the app shows
// its 404 page and the status is real.
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import path from 'node:path'

import { matchRoute } from '@graph-rag/client'

import { MAX_BODY_BYTES } from './routes.js'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  // The Ask worker imports the ONNX runtime's .mjs as a module: a module needs a JavaScript type.
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.bin': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8',
}

async function send(res: ServerResponse, response: Response) {
  res.writeHead(response.status, Object.fromEntries(response.headers))
  res.end(Buffer.from(await response.arrayBuffer()))
}

const tooLarge = () =>
  new Response(JSON.stringify({ error: `The body is over ${MAX_BODY_BYTES} bytes.` }), {
    status: 413,
    headers: { 'content-type': 'application/json; charset=utf-8', connection: 'close' },
  })

/**
 * The request body, up to `limit` bytes, counted while it arrives (a body sent in chunks has no
 * Content-Length), or undefined when it is larger.
 */
export async function readBody(req: IncomingMessage, limit = MAX_BODY_BYTES): Promise<Buffer | undefined> {
  if (Number(req.headers['content-length'] ?? 0) > limit) return undefined
  const parts: Buffer[] = []
  let size = 0
  for await (const part of req as AsyncIterable<Buffer>) {
    size += part.length
    if (size > limit) return undefined
    parts.push(part)
  }
  return Buffer.concat(parts)
}

/** A file of the built app inside `staticDir` (never outside it), or undefined. */
export function staticFile(staticDir: string, pathname: string): string | undefined {
  const root = path.resolve(staticDir)
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return undefined
  }
  const file = path.resolve(root, `.${decoded}`)
  if (!file.startsWith(root + path.sep) && file !== root) return undefined
  return existsSync(file) && statSync(file).isFile() ? file : undefined
}

export function serveHttp(
  handler: (request: Request) => Promise<Response>,
  { host = '127.0.0.1', port = 8787, staticDir }: { host?: string; port?: number; staticDir?: string } = {},
): Server {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${host}`)
      if (url.pathname.startsWith('/api/') || url.pathname === '/api') {
        const headers = new Headers()
        for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v)
        const method = req.method ?? 'GET'
        let body: Buffer | undefined
        if (method !== 'GET' && method !== 'HEAD') {
          body = await readBody(req)
          if (!body) {
            res.on('finish', () => req.destroy())
            return await send(res, tooLarge())
          }
        }
        return await send(
          res,
          await handler(
            new Request(url, { method, headers, ...(body ? { body: new Uint8Array(body) } : {}) }),
          ),
        )
      }
      if (req.method !== 'GET' && req.method !== 'HEAD')
        return await send(
          res,
          new Response('Method not allowed.', { status: 405, headers: { allow: 'GET, HEAD' } }),
        )
      const index = staticDir && staticFile(staticDir, '/index.html')
      if (!staticDir || !index)
        return await send(
          res,
          new Response('Not found. Build the app (pnpm build) or use /api.', { status: 404 }),
        )
      const asset = staticFile(staticDir, url.pathname)
      const file = asset ?? index
      const status = asset || matchRoute(url.pathname).name !== 'not-found' ? 200 : 404
      res.writeHead(status, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' })
      if (req.method === 'HEAD') return void res.end()
      createReadStream(file).pipe(res)
    } catch (e) {
      console.error('Request failed:', (e as Error).message)
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: 'The server failed. See its log.' }))
    }
  }).listen(port, host)
}
