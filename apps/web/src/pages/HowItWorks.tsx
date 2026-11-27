// The landing page comes with its own story (How it works); until then, the product in three lines
// and the way into the screens.
import { paths } from '@graph-rag/client'
import { Badge, Button } from '@leonfpontes/atlas-ui'
import { SEARCH_VARIANTS } from '@graph-rag/search'

import { Link } from '../lib/router'
import { usePageTitle } from '../shell/title'

export function HowItWorks() {
  usePageTitle(undefined)
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Graph RAG over a Markdown vault</h1>
      <p className="text-muted-foreground">
        Hybrid search over a knowledge graph of notes, answers that cite the note behind every sentence, and
        an evaluation that measures what the graph adds over vectors alone.
      </p>
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <span>Search variants under evaluation:</span>
        {SEARCH_VARIANTS.map((variant) => (
          <Badge key={variant} variant="outline" className="font-mono">
            {variant}
          </Badge>
        ))}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link href={paths.explore()}>Explore the graph</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href={paths.ask()}>Ask the vault</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href={paths.evaluation()}>See the evaluation</Link>
        </Button>
      </div>
    </div>
  )
}
