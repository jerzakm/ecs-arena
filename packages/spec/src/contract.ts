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
}

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
  /** Frees library resources a process can run out of (a world limit). `pnpm verify` calls it after each trace. */
  dispose?(): void
}

export type CreateSim = (scenario: Scenario, kernel: typeof import('./kernel.ts')) => Sim
