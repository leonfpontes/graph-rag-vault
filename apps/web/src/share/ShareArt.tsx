// One composition for the README cover, the social preview and the OG image (docs/DESIGN.md, Share
// images): the mark, the question, the answer with its citations, the lit path, and the scoreboard
// sentence on one line at the bottom. Only that line changes with the result. Drawn at its final
// pixel size; scripts/share-images.mjs takes a screenshot of each one from /share?record.
import { Mark } from '../lib/icons'
import type { Featured } from '../lib/share'
import { sentenceCites } from '../lib/share'
import type { Headline } from '../lib/headline'
import { PathFigure } from './PathFigure'

/** What the image says, for its alt text: the same words as the picture. */
export function shareAlt(f: Featured, h: Headline): string {
  return `graph-rag-vault. Question: ${f.question.question} Answer, with a citation on every sentence: ${f.sentences
    .map((s) => s.text)
    .join(
      ' ',
    )} The path in the graph: ${f.edges.length} typed links. ${h.short}${h.subShort ? ` ${h.subShort}` : ''}`
}

export function ShareArt({
  featured: f,
  sentence,
  width,
  height,
  example,
  id,
}: {
  featured: Featured
  sentence: Headline
  width: number
  height: number
  /** The scoreboard is a rehearsal: the dashed "Example numbers" tag. */
  example: boolean
  id?: string
}) {
  return (
    <div
      id={id}
      role="img"
      aria-label={shareAlt(f, sentence)}
      className="sa"
      data-art=""
      data-outcome={sentence.outcome}
      style={{ ['--s' as string]: width / 1280, width, height }}
    >
      <p className="sa-brand" aria-hidden="true">
        <Mark size={Math.round(34 * (width / 1280))} />
        graph-rag-vault
        <span className="sa-tag">Every sentence cites its note</span>
      </p>
      <div className="sa-main" aria-hidden="true">
        <div className="sa-qa">
          <p className="sa-q">{f.question.question}</p>
          <p className="sa-a">
            {f.sentences.map((s, i) => (
              <span key={i}>
                {i > 0 && ' '}
                {s.text}
                {sentenceCites(s, f.cites).map((n) => (
                  <span key={n} className="sa-cite">
                    {n}
                  </span>
                ))}
              </span>
            ))}
          </p>
        </div>
        <div className="sa-g">
          <PathFigure nodes={f.nodes} edges={f.edges} />
        </div>
      </div>
      <p className="sa-foot" aria-hidden="true">
        <span data-sentence="">
          {sentence.short}
          {sentence.subShort && <span className="sa-sub">{sentence.subShort}</span>}
        </span>
        {example && <span className="sa-ex">Example numbers</span>}
      </p>
    </div>
  )
}
