import { describe, expect, it } from 'vitest'

import { CHUNK_TOKENS, chunkNote, estimateTokens, plainText } from './index.js'

const words = (n: number, word = 'gear') => Array.from({ length: n }, () => word).join(' ')

describe('plainText', () => {
  it('turns wikilinks into words and drops Markdown marks', () => {
    expect(plainText('Ask [[maya-okafor|Maya]] about [[dec-0042]].')).toBe('Ask Maya about dec 0042.')
    expect(plainText('See [[maya-okafor]]', (id) => (id === 'maya-okafor' ? 'Maya Okafor' : undefined))).toBe(
      'See Maya Okafor',
    )
    expect(plainText('[[gravel-frame#Budget|the budget]]')).toBe('the budget')
    expect(plainText('- **Bold** and `code` with [a link](https://x.test)\n> quoted')).toBe(
      'Bold and code with a link\nquoted',
    )
  })
})

describe('chunkNote', () => {
  const note = (body: string) => ({ id: 'gravel-frame', title: 'Gravel frame', body })

  it('follows the headings, with title and heading at the start of the embedded text', () => {
    const chunks = chunkNote(
      note(
        '# Gravel frame\n\nIntro by [[maya-okafor|Maya]].\n\n## Decision\n\nSteel, not carbon.\n\nCost first.',
      ),
    )
    expect(chunks.map((c) => [c.id, c.ord, c.heading, c.text])).toEqual([
      ['gravel-frame#0', 0, null, 'Intro by [[maya-okafor|Maya]].'],
      ['gravel-frame#1', 1, 'Decision', 'Steel, not carbon.\n\nCost first.'],
    ])
    expect(chunks[0]!.embedText).toBe('Gravel frame\n\nIntro by Maya.')
    expect(chunks[1]!.embedText).toBe('Gravel frame › Decision\n\nSteel, not carbon.\n\nCost first.')
    expect(chunks[1]!.tokens).toBe(estimateTokens(chunks[1]!.embedText))
  })

  it('keeps every chunk within the budget, splitting long paragraphs by sentence and long sentences by word', () => {
    const body = [words(120), words(120, 'brake'), `${words(30)}. ${words(400, 'spoke')}.`].join('\n\n')
    const chunks = chunkNote(note(body))
    expect(chunks.length).toBeGreaterThan(3)
    for (const c of chunks) expect(c.tokens).toBeLessThanOrEqual(CHUNK_TOKENS)
    // nothing lost, nothing repeated: no overlap
    const all = chunks.map((c) => c.text).join(' ')
    expect(all.split(/\s+/).filter((w) => w.startsWith('spoke')).length).toBe(400)
    expect(all.split(/\s+/).filter((w) => w === 'brake').length).toBe(120)
  })

  it('packs short paragraphs together up to the budget', () => {
    const chunks = chunkNote(note(Array.from({ length: 6 }, () => words(20)).join('\n\n')))
    expect(chunks).toHaveLength(1)
    expect(chunks[0]!.text.split('\n\n')).toHaveLength(6)
  })

  it('takes another token counter and budget', () => {
    const chars = (t: string) => t.length
    const chunks = chunkNote(note('aaaa bbbb cccc dddd eeee ffff gggg hhhh'), {
      maxTokens: 40,
      countTokens: chars,
    })
    for (const c of chunks) expect(c.embedText.length).toBeLessThanOrEqual(40)
    expect(chunks.map((c) => c.text).join(' ')).toBe('aaaa bbbb cccc dddd eeee ffff gggg hhhh')
  })

  it('has no chunks for a note with no body, and refuses a budget the title eats', () => {
    expect(chunkNote(note('   \n\n# Gravel frame\n'))).toEqual([])
    expect(() => chunkNote(note('text'), { maxTokens: 10 })).toThrow(/under 20 tokens/)
  })

  it('reads CRLF files and keeps a heading that is not the title', () => {
    const chunks = chunkNote(note('# Background\r\n\r\nOld notes.\r\n'))
    expect(chunks.map((c) => [c.heading, c.text])).toEqual([['Background', 'Old notes.']])
  })
})
