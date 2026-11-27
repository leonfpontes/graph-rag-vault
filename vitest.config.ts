import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

const src = (path: string) => fileURLToPath(new URL(path, import.meta.url))

// One run for the whole monorepo. Workspace packages resolve to their source, so tests run on a
// clean clone before any build (TypeScript does the same with the "graph-rag-source" condition).
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@graph-rag\/vault\/node$/, replacement: src('./packages/vault/src/node.ts') },
      { find: /^@graph-rag\/vault$/, replacement: src('./packages/vault/src/index.ts') },
      { find: /^@graph-rag\/index$/, replacement: src('./packages/index/src/index.ts') },
      { find: /^@graph-rag\/search$/, replacement: src('./packages/search/src/index.ts') },
      { find: /^@graph-rag\/embeddings$/, replacement: src('./packages/embeddings/src/index.ts') },
      { find: /^@graph-rag\/answer$/, replacement: src('./packages/answer/src/index.ts') },
      { find: /^@graph-rag\/api$/, replacement: src('./packages/api/src/index.ts') },
      { find: /^@graph-rag\/evals$/, replacement: src('./evals/src/index.ts') },
    ],
  },
  test: {
    projects: [
      { extends: true, test: { name: 'repo', environment: 'node', include: ['tests/**/*.test.ts'] } },
      { extends: true, test: { name: '@graph-rag/vault', root: 'packages/vault', environment: 'node' } },
      { extends: true, test: { name: '@graph-rag/index', root: 'packages/index', environment: 'node' } },
      // The search also runs in the browser: its tests run in jsdom, with no Node globals to lean on.
      { extends: true, test: { name: '@graph-rag/search', root: 'packages/search', environment: 'jsdom' } },
      // The embedder runs in the Ask worker too; its tests use a fake model (no network).
      {
        extends: true,
        test: { name: '@graph-rag/embeddings', root: 'packages/embeddings', environment: 'node' },
      },
      { extends: true, test: { name: '@graph-rag/answer', root: 'packages/answer', environment: 'node' } },
      { extends: true, test: { name: '@graph-rag/api', root: 'packages/api', environment: 'node' } },
      { extends: true, test: { name: '@graph-rag/evals', root: 'evals', environment: 'node' } },
      'apps/web',
    ],
    coverage: {
      provider: 'v8',
      include: ['**/src/**'],
      exclude: [
        '**/*.test.*',
        '**/src/test/**',
        'apps/web/src/main.tsx',
        // Command-line entry points: argv to tested functions. The end-to-end tests start the server.
        'packages/api/src/cli.ts',
      ],
      // Floors that only go up: packages and rules 80%, screens 60%.
      thresholds: {
        'packages/**/src/**': { lines: 80, functions: 80, branches: 75 },
        'evals/src/**': { lines: 80, functions: 80, branches: 75 },
        'apps/web/src/**': { lines: 60 },
      },
    },
  },
})
