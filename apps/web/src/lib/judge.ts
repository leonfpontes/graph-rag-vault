// The faithfulness judge in words, from latest.json: the model names, and the person's check and the
// second judge in the same sentences on the Evaluation page and in the README (readme.ts). Pure, so
// the README test can run it in Node.
import type { Scoreboard } from '@graph-rag/client'

import { pct, usd } from './format'

export const modelLabel = (id: string) =>
  id.startsWith('claude-haiku-5-5')
    ? 'Claude Haiku 5.5'
    : id.startsWith('claude-opus-5-5')
      ? 'Claude Opus 5.5'
      : id.startsWith('claude-haiku-4-5')
        ? 'Claude Haiku 4.5'
        : id

const ORDINAL = [
  'first',
  'second',
  'third',
  'fourth',
  'fifth',
  'sixth',
  'seventh',
  'eighth',
  'ninth',
  'tenth',
]

/**
 * The judge check in words, from latest.json (the same sentences as the README). `demoAnswers`: the
 * recorded answers beyond the scoreboard's (one per tuning question, for the demo).
 */
export function judgeLines(sb: Scoreboard, demoAnswers = 0): string[] {
  const hu = sb.human
  const sj = sb.secondJudge
  const lines: string[] = []
  if (hu) {
    const blind = hu.blindPart
    const agreedAll = Math.round(hu.observed * hu.items)
    const reviewed = hu.items - (blind?.items ?? 0)
    const reviewedAgreed = agreedAll - (blind?.agreed ?? 0)
    const sample = `on a stratified sample of ${hu.sampleAnswers ?? hu.answers} answers (half from those with a sentence the judge did not fully support)`
    if (hu.blind === false) {
      let text = `Checked by a person (${hu.labeledBy}) ${sample}. Reviewed not blind: agreed with the judge on ${reviewedAgreed} of ${reviewed} sentences.`
      if (blind) {
        text += ` Labelled blind, without the judge's verdicts: agreed on ${blind.agreed} of ${blind.items} sentences (the answers that changed in the index rebuild)`
        const d = blind.disagreements[0]
        if (blind.disagreements.length === 1 && d) {
          const same = sj?.disagreements.some((x) => x.judge === d.judge && x.second === d.human)
          text += `; on the ${ORDINAL[blind.items - 1] ?? 'other'} the judge said ${d.judge} and the person ${d.human}${same ? ', the same direction as the second judge' : ''}`
        }
        text += `. No kappa: the review saw the verdicts, and ${blind.items} blind sentences are too few for one.`
      } else text += " No kappa: the person saw the judge's verdicts."
      if (hu.pendingAnswers)
        text += ` Review pending for ${hu.pendingAnswers} of ${hu.sampleAnswers ?? hu.answers} answers.`
      lines.push(text)
    } else
      lines.push(
        `Checked by a person (${hu.labeledBy}) without the judge's verdicts, ${sample}: agreement ${pct(hu.observed)} on ${hu.items} sentences${hu.kappa === undefined ? '' : `, Cohen's kappa ${hu.kappa.toFixed(2)}`}.`,
      )
  }
  if (sj) {
    let text = `Agreement between two automatic judges: ${modelLabel(sj.model)}, blind, on the same ${sj.items} sentences: ${pct(sj.observed)}, Cohen's kappa ${sj.kappa?.toFixed(2) ?? '—'}.`
    const d0 = sj.disagreements[0]
    const oneWay = !!d0 && sj.disagreements.every((d) => d.judge === d0.judge && d.second === d0.second)
    if (oneWay)
      text += ` All ${sj.disagreements.length} disagreements go the same way: the main judge said ${d0.judge}, the second judge said ${d0.second}, so the faithfulness above is a ${d0.second === 'supported' ? 'conservative' : 'generous'} estimate.`
    if (sj.secondLabels?.length === 1)
      text += ` Kappa says little here: the second judge marked all ${sj.items} sentences ${sj.secondLabels[0]}, and with one judge on a single label, kappa is 0 whatever the other does.`
    else
      text += ` A low kappa is expected here: the main judge marked only ${sj.judgeFlagged} of ${sj.items} sentences as not fully supported, and with so few cases, ${sj.disagreements.length} disagreements${oneWay ? ' that all go one way' : ''} pull kappa down even at ${pct(sj.observed)} agreement.`
    text += ` The main judge stays ${modelLabel(sb.models.judge)}.`
    lines.push(text)
  }
  const c = sb.cost
  const all = Object.values(sb.generation).reduce((n, g) => n + g.answers, 0) + demoAnswers
  lines.push(
    c.reused
      ? `Cost: ${usd(c.answerUsd + c.judgeUsd)} for all recorded answers and their judgments (${all}); the index rebuild asked again the ${all - c.reused} whose search notes changed, for ${usd(c.spentUsd)}${sj ? `; the second judge cost ${usd(sj.costUsd)}` : ''}.`
      : `Cost: ${usd(c.spentUsd)} for the whole run${sj ? `, plus ${usd(sj.costUsd)} for the second judge` : ''}.`,
  )
  return lines
}
