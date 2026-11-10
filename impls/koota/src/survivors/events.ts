// The per-tick lists. The event lists of SPEC-survivors §3.3 (hits, kills, pickups, level-ups) go to the systems of the next phases,
// and `pushEvent` counts each event in the totals. The other lists carry work from one system of a tick to a later one.
import type { Entity } from 'koota'
import type { Ctx } from './context.ts'
import { Totals } from './traits.ts'

export interface HitEvent { e: Entity; traits: number }
export interface KillEvent { gameId: number; kind: number; x: number; y: number; flags: number }
export interface PickupEvent { gameId: number; kind: number }
/** A hit that waits for `applyHits`. */
export interface PendingHit { e: Entity; gameId: number; dmg: number; source: number; traits: number }
/** A mob whose hp changed in resolve.damage. */
export interface HpChange { e: Entity; gameId: number; prev: number }

export interface Events {
  hits: HitEvent[]
  kills: KillEvent[]
  pickedUp: PickupEvent[]
  levels: number[]
  pending: PendingHit[]
  changed: HpChange[]
  orphans: Entity[] // children of the summoners that died, for cleanup.cascade
  evolved: [from: number, to: number][]
  picked: boolean // a pick changed the held list, for progress.apply
}

export const createEvents = (): Events => ({
  hits: [], kills: [], pickedUp: [], levels: [], pending: [], changed: [], orphans: [], evolved: [], picked: false,
})

/** Counts an event of `type` (a kernel EVENT) in the totals. */
export const pushEvent = (ctx: Ctx, type: number): void => {
  const { evt } = ctx.world.get(Totals)!
  evt[type] = (evt[type] + 1) | 0
}

/** Empties the four event lists. `spawn.wave` does it at the start of a tick. */
export const clearEvents = (events: Events): void => {
  events.hits.length = events.kills.length = events.pickedUp.length = events.levels.length = 0
}

/** Drops every list of the discarded ticks, so that nothing of them reaches the next tick. `load` does it. */
export const discardEvents = (events: Events): void => {
  clearEvents(events)
  events.pending.length = events.changed.length = events.orphans.length = events.evolved.length = 0
  events.picked = false
}
