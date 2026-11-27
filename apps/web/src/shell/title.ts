import { useEffect } from 'react'

const SITE = 'graph-rag-vault'

/** "Explore · graph-rag-vault"; the home page keeps the full product name. */
export function usePageTitle(title: string | undefined) {
  useEffect(() => {
    document.title = title ? `${title} · ${SITE}` : 'Graph RAG over a Markdown vault'
  }, [title])
}
