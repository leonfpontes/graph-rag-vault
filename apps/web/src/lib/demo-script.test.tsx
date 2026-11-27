// The GIF and the video can't fall behind their sources: docs/media/graph-rag-demo.numbers.json
// (written with them by pnpm record-demo) must equal the captions the script writes today from the
// scoreboard and the recorded answer, and the WebVTT file must carry the same lines.
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { loadDemo } from '@graph-rag/client'
import { cleanup, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { REPO_ROOT } from '../../build-plugins.ts'
import { demoOptions } from '../test/demo'
import { renderAt } from '../test/render'
import { captions, GIF_MS, GIF_SCENES, sceneAt, shown, VIDEO_MS, VIDEO_SCENES } from './demo-script'
import { headline } from './headline'
import { featured } from './share'

afterEach(cleanup)

const read = (file: string) => readFileSync(path.join(REPO_ROOT, file), 'utf8')
const demo = await loadDemo(demoOptions())
const f = (await featured(demo))!
const results = demo.search({ question: f.question.id, variant: 'hybrid' }).hits.slice(0, 5).length

describe('the README GIF and video', () => {
  it('show the captions of the scoreboard and the recorded answer (pnpm record-demo when this fails)', () => {
    const recorded = JSON.parse(read('docs/media/graph-rag-demo.numbers.json')) as unknown
    expect(recorded).toEqual({
      video: captions(VIDEO_SCENES, f, demo.scoreboard, results),
      gif: captions(GIF_SCENES, f, demo.scoreboard, results),
    })
    const vtt = read('docs/media/graph-rag-demo.en.vtt')
    for (const c of captions(VIDEO_SCENES, f, demo.scoreboard, results)) expect(vtt).toContain(c.text)
  })

  it('say the real numbers: the held-out questions, the scoreboard sentence and the links walked', () => {
    const text = captions(VIDEO_SCENES, f, demo.scoreboard, results)
      .map((c) => c.text)
      .join(' ')
    expect(text).toContain(`Measured on ${demo.scoreboard.questions.total} held-out questions.`)
    expect(text).toContain(headline(demo.scoreboard)!.short)
    expect(text).toContain(`the ${f.edges.length} links the answer walked`)
  })

  it('cover the whole length with scenes, one after the other', () => {
    for (const [scenes, ms] of [
      [VIDEO_SCENES, VIDEO_MS],
      [GIF_SCENES, GIF_MS],
    ] as const) {
      expect(scenes[0]!.from).toBe(0)
      expect(scenes.at(-1)!.to).toBe(ms)
      for (let i = 1; i < scenes.length; i++) expect(scenes[i]!.from).toBe(scenes[i - 1]!.to)
    }
    expect(sceneAt(VIDEO_SCENES, 20_000).name).toBe('answer')
    const answer = sceneAt(VIDEO_SCENES, 20_000)
    expect(shown(answer, answer.from, 3, 300, 1000)).toBe(0)
    expect(shown(answer, answer.to, 3, 300, 1000)).toBe(3)
  })

  it('are recorded from /demo?record, which says when it is ready; /demo alone is the 404', async () => {
    renderAt('/demo?record')
    await waitFor(() => expect(window.__demoReady).toBe(true), { timeout: 10_000 })
    expect(document.querySelector('#stage')?.getAttribute('data-scene')).toBe('ask')
    cleanup()
    renderAt('/demo')
    expect(screen.getByRole('heading', { level: 1, name: 'No page at this address' })).toBeTruthy()
  })
})
