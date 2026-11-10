// The per-world totals of SPEC-survivors §8 item 1 and the snapshot header they make. Every impl keeps one `Totals` and writes the header with `worldHeader`.
import { RENDER_SEED } from '../kernel.ts'
import { FIRST_ID } from './core.ts'
import { EVENT_COUNT } from './render.ts'

export interface Totals {
  /** The last finished tick. It is -1 before the first tick and the render phase of tick t sets it to t. */
  tick: number
  nextId: number
  alive: number
  kills: number
  dmgOut: number
  dmgTaken: number
  level: number
  xp: number
  picks: number
  /** How many events of each type (HIT, KILL, STATUS, PICKUP, LEVELUP) were pushed. */
  evt: number[]
  renderChain: number
}

export const newTotals = (): Totals => ({
  tick: -1, nextId: FIRST_ID, alive: 0, kills: 0, dmgOut: 0, dmgTaken: 0, level: 1, xp: 0, picks: 0,
  evt: Array.from({ length: EVENT_COUNT }, () => 0), renderChain: RENDER_SEED,
})

/** The first fields of the snapshot, in the order of `SNAPSHOT.WORLD`. The tick is `totals.tick`, the last finished tick. */
export const worldHeader = (t: Totals): number[] => [
  t.tick, t.nextId, t.alive, t.kills, t.dmgOut, t.dmgTaken, t.level, t.xp, t.picks, ...t.evt, t.renderChain,
]
