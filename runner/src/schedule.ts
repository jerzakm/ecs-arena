import { SAVE_INTERVAL, type Scenario, type Sim } from '@ecs-arena/spec'

export interface Hooks {
  /** Runs tick `t`. */
  tick(t: number): void
  /** Runs after tick `t` and before the save or load of that tick (hashing goes here). */
  after?(t: number): void
  /** Wraps each save and load so a caller can time them. */
  timed?(kind: 'save' | 'load', run: () => void): void
}

/** The SPEC §10 schedule. Every run kind goes through this. */
export const runScheduled = (sim: Sim, scenario: Scenario, hooks: Hooks): void => {
  const timed = hooks.timed ?? ((_, run) => run())
  let saved: { tick: number; state: unknown } | undefined
  let loadedAt = -1
  for (let t = 0; t < scenario.ticks; t++) {
    hooks.tick(t)
    hooks.after?.(t)
    if ((t + 1) % scenario.loadEvery === 0 && t > loadedAt) {
      loadedAt = t
      timed('load', () => sim.load(saved!.state))
      t = saved!.tick
    } else if (t > 0 && t % SAVE_INTERVAL === 0) {
      const at = t
      timed('save', () => { saved = { tick: at, state: sim.save() } })
    }
  }
}
