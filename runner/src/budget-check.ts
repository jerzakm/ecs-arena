// The load budget of docs/design/v3-game.md. These three numbers are the only place the thresholds live.
export const FLOOR = 0.02
export const CAP = 0.25
export const MIN_NAIVE_RATIO = 1.5

export interface Verdict { floor: boolean; cap: boolean; ratio: boolean }

/** D20: the floor applies to `naiveShare` (naive region time over the normal tick total), the cap to `share` (normal region time over the normal tick total). `ratio` is naive region time over normal region time. */
export const judge = (share: number, naiveShare: number, ratio: number): Verdict => ({
  floor: naiveShare >= FLOOR,
  cap: share <= CAP,
  ratio: ratio >= MIN_NAIVE_RATIO,
})

export const passes = (v: Verdict): boolean => v.floor && v.cap && v.ratio

/** Process exit code: 1 when any verdict fails, unless the run only reports. */
export const exitCode = (verdicts: Verdict[], reportOnly: boolean): number => (reportOnly || verdicts.every(passes) ? 0 : 1)

/** Median and spread (min, max) of a sample. */
export const summarize = (xs: number[]): { median: number; min: number; max: number } => {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return { median: s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2, min: s[0], max: s[s.length - 1] }
}
