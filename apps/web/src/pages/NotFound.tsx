// Any address outside the routes: the site's 404, with the mark and three ways on
// (docs/DESIGN.md; the server and vercel.json answer these addresses with HTTP 404).
import { paths } from '@graph-rag/client'
import { Button } from '@leonfpontes/atlas-ui'

import { Link } from '../lib/router'
import { Brand, WRAP } from '../shell/Site'
import { usePageTitle } from '../shell/title'

export function NotFound() {
  usePageTitle('Page not found')
  return (
    <div className="min-h-screen">
      <main id="main" className={WRAP}>
        <div className="grid min-h-[calc(100vh-160px)] max-w-[620px] content-center justify-items-start gap-4 py-12">
          <Brand />
          <p className="n text-muted-foreground">404</p>
          <h1 className="text-[32px] leading-tight font-semibold tracking-[-0.02em]">
            No page at this address
          </h1>
          <p className="text-base leading-[1.6] text-muted-foreground">
            Search found nothing here either: the link may be old, or the note was renamed. Try the graph, or
            ask the vault.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button asChild>
              <Link href={paths.explore()}>Explore the graph</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={paths.ask()}>Ask the vault</Link>
            </Button>
            <Button asChild variant="ghost">
              <Link href={paths.howItWorks()}>How it works</Link>
            </Button>
          </div>
        </div>
      </main>
    </div>
  )
}
