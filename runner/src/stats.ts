export const quantile = (xs: number[], q: number): number => {
  const s = [...xs].sort((a, b) => a - b)
  const i = (s.length - 1) * q
  const lo = Math.floor(i)
  return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo)
}
export const median = (xs: number[]) => quantile(xs, 0.5)
export const p95 = (xs: number[]) => quantile(xs, 0.95)

export interface RunResult {
  totalMs: number
  phasesMs: Record<string, number>
  peakHeap: number
  gcMs: number
  allocBytes: number
  /** One row per tick: each phase ms, tick ms, GC ms, allocated bytes. */
  ticks: number[][]
}
export interface Summary {
  median: number
  p95: number
}
export interface Aggregate {
  runs: number
  totalMs: Summary
  phasesSumMs: Summary
  phasesMs: Record<string, Summary>
  peakHeap: Summary
  gcMs: Summary
  allocBytes: Summary
  /** Per-tick median over the runs, same columns as RunResult.ticks. */
  ticks: number[][]
}

const sum = (xs: number[]): Summary => ({ median: median(xs), p95: p95(xs) })

export const aggregate = (runs: RunResult[]): Aggregate => {
  const phases = Object.keys(runs[0].phasesMs)
  return {
    runs: runs.length,
    totalMs: sum(runs.map((r) => r.totalMs)),
    phasesSumMs: sum(runs.map((r) => Object.values(r.phasesMs).reduce((a, b) => a + b, 0))),
    phasesMs: Object.fromEntries(phases.map((p) => [p, sum(runs.map((r) => r.phasesMs[p]))])),
    peakHeap: sum(runs.map((r) => r.peakHeap)),
    gcMs: sum(runs.map((r) => r.gcMs)),
    allocBytes: sum(runs.map((r) => r.allocBytes)),
    ticks: runs[0].ticks.map((row, t) => row.map((_, c) => median(runs.map((r) => r.ticks[t][c])))),
  }
}

/** Percent change of b relative to a (positive = b slower/larger). */
export const deltaPct = (a: number, b: number): number => ((b - a) / a) * 100

/** Run-to-run noise of a summary: how far the p95 sits above the median. */
export const spread = (s: Summary): number => s.p95 - s.median

/** A delta is noise when it is smaller than the two sides' combined spread. */
export const isNoise = (a: Summary, b: Summary): boolean => Math.abs(b.median - a.median) < spread(a) + spread(b)
