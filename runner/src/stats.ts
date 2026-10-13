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
}
export interface Summary {
  median: number
  p95: number
}
export interface Aggregate {
  runs: number
  totalMs: Summary
  phasesMs: Record<string, Summary>
  peakHeap: Summary
}

const sum = (xs: number[]): Summary => ({ median: median(xs), p95: p95(xs) })

export const aggregate = (runs: RunResult[]): Aggregate => {
  const phases = Object.keys(runs[0].phasesMs)
  return {
    runs: runs.length,
    totalMs: sum(runs.map((r) => r.totalMs)),
    phasesMs: Object.fromEntries(phases.map((p) => [p, sum(runs.map((r) => r.phasesMs[p]))])),
    peakHeap: sum(runs.map((r) => r.peakHeap)),
  }
}

/** Percent change of b relative to a (positive = b slower/larger). */
export const deltaPct = (a: number, b: number): number => ((b - a) / a) * 100
