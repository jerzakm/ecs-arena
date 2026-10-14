export const quantile = (xs: number[], q: number): number => {
  const s = [...xs].sort((a, b) => a - b)
  const i = (s.length - 1) * q
  const lo = Math.floor(i)
  return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo)
}
export const median = (xs: number[]) => quantile(xs, 0.5)
export const p95 = (xs: number[]) => quantile(xs, 0.95)

export const FRAME_MS = 16.6

/** p99 tick ms, slowest tick ms and the count of ticks over one 60 fps frame. */
export const tailMetrics = (tickMs: number[]) => ({
  p99: quantile(tickMs, 0.99),
  max: Math.max(...tickMs),
  over: tickMs.filter((t) => t > FRAME_MS).length,
})

/** Small seeded PRNG (mulberry32) so a bootstrap interval is the same on every run. */
export const prng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

export interface Interval {
  point: number
  lo: number
  hi: number
}

/** Percentile bootstrap 95% interval of a statistic over resamples of the run indices. */
const bootstrap = (n: number, stat: (idx: number[]) => number, point: number, resamples = 2000, seed = 1): Interval => {
  const rnd = prng(seed)
  const vals = Array.from({ length: resamples }, () => stat(Array.from({ length: n }, () => Math.floor(rnd() * n))))
  return { point, lo: quantile(vals, 0.025), hi: quantile(vals, 0.975) }
}

export const medianCI = (xs: number[], resamples = 2000, seed = 1): Interval =>
  bootstrap(xs.length, (idx) => median(idx.map((i) => xs[i])), median(xs), resamples, seed)

/**
 * Geometric mean over scenarios of median(lib total) / median(baseline total), with matched runs
 * (run i of each side shares a resample index). Each argument maps scenario to run totals.
 */
export const geomeanScore = (lib: Record<string, number[]>, base: Record<string, number[]>, resamples = 2000, seed = 1): Interval => {
  const scs = Object.keys(base).filter((s) => lib[s])
  const n = Math.min(...scs.map((s) => Math.min(lib[s].length, base[s].length)))
  const gm = (idx: number[]) => Math.exp(scs.reduce((a, s) => a + Math.log(median(idx.map((i) => lib[s][i])) / median(idx.map((i) => base[s][i]))), 0) / scs.length)
  const all = Array.from({ length: n }, (_, i) => i)
  return bootstrap(n, gm, gm(all), resamples, seed)
}

/** Best point first. A score whose interval overlaps the interval that opened the current rank shares that rank. */
export const rankScores = <T extends Interval>(scores: T[]): (T & { rank: number })[] => {
  const sorted = [...scores].sort((a, b) => a.point - b.point)
  let lead = sorted[0]
  let rank = 1
  return sorted.map((s, i) => {
    if (s.lo > lead.hi) {
      lead = s
      rank = i + 1
    }
    return { ...s, rank }
  })
}

export const BASELINE = 'baseline-js'

/** Ranked headline score for every target but the baseline. totals maps target to scenario to run totals. */
export const scoreTargets = (totals: Record<string, Record<string, number[]>>) => {
  const base = totals[BASELINE]
  if (!base) return []
  return rankScores(Object.entries(totals).filter(([t]) => t !== BASELINE).map(([target, lib]) => ({ target, ...geomeanScore(lib, base) })))
}

export interface RunResult {
  totalMs: number
  /** Whole-tick ms for each tick. */
  tickMs: number[]
  /** Deep-dive runs only. */
  deep?: {
    phasesMs: Record<string, number>
    peakHeap: number
    gcMs: number
    allocBytes: number
    /** One row per tick: each phase ms, tick ms, GC ms, allocated bytes, used heap bytes. */
    ticks: number[][]
  }
}
export interface Summary {
  median: number
  p95: number
}
export interface DeepAggregate {
  runs: number
  totalMs: Summary
  phasesSumMs: Summary
  phasesMs: Record<string, Summary>
  peakHeap: Summary
  gcMs: Summary
  allocBytes: Summary
  /** Per-tick median over the runs, same columns as the deep ticks rows. */
  ticks: number[][]
  /** Median deep total over median headline total, minus 1: what the timers, GC profiler and heap reads cost. */
  overhead: number
}
export interface Aggregate {
  runs: number
  totalMs: Summary & Interval
  p99Ms: Summary
  maxMs: Summary
  over: Summary
  /** The raw total of each run, for the rank tests and the headline score. */
  samples: Record<string, number[]>
  deep?: DeepAggregate
}

const sum = (xs: number[]): Summary => ({ median: median(xs), p95: p95(xs) })

const aggregateDeep = (runs: RunResult[], headlineMedian: number): DeepAggregate => {
  const ds = runs.map((r) => r.deep!)
  const phases = Object.keys(ds[0].phasesMs)
  return {
    runs: runs.length,
    totalMs: sum(runs.map((r) => r.totalMs)),
    phasesSumMs: sum(ds.map((d) => Object.values(d.phasesMs).reduce((a, b) => a + b, 0))),
    phasesMs: Object.fromEntries(phases.map((p) => [p, sum(ds.map((d) => d.phasesMs[p]))])),
    peakHeap: sum(ds.map((d) => d.peakHeap)),
    gcMs: sum(ds.map((d) => d.gcMs)),
    allocBytes: sum(ds.map((d) => d.allocBytes)),
    ticks: ds[0].ticks.map((row, t) => row.map((_, c) => median(ds.map((d) => d.ticks[t][c])))),
    overhead: median(runs.map((r) => r.totalMs)) / headlineMedian - 1,
  }
}

export const aggregate = (runs: RunResult[], deepRuns: RunResult[] = []): Aggregate => {
  const tails = runs.map((r) => tailMetrics(r.tickMs))
  const totals = runs.map((r) => r.totalMs)
  return {
    runs: runs.length,
    totalMs: { ...sum(totals), ...medianCI(totals) },
    p99Ms: sum(tails.map((t) => t.p99)),
    maxMs: sum(tails.map((t) => t.max)),
    over: sum(tails.map((t) => t.over)),
    samples: {
      total: totals,
      ...(deepRuns.length && {
        ...Object.fromEntries(Object.keys(deepRuns[0].deep!.phasesMs).map((p) => [p, deepRuns.map((r) => r.deep!.phasesMs[p])])),
        gc: deepRuns.map((r) => r.deep!.gcMs),
        alloc: deepRuns.map((r) => r.deep!.allocBytes),
      }),
    },
    ...(deepRuns.length && { deep: aggregateDeep(deepRuns, median(totals)) }),
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
 * ponytail: the approximation is loose with few runs per side, use an exact test if small n matters.
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

/** Fewest runs per side where a perfectly separated pair reaches p < 0.05 (4 gives 0.030, 3 gives 0.081). */
export const MIN_RUNS = 4

/** Standard normal CDF (Abramowitz-Stegun 7.1.26, error below 1.5e-7). */
const phi = (z: number): number => {
  const t = 1 / (1 + 0.3275911 * (z / Math.SQRT2))
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2)
  return 0.5 * (1 + erf)
}
