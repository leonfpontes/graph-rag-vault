#!/usr/bin/env node
// pnpm demo [--port 8787] [--no-key]   builds everything, then serves the app and the API on 127.0.0.1
// pnpm serve [--port 8787] [--no-key]  the same server, rebuilding only the API
// PORT works too. A busy port stops the server with an error; it never moves to the next port.
// With ANTHROPIC_API_KEY (in the environment or in .env.local) new questions get written answers;
// without it, or with --no-key, the server replays the recorded answers like the public site.
// The key is never printed.
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

import { answerQuestion, createAnthropicProvider } from '@graph-rag/answer'
import { decodeIndex } from '@graph-rag/search'

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
  const { port, noKey } = options
  const root = repoRoot()
  const index = decodeIndex(readFileSync(path.join(root, 'apps', 'web', 'public', 'data', 'index.bin')))

  const envFile = path.join(root, '.env.local')
  if (!noKey && !process.env.ANTHROPIC_API_KEY && existsSync(envFile)) process.loadEnvFile(envFile)
  const apiKey = noKey ? '' : (process.env.ANTHROPIC_API_KEY ?? '')
  const provider = apiKey ? createAnthropicProvider({ apiKey }) : undefined

  // The embedding model (~25 MB) loads on the first question with no recorded vector, not at start.
  let embedder: Promise<{ embedQuery(q: string): Promise<Float32Array> }> | undefined
  const embedQuery = async (question: string) => {
    embedder ??= import('@graph-rag/embeddings/node').then(({ createEmbedder }) =>
      createEmbedder({
        cacheDir:
          process.env.GRAPH_RAG_MODEL_CACHE ?? path.join(homedir(), '.cache', 'graph-rag-vault', 'models'),
      }),
    )
    return (await embedder).embedQuery(question)
  }

  const server = serveHttp(
    createApi({
      index,
      embedQuery,
      ...(provider
        ? { answer: (question, passages) => answerQuestion({ question, passages, provider }) }
        : {}),
    }),
    { port, staticDir: path.join(root, 'apps', 'web', 'dist') },
  )
  server.on('listening', () => {
    console.log(`graph-rag-vault · http://127.0.0.1:${port} (API at /api). Stop with Ctrl+C.`)
    console.log(
      provider
        ? 'Answers: new questions are answered with your Anthropic key (each costs a fraction of a cent).'
        : `Answers: recorded only${noKey ? ' (--no-key)' : ''}. For new ones, put ANTHROPIC_API_KEY in .env.local.`,
    )
  })
  server.on('error', (e) => {
    console.error(`The server didn't start: ${e.message}. Pick another port: --port ${port + 1}`)
    process.exitCode = 1
  })
} else {
  console.log('Usage: pnpm demo [--port 8787] [--no-key]   (or PORT=8787)')
  process.exitCode = options.command ? 1 : 0
}
