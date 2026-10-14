import { pathToFileURL } from 'node:url'
import { bench, parseCli } from './bench.ts'
import { deltaPct, isNoise, spread, type Summary } from './stats.ts'

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { pos: [a, b, ...scenarios], runs, warmup } = parseCli(process.argv.slice(2))
  if (!a || !b || scenarios.length === 0) {
    console.error('usage: pnpm compare <targetA> <targetB> <scenario...> [--runs N] [--warmup N]')
    process.exit(2)
  }
  const report = await bench([a, b], scenarios, runs, warmup)
  for (const sc of scenarios) {
    const [ra, rb] = [report[a][sc], report[b][sc]]
    console.log(`\n${sc}: ${a} -> ${b} (median, ${runs} interleaved runs; + is slower; spread = p95 - median)`)
    const row = (x: Summary, y: Summary, div = 1) => ({
      [a]: +(x.median / div).toFixed(1),
      [b]: +(y.median / div).toFixed(1),
      'delta %': +deltaPct(x.median, y.median).toFixed(1),
      [`spread ${a}`]: +(spread(x) / div).toFixed(1),
      [`spread ${b}`]: +(spread(y) / div).toFixed(1),
      note: isNoise(x, y) ? 'noise' : '',
    })
    console.table({
      'total ms': row(ra.totalMs, rb.totalMs),
      'sum(phases) ms': row(ra.phasesSumMs, rb.phasesSumMs),
      ...Object.fromEntries(Object.keys(ra.phasesMs).map((p) => [p, row(ra.phasesMs[p], rb.phasesMs[p])])),
      'heap MB': row(ra.peakHeap, rb.peakHeap, 1048576),
    })
  }
}
