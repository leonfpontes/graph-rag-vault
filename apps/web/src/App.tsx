import { Badge } from '@leonfpontes/atlas-ui'
import { SEARCH_VARIANTS } from '@graph-rag/search'

// The app shell until the screen stories (Explore, Ask, Note, Evaluation) land.
export function App() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-4 px-6 py-16">
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
      <p className="text-sm text-muted-foreground">In development: the screens come next.</p>
    </main>
  )
}
