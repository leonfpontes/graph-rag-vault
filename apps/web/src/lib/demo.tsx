// The demo loads once for the whole app (loadDemo from @graph-rag/client): the index file, the
// scoreboard and the questions. Every number on a screen comes from here, never from the API and
// never typed into a component. While the index downloads, the screens show its progress in MB.
import { DATA_FILES, loadDemo, type Demo, type DemoOptions } from '@graph-rag/client'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

export interface Download {
  loaded: number
  /** Bytes, when the server says (Content-Length). */
  total?: number
}

export type DemoState =
  | { status: 'loading'; download: Download }
  | { status: 'error'; error: Error }
  | { status: 'ready'; demo: Demo }

interface DemoValue {
  state: DemoState
  retry(): void
}

const DemoContext = createContext<DemoValue | null>(null)

/** A fetch that reports the bytes of the index file as they arrive. */
export function progressFetch(base: typeof fetch, onProgress: (d: Download) => void): typeof fetch {
  return async (input, init) => {
    const res = await base(input, init)
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!res.ok || !res.body || !url.endsWith(DATA_FILES.index)) return res
    const total = Number(res.headers.get('content-length')) || undefined
    let loaded = 0
    onProgress({ loaded, total })
    const counted = res.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          loaded += chunk.byteLength
          onProgress({ loaded, total })
          controller.enqueue(chunk)
        },
      }),
    )
    return new Response(counted, { status: res.status, statusText: res.statusText, headers: res.headers })
  }
}

export function DemoProvider({
  children,
  options,
}: {
  children: ReactNode
  /** Tests pass their own fetch. */
  options?: DemoOptions
}) {
  const [state, setState] = useState<DemoState>({ status: 'loading', download: { loaded: 0 } })
  const [attempt, setAttempt] = useState(0)
  const optionsRef = useRef(options)
  useEffect(() => {
    let live = true
    setState({ status: 'loading', download: { loaded: 0 } })
    const base = optionsRef.current?.fetch ?? globalThis.fetch.bind(globalThis)
    loadDemo({
      ...optionsRef.current,
      fetch: progressFetch(base, (download) => live && setState({ status: 'loading', download })),
    }).then(
      (demo) => live && setState({ status: 'ready', demo }),
      (error: unknown) =>
        live &&
        setState({ status: 'error', error: error instanceof Error ? error : new Error(String(error)) }),
    )
    return () => {
      live = false
    }
  }, [attempt])
  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  return <DemoContext value={{ state, retry }}>{children}</DemoContext>
}

export function useDemo(): DemoValue {
  const value = useContext(DemoContext)
  if (!value) throw new Error('useDemo needs a DemoProvider above it.')
  return value
}
