// The app: one router over the routes of @graph-rag/client, one demo for every screen; the product
// screens share one shell, the landing and the 404 are pages of the site.
import type { DemoOptions } from '@graph-rag/client'
import { TooltipProvider } from '@leonfpontes/atlas-ui'

import { DemoProvider } from './lib/demo'
import { RouterProvider, useRouter } from './lib/router'
import { Ask } from './pages/Ask'
import { Evaluation } from './pages/Evaluation'
import { Explore } from './pages/Explore'
import { HowItWorks } from './pages/HowItWorks'
import { Note } from './pages/Note'
import { NotFound } from './pages/NotFound'
import { Share } from './pages/Share'
import { AppShell } from './shell/AppShell'

export function App({ demo }: { demo?: DemoOptions }) {
  return (
    <RouterProvider>
      <DemoProvider options={demo}>
        <TooltipProvider>
          <Screen />
        </TooltipProvider>
      </DemoProvider>
    </RouterProvider>
  )
}

function Screen() {
  const { route, location } = useRouter()
  // The landing and the 404 are pages of the site, with its own header and footer; /share is the
  // recording stage of the share images, only with ?record (anything else there is the 404).
  if (route.name === 'how-it-works') return <HowItWorks />
  if (route.name === 'not-found') {
    if (location.pathname === '/share' && location.search.has('record')) return <Share />
    return <NotFound />
  }
  return (
    <AppShell>
      <AppScreen />
    </AppShell>
  )
}

function AppScreen() {
  const { route } = useRouter()
  switch (route.name) {
    case 'explore':
      return <Explore />
    case 'ask':
      return <Ask />
    case 'evaluation':
      return <Evaluation />
    case 'note':
      return <Note key={route.id} id={route.id} />
    default:
      return <NotFound />
  }
}
