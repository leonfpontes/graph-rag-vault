import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defaultClientConditions } from 'vite'
import { defineConfig } from 'vitest/config'

// Every server listens on 127.0.0.1 on one port only: PORT or --port picks it, and a busy port is an
// error (strictPort), never the next port. Several people run servers on the same machine.
const port = Number(process.env.PORT ?? 5173)
const server = { host: '127.0.0.1', port, strictPort: true }

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Workspace packages resolve to their source (see tsconfig.base.json, "graph-rag-source").
  resolve: { conditions: ['graph-rag-source', ...defaultClientConditions] },
  // pnpm dev: the API runs on its own (pnpm serve), on GRAPH_RAG_API for another port.
  server: { ...server, proxy: { '/api': process.env.GRAPH_RAG_API ?? 'http://127.0.0.1:8787' } },
  preview: { ...server, port: Number(process.env.PORT ?? 4173) },
  build: {
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
