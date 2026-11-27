import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defaultClientConditions } from 'vite'
import { defineConfig } from 'vitest/config'

import { evalData, siteUrl } from './build-plugins.ts'

// Every server listens on 127.0.0.1 on one port only: PORT or --port picks it, and a busy port is an
// error (strictPort), never the next port. Several people run servers on the same machine.
const port = Number(process.env.PORT ?? 5173)
const server = { host: '127.0.0.1', port, strictPort: true }

export default defineConfig({
  // evalData serves the scoreboard, the recorded answers and the questions under /data/ (see the file).
  plugins: [react(), tailwindcss(), evalData(), siteUrl()],
  // Workspace packages resolve to their source (see tsconfig.base.json, "graph-rag-source").
  resolve: { conditions: ['graph-rag-source', ...defaultClientConditions] },
  // pnpm dev: the API runs on its own (pnpm serve), on GRAPH_RAG_API for another port.
  // changeOrigin stays false: the API writes answers only when the page's Origin matches the Host it
  // is asked on, and Vite's string shorthand would rewrite the Host to the API's port.
  server: {
    ...server,
    proxy: { '/api': { target: process.env.GRAPH_RAG_API ?? 'http://127.0.0.1:8787', changeOrigin: false } },
  },
  preview: { ...server, port: Number(process.env.PORT ?? 4173) },
  build: {
    // Three.js and the embedding worker are already chunks of their own, loaded only when used.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      onwarn(warning, warn) {
        // shadcn files start with "use client" (for Next.js); this app doesn't need it.
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return
        warn(warning)
      },
    },
  },
  // Screen tests render whole pages (and run axe): a loaded machine can take seconds.
  test: {
    name: '@graph-rag/web',
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    testTimeout: 20_000,
  },
})
