// The API as a fetch handler (Request → Response): the same code runs in the local Node server and
// in tests, with no framework. Read-only so far, so every route is GET (HEAD too).

export type ApiMode = 'local' | 'demo'

export interface ApiOptions {
  /** `demo` never calls a model (no key); `local` may, with the person's own key. */
  mode?: ApiMode
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  })

export function createApi({ mode = 'local' }: ApiOptions = {}) {
  return async function handle(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (request.method !== 'GET' && request.method !== 'HEAD')
      return json(
        405,
        { error: `${request.method} is not allowed here. The API is read-only.` },
        { allow: 'GET, HEAD' },
      )
    if (pathname === '/api/meta') return json(200, { name: 'graph-rag-vault', mode })
    // Never echo the path back: it is input.
    return json(404, { error: 'No such endpoint. See docs/ARCHITECTURE.md for the API.' })
  }
}
