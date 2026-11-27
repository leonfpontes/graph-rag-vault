// axe in jsdom: every rule but the ones jsdom can't measure (contrast needs real rendering; the
// e2e tests and the design audit measure it in the browser).
import axeCore from 'axe-core'

export async function axe(root: Element): Promise<string[]> {
  const result = await axeCore.run(root, {
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  })
  return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}
