// The README is the first page people read: its scoreboard is written from evals/results/latest.json,
// never by hand, its quickstart is the landing page's, and its cover, GIF and video exist. This fails
// when the README falls behind the scoreboard; `pnpm readme` (UPDATE_README=1) rewrites the block.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { QUICKSTART_COMMANDS, type RecordedQuestion, type Scoreboard } from '@graph-rag/client'
import { describe, expect, it } from 'vitest'

import { questionsJson, REPO_ROOT } from '../../build-plugins.ts'
import { END, scoreboardBlock, searchLine, START, withScoreboard } from './readme'

const root = REPO_ROOT
const at = (p: string) => path.join(root, p)
const file = at('README.md')
const sb = JSON.parse(readFileSync(at('evals/results/latest.json'), 'utf8')) as Scoreboard
const questions = JSON.parse(
  questionsJson(readFileSync(at('evals/questions.yaml'), 'utf8')),
) as RecordedQuestion[]
const tuned = questions.filter((q) => q.split !== 'test').length

// The block is written as Prettier formats it (pnpm format:check keeps the README so).
const expected = (readme: string) => withScoreboard(readme, scoreboardBlock(sb, tuned))

describe('README', () => {
  it('has the scoreboard of latest.json, up to date (pnpm readme when this fails)', () => {
    const readme = readFileSync(file, 'utf8')
    expect(readme).toContain(START)
    expect(readme).toContain(END)
    const fresh = expected(readme)
    if (process.env.UPDATE_README) writeFileSync(file, fresh)
    else expect(readme).toBe(fresh)
  })

  it('says the search verdict with the tie rule, and what the graph adds to vectors', () => {
    expect(searchLine(sb)).toBe(
      'hybrid and graph only tie (2 points apart, under the 5-point tie line). Against vectors only, hybrid is +18 points, most of it on multi-hop questions (79% against 50%); against the strongest embedding model we tried for vectors only (arctic-embed-xs, 78%), +13.',
    )
    const win = {
      ...sb,
      verdict: { ...sb.verdict, outcomeVsBestOther: 'win' as const, pointsVsBestOther: 7 },
    }
    expect(searchLine(win)).toMatch(/^hybrid is 7 points above graph only\./)
    const loss = {
      ...sb,
      verdict: { ...sb.verdict, outcomeVsBestOther: 'loss' as const, pointsVsBestOther: -9 },
    }
    expect(searchLine(loss)).toMatch(/^graph only is 9 points above hybrid\./)
    expect(searchLine(loss)).not.toMatch(/\b(wins?|beats?|better)\b/)
  })

  it('has the problem, the diagram, the quickstart of the landing page and the judge check', () => {
    const readme = readFileSync(file, 'utf8')
    expect(readme).toMatch(/^## The problem$/m)
    expect(readme).toMatch(/```mermaid\nflowchart/)
    const quick = /## Quickstart[\s\S]*?```bash\n([\s\S]*?)```/.exec(readme)![1]!.trim().split('\n')
    expect(quick).toEqual([...QUICKSTART_COMMANDS])
    expect(readme).toContain('Checked by a person (Leonardo Pontes)')
    expect(readme).toContain('Agreement between two automatic judges')
  })

  it('shows the cover in the reader’s theme, the GIF and the video, and they exist', () => {
    const readme = readFileSync(file, 'utf8')
    expect(readme).toContain('<source media="(prefers-color-scheme: dark)" srcset="docs/cover-dark.png">')
    expect(readme).toContain('src="docs/cover-light.png"')
    for (const f of [
      'docs/cover-light.png',
      'docs/cover-dark.png',
      'docs/media/graph-rag-demo.gif',
      'docs/media/graph-rag-demo.mp4',
      'docs/media/graph-rag-demo.en.vtt',
    ]) {
      expect(readme, f).toContain(f)
      expect(existsSync(at(f)), f).toBe(true)
    }
  })

  it('ends with the footer of Atlas and Crew', () => {
    const readme = readFileSync(file, 'utf8').trimEnd()
    expect(readme).toMatch(
      /## License\n\n\[MIT\]\(LICENSE\)\. Built by \[Leonardo Pontes\]\(https:\/\/www\.linkedin\.com\/in\/leonardo-fonseca-pontes-465740103\/\)\.\nTarnwick Cycles and everyone in its vault are fictional\.$/,
    )
  })
})
