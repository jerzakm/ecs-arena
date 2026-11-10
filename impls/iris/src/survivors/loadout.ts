// The held upgrades of the player (one Held entity each) and the weapon and stat blocks that they give (SPEC-survivors §6.10).
import { collectEntities, type EntityId, getComponentValue } from 'iris-ecs'
import { survivors } from '@ecs-arena/spec'
import { Held } from './components.ts'
import type { Ctx } from './context.ts'

/** The weapon blocks by upgrade id, and the player stats. */
export interface Loadout { weapons: (survivors.kernel.WeaponStats | undefined)[]; stats: survivors.kernel.Stats }
/** One record of the held list. */
export interface HeldRec { e: EntityId; id: number; level: number; cd: number }

const byUpgradeId = (a: HeldRec, b: HeldRec) => a.id - b.id

/** The held upgrades in ascending id order. */
export const heldList = (ctx: Ctx): HeldRec[] => {
  const { world } = ctx
  return collectEntities(world, [Held]).map((e) => ({
    e, id: getComponentValue(world, e, Held, 'id')!, level: getComponentValue(world, e, Held, 'level')!,
    cd: getComponentValue(world, e, Held, 'cd')!,
  })).sort(byUpgradeId)
}

/** Derives the loadout from the held list. */
export const refreshLoadout = (ctx: Ctx): void => {
  const d = ctx.k.deriveLoadout(heldList(ctx))
  const weapons: Loadout['weapons'] = []
  for (const w of d.weapons) weapons[w.id] = w
  ctx.loadout = { weapons, stats: d.stats }
}
