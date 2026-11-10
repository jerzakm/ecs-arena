// The held upgrades of the player (one Held entity each) and the weapon and stat blocks that they give (SPEC-survivors §6.10).
import { addComponent, query } from 'bitecs'
import type { survivors } from '@ecs-arena/spec'
import { Held } from './components.ts'
import type { Ctx } from './context.ts'
import { destroy, flush, newEntity } from './entities.ts'
import { Q } from './queries.ts'

export type HeldEntry = survivors.kernel.Held

/** What the held list gives. `weapons` is indexed by upgrade id. */
export interface Loadout {
  weapons: (survivors.kernel.WeaponStats | undefined)[]
  stats: survivors.kernel.Stats
}

export const spawnHeld = (ctx: Ctx, h: HeldEntry): number => {
  const e = newEntity(ctx)
  addComponent(ctx.world, e, Held)
  Held.id[e] = h.id; Held.level[e] = h.level; Held.cd[e] = h.cd
  return e
}

/** The held list, in ascending upgrade id. */
export const heldList = (ctx: Ctx): HeldEntry[] =>
  Array.from(query(ctx.world, Q.held), (e) => ({ id: Held.id[e], level: Held.level[e], cd: Held.cd[e] })).sort((a, b) => a.id - b.id)

/** The held entities, in ascending upgrade id. */
export const heldEntities = (ctx: Ctx): number[] => Array.from(query(ctx.world, Q.held)).sort((a, b) => Held.id[a] - Held.id[b])

/** Makes the held entities equal to `list`. The removed ones go first, so that a new one takes their ids in the same order. */
export const setHeld = (ctx: Ctx, list: HeldEntry[]): void => {
  const have = new Map<number, number>()
  for (const e of query(ctx.world, Q.held)) have.set(Held.id[e], e)
  const want = new Set(list.map((h) => h.id))
  for (const [id, e] of have) if (!want.has(id)) destroy(ctx, e)
  flush(ctx)
  for (const h of list) {
    const e = have.get(h.id)
    if (e === undefined) spawnHeld(ctx, h)
    else { Held.level[e] = h.level; Held.cd[e] = h.cd }
  }
}

/** Derives the weapon and stat blocks from the held list. */
export const refreshLoadout = (ctx: Ctx): void => {
  const d = ctx.k.deriveLoadout(heldList(ctx))
  ctx.loadout.weapons = []
  for (const w of d.weapons) ctx.loadout.weapons[w.id] = w
  ctx.loadout.stats = d.stats
}
