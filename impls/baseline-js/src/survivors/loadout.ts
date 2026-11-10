// The weapon and stat blocks that the held upgrades give (SPEC-survivors §6.10), and the flags that gate the weapon systems.
import type { CtxData } from './context.ts'

/** Derives the loadout from `ctx.held`. `count` is false for the calls that `createSim` and `load` make, which the counter skips. */
export const refreshLoadout = (ctx: CtxData, count: boolean) => {
  const { k } = ctx
  const d = k.deriveLoadout(ctx.held)
  ctx.wstat = []
  for (const w of d.weapons) ctx.wstat[w.id] = w
  ctx.pstat = d.stats
  const aims = d.weapons.map((w) => w.aim)
  ctx.hasOrbit = aims.includes('orbit')
  ctx.hasAura = aims.includes('aura')
  ctx.hasExplode = d.weapons.some((w) => w.traits & k.TRAIT.EXPLODE)
  if (count) ctx.add('loadout.derive')
}
