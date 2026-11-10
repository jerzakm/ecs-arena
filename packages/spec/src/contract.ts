export const PHASES = ['spawn', 'ai/target', 'move', 'combat', 'effects', 'morale', 'cleanup', 'objectives', 'stats'] as const
export type PhaseName = (typeof PHASES)[number]
/** The keys of a deep-dive run, in time order. `move.start` times the optional `Sim.moveStart` step. */
export const TIMED_PHASES = ['spawn', 'ai/target', 'move.start', 'move', 'combat', 'effects', 'morale', 'cleanup', 'objectives', 'stats'] as const

/** The fields the runner reads from the scenario of any game. */
export interface BaseScenario {
  name: string
  seed: number
  ticks: number
  /** The run loads the newest save after each tick `t` with `(t + 1) % loadEvery == 0` and replays from there (SPEC §10). */
  loadEvery: number
}

export interface Scenario extends BaseScenario {
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
export interface Sim<P extends string = PhaseName> {
  phases: Record<P, () => void>
  tick?: () => void
  /**
   * Optional. Runs right before `phases.move` in every run kind, and a deep-dive run times it as its own `move.start` key.
   * An implementation that has to copy start-of-phase values puts that copy here. When `tick()` is present it must call this step itself.
   */
  moveStart?: () => void
  snapshot(): CanonicalState
  /** SPEC §10: a deep copy of everything a later tick reads. The runner keeps the newest one and never looks inside. */
  save(): unknown
  /** SPEC §10: replaces the live state of this same sim with a value from `save`. Native ids can change, gameIds cannot. */
  load(state: unknown): void
  /** Frees library resources a process can run out of (a world limit). `pnpm verify` calls it after each trace. */
  dispose?(): void
}

/**
 * Everything the runner needs to know about one game. Scenario names are unique across all games
 * (asserted in games.ts), so a scenario name alone selects the game and `goldens/` stays one flat dir.
 */
export interface Game<S extends BaseScenario, K, P extends string> {
  id: string
  /** Names this game's output files and dirs (bench-data/<slug>/, docs/results-<slug>.md). The RTS is '' because its outputs predate the second game. */
  slug: string
  phases: readonly P[]
  /** The keys of a deep-dive run, in time order, and the phase columns of the CSV files. */
  timedPhases: readonly string[]
  /** The phase before which `sim.moveStart` runs. undefined means no hook. */
  startHook: P | undefined
  kernel: K
  scenarios: Readonly<Record<string, S>>
  /** The scenarios that make the headline of this game. */
  board: readonly string[]
  /** Path of the impl entry, relative to `impls/<impl>/`. */
  entry: string
}

/** One tick through the phases of the game in spec order, with `moveStart` before the start hook. Callers that have no `tick()` shortcut use this. */
export const runPhases = (game: Pick<Game<BaseScenario, unknown, string>, 'phases' | 'startHook'>, sim: Sim<string>): void => {
  for (const p of game.phases) {
    if (p === game.startHook) sim.moveStart?.()
    sim.phases[p]()
  }
}

/** One timed step of a deep-dive run: the `timedPhases` key and the call. */
export interface TimedStep { key: string; run: () => void }

/**
 * The steps of `game.timedPhases` bound to `sim`, in time order. Built once per sim, so a timing loop allocates nothing per tick.
 * The hook step has the key `<startHook>.start`, and it is a no-op when the sim has no `moveStart`.
 */
export const timedSteps = (game: Pick<Game<BaseScenario, unknown, string>, 'timedPhases' | 'startHook'>, sim: Sim<string>): TimedStep[] =>
  game.timedPhases.map((key) =>
    game.startHook !== undefined && key === `${game.startHook}.start` ? { key, run: () => sim.moveStart?.() } : { key, run: () => sim.phases[key]() })

export type Kernel = typeof import('./kernel.ts')
export type CreateSim<S extends BaseScenario, K, P extends string> = (scenario: S, kernel: K) => Sim<P>
/**
 * The createSim of any game, as a runner tool holds it. The runner only passes the scenario and kernel of the game it found,
 * a pairing no type can state, so method syntax makes the parameters bivariant and every impl's exact createSim fits.
 */
export type AnyCreateSim = { create(scenario: BaseScenario, kernel: unknown): Sim<string> }['create']
