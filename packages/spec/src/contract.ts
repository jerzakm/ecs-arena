export const PHASES = ['spawn', 'ai/target', 'move', 'combat', 'effects', 'morale', 'cleanup', 'objectives', 'stats'] as const
export type PhaseName = (typeof PHASES)[number]

export interface Scenario {
  name: string
  seed: number
  ticks: number
  targetPop: number
  wavePeriod: number
  maxSquadsPerWave: number
  surgePeriod: number
  surgeBase: number
  surgeCap: number
  /** Units that one shrine holds (SPEC §6.14). */
  garrisonCap: number
  /** Commander orders that each team gives every ORDER_PERIOD ticks (SPEC §6.12). */
  ordersPerTeam: number
  /** The run loads the newest save after each tick `t` with `(t + 1) % loadEvery == 0` and replays from there (SPEC §10). */
  loadEvery: number
}

/** SPEC §10: the runner asks for a save after each tick `t > 0` with `t % SAVE_INTERVAL == 0`. */
export const SAVE_INTERVAL = 25

/** SPEC §8: one flat array of int32 values. */
export type CanonicalState = number[]

/**
 * The one seam an ECS library implements. The runner hashes `snapshot()` itself.
 * `tick`, when present, runs the 9 phases in PHASES order exactly once. Headline runs call it,
 * and without it they call `phases` in PHASES order. Deep-dive runs always call `phases` one by one.
 */
export interface Sim {
  phases: Record<PhaseName, () => void>
  tick?: () => void
  snapshot(): CanonicalState
  /** SPEC §10: a deep copy of everything a later tick reads. The runner keeps the newest one and never looks inside. */
  save(): unknown
  /** SPEC §10: replaces the live state of this same sim with a value from `save`. Native ids can change, gameIds cannot. */
  load(state: unknown): void
  /** Frees library resources a process can run out of (a world limit). `pnpm verify` calls it after each trace. */
  dispose?(): void
}

export type CreateSim = (scenario: Scenario, kernel: typeof import('./kernel.ts')) => Sim
