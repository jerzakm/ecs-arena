// The held upgrades of the player (one Held entity each) and the weapon and stat blocks that they give (SPEC-survivors §6.10).
import type { Entity } from 'koota'
import type { Ctx } from './context.ts'
import { Loadout } from './traits.ts'

/** One record of the held list. */
export interface HeldRec { e: Entity; id: number; level: number; cd: number }

const byUpgradeId = (a: HeldRec, b: HeldRec) => a.id - b.id

/** The held upgrades in ascending id order. */
export const heldList = (ctx: Ctx): HeldRec[] => {
  const out: HeldRec[] = []
  ctx.world.query(ctx.q.held).readEach(([h], e) => void out.push({ e, id: h.id, level: h.level, cd: h.cd }))
  return out.sort(byUpgradeId)
}

/** Derives the Loadout world trait from the held list. */
export const refreshLoadout = (ctx: Ctx): void => {
  const d = ctx.k.deriveLoadout(heldList(ctx))
  const weapons: (typeof d.weapons)[number][] = []
  for (const w of d.weapons) weapons[w.id] = w
  ctx.world.set(Loadout, { weapons, stats: d.stats })
}
