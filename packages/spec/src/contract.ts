export const PHASES = ['spawn', 'ai/target', 'move', 'combat', 'effects', 'cleanup', 'stats'] as const
export type PhaseName = (typeof PHASES)[number]

export interface Scenario {
  name: string
  seed: number
  ticks: number
  targetPop: number
  wavePeriod: number
  maxSquadsPerWave: number
}

/** SPEC.md §8: one flat array of int32 values. */
export type CanonicalState = number[]

/**
 * The one seam an ECS library implements. The runner calls `phases` in PHASES
 * order once per tick and hashes `snapshot()` itself.
 */
export interface Sim {
  phases: Record<PhaseName, () => void>
  snapshot(): CanonicalState
}

export type CreateSim = (scenario: Scenario, kernel: typeof import('./kernel.ts')) => Sim
