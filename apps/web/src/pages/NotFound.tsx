// Any path outside the routes (the 404 page gets its own design with the landing).
import { paths } from '@graph-rag/client'
import { Button } from '@leonfpontes/atlas-ui'

import { Link } from '../lib/router'
import { usePageTitle } from '../shell/title'

export function NotFound() {
  usePageTitle('Page not found')
  return (
    <div className="mx-auto grid max-w-3xl justify-items-start gap-4 px-6 py-16">
      <h1 className="text-2xl font-semibold">This page is not in the vault</h1>
      <p className="text-muted-foreground">
        The address has no page. Explore the graph or ask a question instead.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link href={paths.explore()}>Explore the graph</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href={paths.ask()}>Ask the vault</Link>
        </Button>
      </div>
    </div>
  )
}
