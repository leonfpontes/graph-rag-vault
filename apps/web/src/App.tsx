// The app: one router over the routes of @graph-rag/client, one demo for every screen, one shell.
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
import { AppShell } from './shell/AppShell'

export function App({ demo }: { demo?: DemoOptions }) {
  return (
    <RouterProvider>
      <DemoProvider options={demo}>
        <TooltipProvider>
          <AppShell>
            <Screen />
          </AppShell>
        </TooltipProvider>
      </DemoProvider>
    </RouterProvider>
  )
}

function Screen() {
  const { route } = useRouter()
  switch (route.name) {
    case 'how-it-works':
      return <HowItWorks />
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
