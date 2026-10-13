import { pathToFileURL } from 'node:url'
import { bench, parseArgs } from './bench.ts'
import { deltaPct } from './stats.ts'

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { pos: [a, b, ...scenarios], runs } = parseArgs(process.argv.slice(2))
  if (!a || !b || scenarios.length === 0) {
    console.error('usage: pnpm compare <targetA> <targetB> <scenario...> [--runs N]')
    process.exit(2)
  }
  const report = await bench([a, b], scenarios, runs)
  for (const sc of scenarios) {
    const [ra, rb] = [report[a][sc], report[b][sc]]
    console.log(`\n${sc}: ${a} -> ${b} (median, ${runs} runs; + is slower)`)
    const row = (l: string, x: number, y: number) =>
      console.log(`  ${l.padEnd(10)}${x.toFixed(1).padStart(9)}${y.toFixed(1).padStart(9)}${(deltaPct(x, y).toFixed(1) + '%').padStart(9)}`)
    row('total ms', ra.totalMs.median, rb.totalMs.median)
    for (const p of Object.keys(ra.phasesMs)) row(p, ra.phasesMs[p].median, rb.phasesMs[p].median)
    row('heap MB', ra.peakHeap.median / 1048576, rb.peakHeap.median / 1048576)
  }
}
