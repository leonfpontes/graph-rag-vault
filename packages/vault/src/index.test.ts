import { describe, expect, it } from 'vitest'

import {
  FRONTMATTER_RELATIONS,
  isIsoDate,
  isNoteId,
  isNoteType,
  isRelation,
  NOTE_TYPES,
  RELATIONS,
} from './index.js'

describe('vault contract', () => {
  it('has the six note types and the seven relations of the plan', () => {
    expect(NOTE_TYPES).toEqual(['person', 'project', 'decision', 'meeting', 'document', 'customer'])
    expect(RELATIONS).toHaveLength(7)
    expect(FRONTMATTER_RELATIONS).not.toContain('mentions')
    expect(FRONTMATTER_RELATIONS).toHaveLength(6)
  })

  it('accepts ids, types and relations only in their exact form', () => {
    expect(isNoteId('maya-okafor')).toBe(true)
    expect(isNoteId('dec-0042')).toBe(true)
    for (const bad of ['Maya', 'maya_okafor', '-maya', 'maya-', 'a--b', '', 42])
      expect(isNoteId(bad)).toBe(false)
    expect(isNoteType('decision')).toBe(true)
    expect(isNoteType('Decision')).toBe(false)
    expect(isRelation('supersedes')).toBe(true)
    expect(isRelation('links')).toBe(false)
  })

  it('accepts only real calendar dates', () => {
    expect(isIsoDate('2026-02-28')).toBe(true)
    expect(isIsoDate('2024-02-29')).toBe(true)
    for (const bad of ['2026-02-30', '2026-13-01', '26-01-01', '2026-1-1', null])
      expect(isIsoDate(bad)).toBe(false)
  })
})
