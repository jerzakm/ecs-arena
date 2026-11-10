import { readFileSync } from 'node:fs'
import { bench, currentTree, parseCli, treeChild, type BenchReport } from './bench.ts'
import { hasScenario } from '@ecs-arena/spec'
import { isMain } from './cli.ts'
import { ensureBaseTree } from './variants.ts'
import { CLOCK_DRIFT_MAX, hlRatio, mannWhitney, median, MIN_RUNS, minDetectableEffect, relativeSpread, type Aggregate } from './stats.ts'

type Side = { name: string; samples: Record<string, number[]>; unstable?: number }

/** One row per metric: medians, Hodges-Lehmann shift, Mann-Whitney p and each side's noise. */
export const compareRows = (a: Side, b: Side, alpha = 0.05) =>
  Object.fromEntries(Object.keys(a.samples).filter((m) => b.samples[m]).map((m) => {
    const [x, y] = [a.samples[m], b.samples[m]]
    const shift = (hlRatio(x, y) - 1) * 100
    const p = mannWhitney(x, y)
    const floor = Math.max(relativeSpread(x), relativeSpread(y)) * 100
    const detectable = minDetectableEffect(floor / 100, Math.min(x.length, y.length)) * 100
    const verdict = p > alpha ? 'no diff' : Math.abs(shift) <= floor ? 'within noise' : shift > 0 ? 'slower' : 'faster'
    return [m, {
      [a.name]: +median(x).toFixed(2),
      [b.name]: +median(y).toFixed(2),
      'shift %': +shift.toFixed(1),
      p: +p.toFixed(3),
      'noise %': +floor.toFixed(1),
      'min detectable %': +detectable.toFixed(1),
      verdict,
    }]
  }))

const side = (name: string, { samples, unstable }: Aggregate): Side => ({ name, samples, unstable })

const load = (path: string) => (JSON.parse(readFileSync(path, 'utf8')) as { report: BenchReport }).report

if (isMain(import.meta)) {
  const { pos, plan, base } = parseCli(process.argv.slice(2))
  const [a, b, ...scenarios] = pos
  const files = !base && a?.endsWith('.json') && b?.endsWith('.json')
  const usage = base ? !pos.some(hasScenario) || pos.every(hasScenario) : !a || !b || (!files && scenarios.length === 0)
  if (usage) {
    console.error('usage: pnpm compare <targetA> <targetB> <scenario...> [--runs N]\n       pnpm compare <impl...> <scenario...> --base <git-ref> [--runs N]\n       pnpm compare <a.json> <b.json>   (files from pnpm bench --out)')
    process.exit(2)
  }
  // From files: each file holds one target, and the compare uses the scenarios that both files have.
  const sides: [Side, Side][] = []
  if (base) {
    // Each impl runs twice: from the tree at the base ref and from this tree, interleaved ABAB. The child script of each side comes from its own tree.
    const tree = ensureBaseTree(base)
    const impls = pos.filter((p) => !hasScenario(p))
    const scs = pos.filter(hasScenario)
    const baseName = (impl: string) => `${impl} @${tree.sha}`
    const runners = new Map(impls.flatMap((impl) => [[baseName(impl), { ...currentTree(impl), cmd: treeChild(tree.root) }], [impl, currentTree(impl)]] as const))
    const report = await bench([...runners.keys()], scs, { ...plan, deep: 2 }, (t) => runners.get(t)!)
    for (const impl of impls)
      for (const sc of scs)
        sides.push([side(`${sc} ${baseName(impl)}`, report[baseName(impl)][sc]), side(`${impl} now`, report[impl][sc])])
  } else if (files) {
    const [ra, rb] = [load(a), load(b)]
    const [ta, tb] = [Object.keys(ra)[0], Object.keys(rb)[0]]
    for (const sc of Object.keys(ra[ta]).filter((s) => rb[tb][s]))
      sides.push([side(`${sc} A ${ta}`, ra[ta][sc]), side(`B ${tb}`, rb[tb][sc])])
  } else {
    const report = await bench([a, b], scenarios, { ...plan, deep: 2 })
    for (const sc of scenarios) sides.push([side(`${sc} ${a}`, report[a][sc]), side(b, report[b][sc])])
  }
  console.log('shift = Hodges-Lehmann median of B/A run pairs (+ is slower). p = Mann-Whitney U. noise = max 1.4826*MAD/median. min detectable = 2.8*noise*sqrt(2/runs), a guide to the smallest shift worth reading.')
  for (const [x, y] of sides) {
    if (Math.min(x.samples.total.length, y.samples.total.length) < MIN_RUNS) console.log(`warning: fewer than ${MIN_RUNS} runs per side, the p-value cannot reach 0.05. Use --runs ${MIN_RUNS} or more.`)
    console.table(compareRows(x, y))
    console.log(`unstable runs (clock drifted over ${CLOCK_DRIFT_MAX * 100}%): ${[x, y].map((s) => `${s.name} ${s.unstable ?? 'n/a'}/${s.samples.total.length}`).join(', ')}`)
  }
}
