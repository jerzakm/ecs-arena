// The per-tick lists. The event lists of SPEC-survivors §3.3 are flat lists of ints that go to the systems of the next phases,
// and `pushEvent` counts each event in the totals. The other lists carry work from one system of a tick to a later one.
import { survivors } from '@ecs-arena/spec'
import type { Ctx } from './context.ts'

const { EVENT } = survivors.kernel

/** Ints that each event of a type takes in its flat list.
 * HIT: mob gameId, traits. KILL: gameId, kind, x, y, flags. STATUS: mob gameId. PICKUP: gameId, kind. LEVELUP: level. */
const STRIDE = [2, 5, 1, 2, 1]

export interface HitEvent { gameId: number; traits: number }
export interface KillEvent { gameId: number; kind: number; x: number; y: number; flags: number }
export interface PickupEvent { gameId: number; kind: number }
/** A hit that waits for `applyHits`: the mob, the stat block damage, the source of the crit draw and the traits of the HIT event. */
export interface PendingHit { m: number; dmg: number; source: number; traits: number }

export interface Events {
  lists: number[][] // flat, by event type
  pending: PendingHit[]
  changed: number[] // mobs whose hp changed in resolve.damage
  evolved: [from: number, to: number][]
  picked: boolean // a pick changed the held list, for progress.apply
}

export const createEvents = (): Events => ({
  lists: Array.from({ length: survivors.kernel.EVENT_COUNT }, () => []), pending: [], changed: [], evolved: [], picked: false,
})

/** Counts an event of `type` (a kernel EVENT) in the totals and appends its ints to the list. */
export const pushEvent = (ctx: Ctx, type: number, a: number, b = 0, c = 0, d = 0, e = 0): void => {
  const { evt } = ctx.totals
  evt[type] = (evt[type] + 1) | 0
  const l = ctx.events.lists[type]
  l.push(a)
  if (STRIDE[type] > 1) l.push(b)
  if (STRIDE[type] > 2) l.push(c, d, e)
}

/** Empties the event lists. `spawn.wave` does it at the start of a tick. */
export const clearEvents = (events: Events): void => {
  for (const l of events.lists) l.length = 0
}

/** Drops every list of the discarded ticks, so that nothing of them reaches the next tick. `load` does it. */
export const discardEvents = (events: Events): void => {
  clearEvents(events)
  events.pending.length = events.changed.length = events.evolved.length = 0
  events.picked = false
}

export const hitEvents = (events: Events): HitEvent[] => {
  const l = events.lists[EVENT.HIT], out: HitEvent[] = []
  for (let i = 0; i < l.length; i += STRIDE[EVENT.HIT]) out.push({ gameId: l[i], traits: l[i + 1] })
  return out
}
export const killEvents = (events: Events): KillEvent[] => {
  const l = events.lists[EVENT.KILL], out: KillEvent[] = []
  for (let i = 0; i < l.length; i += STRIDE[EVENT.KILL]) {
    out.push({ gameId: l[i], kind: l[i + 1], x: l[i + 2], y: l[i + 3], flags: l[i + 4] })
  }
  return out
}
export const pickupEvents = (events: Events): PickupEvent[] => {
  const l = events.lists[EVENT.PICKUP], out: PickupEvent[] = []
  for (let i = 0; i < l.length; i += STRIDE[EVENT.PICKUP]) out.push({ gameId: l[i], kind: l[i + 1] })
  return out
}
/** The levels reached, one for each LEVELUP event. */
export const levelEvents = (events: Events): readonly number[] => events.lists[EVENT.LEVELUP]
