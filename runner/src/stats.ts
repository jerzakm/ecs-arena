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
  /** The raw value of each run for each metric (total, the phases, gc, alloc), for the rank tests. */
  samples: Record<string, number[]>
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
    samples: {
      total: runs.map((r) => r.totalMs),
      ...Object.fromEntries(phases.map((p) => [p, runs.map((r) => r.phasesMs[p])])),
      gc: runs.map((r) => r.gcMs),
      alloc: runs.map((r) => r.allocBytes),
    },
  }
}

/** Percent change of b relative to a (positive = b slower/larger). */
export const deltaPct = (a: number, b: number): number => ((b - a) / a) * 100

/** Robust run-to-run noise: 1.4826 * MAD / median, as a fraction. */
export const noise = (xs: number[]): number => {
  const m = median(xs)
  return m ? (1.4826 * median(xs.map((x) => Math.abs(x - m)))) / m : 0
}

/** Hodges-Lehmann shift as a ratio: the median of all b/a pairs. 1.05 = b is 5% larger. */
export const hlRatio = (a: number[], b: number[]): number => median(a.flatMap((x) => b.map((y) => y / x)))

/**
 * Two-sided Mann-Whitney U p-value, normal approximation with tie and continuity correction.
 * ponytail: the approximation is loose below about 8 runs per side, use an exact test if small n matters.
 */
export const mannWhitney = (a: number[], b: number[]): number => {
  const all = [...a.map((v) => ({ v, g: 0 })), ...b.map((v) => ({ v, g: 1 }))].sort((x, y) => x.v - y.v)
  const n = all.length, n1 = a.length, n2 = b.length
  const rank: number[] = []
  let ties = 0
  for (let i = 0; i < n; ) {
    let j = i
    while (j + 1 < n && all[j + 1].v === all[i].v) j++
    for (let k = i; k <= j; k++) rank[k] = (i + j) / 2 + 1
    const t = j - i + 1
    ties += t ** 3 - t
    i = j + 1
  }
  const r1 = all.reduce((s, x, i) => s + (x.g === 0 ? rank[i] : 0), 0)
  const u = r1 - (n1 * (n1 + 1)) / 2
  const sd = Math.sqrt(((n1 * n2) / 12) * (n + 1 - ties / (n * (n - 1))))
  if (!sd) return 1
  const z = Math.max(0, Math.abs(u - (n1 * n2) / 2) - 0.5) / sd
  return Math.min(1, 2 * (1 - phi(z)))
}

/** Standard normal CDF (Abramowitz-Stegun 7.1.26, error below 1.5e-7). */
const phi = (z: number): number => {
  const t = 1 / (1 + 0.3275911 * (z / Math.SQRT2))
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2)
  return 0.5 * (1 + erf)
}
