import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { bench, parseCli, type BenchReport } from './bench.ts'
import { hlRatio, mannWhitney, median, MIN_RUNS, noise } from './stats.ts'

type Side = { name: string; samples: Record<string, number[]> }

/** One row per metric: medians, Hodges-Lehmann shift, Mann-Whitney p and each side's noise. */
export const compareRows = (a: Side, b: Side, alpha = 0.05) =>
  Object.fromEntries(Object.keys(a.samples).filter((m) => b.samples[m]).map((m) => {
    const [x, y] = [a.samples[m], b.samples[m]]
    const shift = (hlRatio(x, y) - 1) * 100
    const p = mannWhitney(x, y)
    const floor = Math.max(noise(x), noise(y)) * 100
    const verdict = p > alpha ? 'no diff' : Math.abs(shift) <= floor ? 'within noise' : shift > 0 ? 'slower' : 'faster'
    return [m, {
      [a.name]: +median(x).toFixed(2),
      [b.name]: +median(y).toFixed(2),
      'shift %': +shift.toFixed(1),
      p: +p.toFixed(3),
      'noise %': +floor.toFixed(1),
      verdict,
    }]
  }))

const load = (path: string) => (JSON.parse(readFileSync(path, 'utf8')) as { report: BenchReport }).report

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { pos: [a, b, ...scenarios], plan } = parseCli(process.argv.slice(2))
  const files = a?.endsWith('.json') && b?.endsWith('.json')
  if (!a || !b || (!files && scenarios.length === 0)) {
    console.error('usage: pnpm compare <targetA> <targetB> <scenario...> [--runs N]\n       pnpm compare <a.json> <b.json>   (files from pnpm bench --out)')
    process.exit(2)
  }
  // From files: each file holds one target, and the compare uses the scenarios that both files have.
  const sides: [Side, Side][] = []
  if (files) {
    const [ra, rb] = [load(a), load(b)]
    const [ta, tb] = [Object.keys(ra)[0], Object.keys(rb)[0]]
    for (const sc of Object.keys(ra[ta]).filter((s) => rb[tb][s]))
      sides.push([{ name: `${sc} A ${ta}`, samples: ra[ta][sc].samples }, { name: `B ${tb}`, samples: rb[tb][sc].samples }])
  } else {
    const report = await bench([a, b], scenarios, { ...plan, deep: 2 })
    for (const sc of scenarios) sides.push([{ name: `${sc} ${a}`, samples: report[a][sc].samples }, { name: b, samples: report[b][sc].samples }])
  }
  console.log('shift = Hodges-Lehmann median of B/A run pairs (+ is slower). p = Mann-Whitney U. noise = max 1.4826*MAD/median.')
  for (const [x, y] of sides) {
    if (Math.min(x.samples.total.length, y.samples.total.length) < MIN_RUNS) console.log(`warning: fewer than ${MIN_RUNS} runs per side, the p-value cannot reach 0.05. Use --runs ${MIN_RUNS} or more.`)
    console.table(compareRows(x, y))
  }
}
