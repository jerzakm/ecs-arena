// The per-tick lists. The event lists of SPEC-survivors §3.3 (hits, kills, status, pickups, level-ups) go to the systems of the next
// phases, and each push counts the event in the totals. The other lists carry work from one system of a tick to a later one.
import { type EntityId, getResourceValue } from 'iris-ecs'
import { survivors } from '@ecs-arena/spec'
import { Run } from './components.ts'
import type { Ctx } from './context.ts'

const { EVENT } = survivors.kernel

/** Ints that each event of a type takes in its flat list. */
export const STRIDE = { HIT: 2, KILL: 5, STATUS: 1, PICKUP: 2, LEVELUP: 1 } as const

/** A hit that waits for `applyHits`. */
export interface PendingHit { e: EntityId; gameId: number; dmg: number; source: number; traits: number }
/** A mob whose hp changed in resolve.damage. */
export interface HpChange { e: EntityId; hp0: number }

export interface Events {
  /**
   * One flat list for each EVENT type. HIT: mob gameId, traits. KILL: gameId, kind, x, y, flags. STATUS: mob gameId. PICKUP: gameId, kind.
   * LEVELUP: level.
   */
  lists: number[][]
  pending: PendingHit[]
  changed: HpChange[]
  evolved: [from: number, to: number][]
  picked: boolean // a pick changed the held list, for progress.apply
}

export const createEvents = (): Events => ({
  lists: Array.from({ length: survivors.kernel.EVENT_COUNT }, () => []), pending: [], changed: [], evolved: [], picked: false,
})

/** Counts an event of `type` (a kernel EVENT) in the totals. */
const count = (ctx: Ctx, type: number): void => {
  const evt = getResourceValue(ctx.world, Run, 'evt')!
  evt[type] = (evt[type] + 1) | 0
}

export const pushHit = (ctx: Ctx, gameId: number, traits: number): void => {
  count(ctx, EVENT.HIT)
  ctx.events.lists[EVENT.HIT].push(gameId, traits)
}

export const pushKill = (ctx: Ctx, gameId: number, kind: number, x: number, y: number, flags: number): void => {
  count(ctx, EVENT.KILL)
  ctx.events.lists[EVENT.KILL].push(gameId, kind, x, y, flags)
}

export const pushStatus = (ctx: Ctx, gameId: number): void => {
  count(ctx, EVENT.STATUS)
  ctx.events.lists[EVENT.STATUS].push(gameId)
}

export const pushPickup = (ctx: Ctx, gameId: number, kind: number): void => {
  count(ctx, EVENT.PICKUP)
  ctx.events.lists[EVENT.PICKUP].push(gameId, kind)
}

export const pushLevelUp = (ctx: Ctx, level: number): void => {
  count(ctx, EVENT.LEVELUP)
  ctx.events.lists[EVENT.LEVELUP].push(level)
}

/** Empties the event lists. `spawn.wave` does it at the start of a tick. */
export const clearLists = (events: Events): void => {
  for (const list of events.lists) list.length = 0
}

/** Drops every list of the discarded ticks, so that nothing of them reaches the next tick. `load` does it. */
export const discardEvents = (events: Events): void => {
  clearLists(events)
  events.pending.length = events.changed.length = events.evolved.length = 0
  events.picked = false
}
