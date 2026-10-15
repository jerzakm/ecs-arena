import { SAVE_INTERVAL, type Scenario, type Sim } from '@ecs-arena/spec'

export interface Hooks {
  /** Runs tick `t`. */
  tick(t: number): void
  /** Runs after tick `t` and before the save or load of that tick (hashing goes here). */
  after?(t: number): void
  /** Wraps each save and load so a caller can time them. */
  timed?(kind: 'save' | 'load', run: () => void): void
}

/** The SPEC §10 schedule: save after each 100th tick, load the newest save after `loadTick`, replay from the save. Every run kind goes through this. */
export const runScheduled = (sim: Sim, scenario: Scenario, hooks: Hooks): void => {
  const timed = hooks.timed ?? ((_, run) => run())
  let saved: { tick: number; state: unknown } | undefined
  let loaded = false
  for (let t = 0; t < scenario.ticks; t++) {
    hooks.tick(t)
    hooks.after?.(t)
    if (t > 0 && t % SAVE_INTERVAL === 0) {
      const at = t
      timed('save', () => { saved = { tick: at, state: sim.save() } })
    }
    if (t === scenario.loadTick && !loaded) {
      loaded = true
      timed('load', () => sim.load(saved!.state))
      t = saved!.tick
    }
  }
}
