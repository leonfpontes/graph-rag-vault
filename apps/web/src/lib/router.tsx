// A small router on the History API: the routes live in @graph-rag/client (routes.ts), shared with
// the local server and vercel.json. Shareable state (the question, the note in focus, the view) goes
// in the query string, so every screen state has an address.
import { matchRoute, type AppRoute } from '@graph-rag/client'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export interface Location {
  pathname: string
  search: URLSearchParams
  hash: string
}

interface RouterValue {
  location: Location
  route: AppRoute
  /** Go to an app address; `replace` keeps the history entry (for state that changes as you type). */
  navigate(to: string, options?: { replace?: boolean }): void
}

const read = (): Location => ({
  pathname: window.location.pathname,
  search: new URLSearchParams(window.location.search),
  hash: window.location.hash,
})

const RouterContext = createContext<RouterValue | null>(null)

export function RouterProvider({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState(read)
  useEffect(() => {
    const onPop = () => setLocation(read())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const navigate = useCallback((to: string, { replace = false } = {}) => {
    const url = new URL(to, window.location.href)
    const next = url.pathname + url.search + url.hash
    if (next === window.location.pathname + window.location.search + window.location.hash) return
    window.history[replace ? 'replaceState' : 'pushState'](null, '', next)
    setLocation(read())
    // A new page starts at the top, unless the address points into it.
    if (!replace && !url.hash && url.pathname !== window.location.pathname) window.scrollTo(0, 0)
  }, [])
  const value = useMemo(
    () => ({ location, route: matchRoute(location.pathname), navigate }),
    [location, navigate],
  )
  return <RouterContext value={value}>{children}</RouterContext>
}

export function useRouter(): RouterValue {
  const value = useContext(RouterContext)
  if (!value) throw new Error('useRouter needs a RouterProvider above it.')
  return value
}

/** Sets or removes query parameters on the current address and returns it. */
export function withParams(location: Location, changes: Record<string, string | null | undefined>): string {
  const search = new URLSearchParams(location.search)
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === undefined) search.delete(key)
    else search.set(key, value)
  }
  const query = search.toString()
  return location.pathname + (query ? `?${query}` : '')
}

/** How a link reads inside text or a list: the primary color, underlined. */
export const LINK_CLASS =
  'text-primary underline decoration-1 underline-offset-4 hover:decoration-2 focus-visible:rounded-xs focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none'

/** A plain link that the app follows without reloading (modified clicks open as usual). */
export function Link({
  href,
  replace,
  onClick,
  ...props
}: React.ComponentProps<'a'> & { href: string; replace?: boolean }) {
  const { navigate } = useRouter()
  return (
    <a
      href={href}
      onClick={(event) => {
        onClick?.(event)
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          props.target === '_blank' ||
          !href.startsWith('/')
        )
          return
        event.preventDefault()
        navigate(href, { replace })
      }}
      {...props}
    />
  )
}
