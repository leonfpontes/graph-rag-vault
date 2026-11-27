// The app's routes, in one place: the app's router, the local server and vercel.json all follow this
// table, so a link that opens in the app opens on both servers, and anything else is a real 404.
// State that can be shared (the question asked, the note in focus) goes in the query string.

/** A note id: lowercase letters, digits and hyphens (`per-maya-okafor`), as vercel.json matches it. */
export const NOTE_ID = /^[a-z0-9][a-z0-9-]*$/

export type AppRoute =
  | { name: 'how-it-works' }
  | { name: 'explore' }
  | { name: 'ask' }
  | { name: 'evaluation' }
  | { name: 'note'; id: string }
  | { name: 'not-found' }

/** The fixed paths of the app; notes are `/notes/<id>`. */
export const APP_PATHS = {
  'how-it-works': '/',
  explore: '/explore',
  ask: '/ask',
  evaluation: '/evaluation',
} as const

/** The route of a path (no query string). One trailing slash is ignored. */
export function matchRoute(pathname: string): AppRoute {
  const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
  for (const [name, fixed] of Object.entries(APP_PATHS)) if (path === fixed) return { name } as AppRoute
  const note = /^\/notes\/([^/]+)$/.exec(path)
  if (note && NOTE_ID.test(note[1]!)) return { name: 'note', id: note[1]! }
  return { name: 'not-found' }
}

/** Links into the app. */
export const paths = {
  howItWorks: () => APP_PATHS['how-it-works'],
  /** Explore, optionally with a note selected. */
  explore: (focus?: string) =>
    focus ? `${APP_PATHS.explore}?focus=${encodeURIComponent(focus)}` : APP_PATHS.explore,
  /** Ask, optionally with a question: a recorded question's id (`q-011`) or any text. */
  ask: (question?: string) =>
    question ? `${APP_PATHS.ask}?q=${encodeURIComponent(question)}` : APP_PATHS.ask,
  evaluation: () => APP_PATHS.evaluation,
  note: (id: string) => {
    if (!NOTE_ID.test(id)) throw new Error(`"${id}" is not a note id.`)
    return `/notes/${id}`
  },
}
