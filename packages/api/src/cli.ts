#!/usr/bin/env node
// pnpm demo [--port 8787]    builds everything, then serves the app and the API on 127.0.0.1
// pnpm serve [--port 8787]   the same server, rebuilding only the API
// PORT works too. A busy port stops the server with an error; it never moves to the next port.
import { existsSync } from 'node:fs'
import path from 'node:path'

import { parseServeArgs } from './args.js'
import { serveHttp } from './node-http.js'
import { createApi } from './routes.js'

/** The repository root: the nearest folder above the working directory with pnpm-workspace.yaml. */
function repoRoot(): string {
  let dir = process.cwd()
  while (!existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
    const parent = path.dirname(dir)
    if (parent === dir) throw new Error('Run this inside the graph-rag-vault repository.')
    dir = parent
  }
  return dir
}

let options
try {
  options = parseServeArgs(process.argv.slice(2), process.env)
} catch (e) {
  console.error((e as Error).message)
  process.exit(1)
}

if (options.command === 'serve') {
  const { port } = options
  const server = serveHttp(createApi({ mode: 'demo' }), {
    port,
    staticDir: path.join(repoRoot(), 'apps', 'web', 'dist'),
  })
  server.on('listening', () =>
    console.log(`graph-rag-vault · http://127.0.0.1:${port} (API at /api). Stop with Ctrl+C.`),
  )
  server.on('error', (e) => {
    console.error(`The server didn't start: ${e.message}. Pick another port: --port ${port + 1}`)
    process.exitCode = 1
  })
} else {
  console.log('Usage: pnpm demo [--port 8787]   (or PORT=8787)')
  process.exitCode = options.command ? 1 : 0
}
