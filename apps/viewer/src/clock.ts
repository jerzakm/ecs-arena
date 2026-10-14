export type Speed = '1x' | '4x' | 'max'

/** The one place the sim tick rate is defined: 1x plays 10 ticks per second. */
export const BASE_TICKS_PER_SEC = 10
const MULTIPLIER = { '1x': 1, '4x': 4 } as const
export const MAX_CATCHUP = 8

export const tickIntervalMs = (speed: Speed) => (speed === 'max' ? 0 : 1000 / (BASE_TICKS_PER_SEC * MULTIPLIER[speed]))

/** Whole ticks due after `dtMs`, plus the carried remainder. Max returns Infinity: the caller bounds it by a time budget. */
export const advance = (acc: number, speed: Speed, dtMs: number) => {
  if (speed === 'max') return { ticks: Infinity, acc: 0 }
  const interval = tickIntervalMs(speed)
  const total = acc + dtMs
  const due = Math.floor(total / interval)
  if (due > MAX_CATCHUP) return { ticks: MAX_CATCHUP, acc: 0 }
  return { ticks: due, acc: total - due * interval }
}
