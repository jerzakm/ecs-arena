// The load budget of docs/design/v3-game.md. These three numbers are the only place the thresholds live.
export const FLOOR = 0.02
export const CAP = 0.25
export const MIN_NAIVE_RATIO = 1.5

export interface Verdict { floor: boolean; cap: boolean; ratio: boolean }

/** `share` is the region's part of the tick total, `ratio` its naive time divided by its normal time. */
export const judge = (share: number, ratio: number): Verdict => ({
  floor: share >= FLOOR,
  cap: share <= CAP,
  ratio: ratio >= MIN_NAIVE_RATIO,
})

export const passes = (v: Verdict): boolean => v.floor && v.cap && v.ratio

/** Process exit code: 1 when any verdict fails, unless the run only reports. */
export const exitCode = (verdicts: Verdict[], reportOnly: boolean): number => (reportOnly || verdicts.every(passes) ? 0 : 1)
