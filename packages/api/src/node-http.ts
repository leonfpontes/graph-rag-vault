// Serves the API (and, for the demo, the built app) on Node's http module. Listens on 127.0.0.1
// only, on the port it is given: a busy port is an error, never the next port. Unknown app routes
// get index.html, so a link like /notes/maya-okafor opens the app.
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer, type Server, type ServerResponse } from 'node:http'
import path from 'node:path'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
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

/** A file of the built app inside `staticDir` (never outside it), or its index.html. */
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
  if (existsSync(file) && statSync(file).isFile()) return file
  const index = path.join(root, 'index.html')
  return existsSync(index) ? index : undefined
}

export function serveHttp(
  handler: (request: Request) => Promise<Response>,
  { host = '127.0.0.1', port = 8787, staticDir }: { host?: string; port?: number; staticDir?: string } = {},
): Server {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${host}`)
      if (url.pathname.startsWith('/api/') || url.pathname === '/api') {
        // Read-only API: no request body is ever read.
        const headers = new Headers()
        for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v)
        return await send(res, await handler(new Request(url, { method: req.method, headers })))
      }
      if (req.method !== 'GET' && req.method !== 'HEAD')
        return await send(
          res,
          new Response('Method not allowed.', { status: 405, headers: { allow: 'GET, HEAD' } }),
        )
      const file = staticDir ? staticFile(staticDir, url.pathname) : undefined
      if (!file)
        return await send(
          res,
          new Response('Not found. Build the app (pnpm build) or use /api.', { status: 404 }),
        )
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' })
      if (req.method === 'HEAD') return void res.end()
      createReadStream(file).pipe(res)
    } catch (e) {
      console.error('Request failed:', (e as Error).message)
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: 'The server failed. See its log.' }))
    }
  }).listen(port, host)
}
