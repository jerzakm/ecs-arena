import { survivors } from '@ecs-arena/spec'
import type { Ctx } from '../context.ts'
import { makeProj, near } from '../entities.ts'
import { aoe, applyHitsFor, hit } from '../hits.ts'
import { ENT } from '../types.ts'
const { TRAIT } = survivors.kernel
type Stats = survivors.kernel.WeaponStats
const shoot = (ctx: Ctx, st: Stats, x: number, y: number, vx: number, vy: number, target: number) => {
  const { k, scenario, tick } = ctx
  const traits = k.scaleTraits(st.traits, scenario.traitScale)
  makeProj(ctx, {
    weapon: st.id, owner: k.PLAYER_ID, traits, x, y, vx, vy, ttl: tick + st.life,
    pierceLeft: (traits & TRAIT.PIERCE ? k.PIERCE_BUDGET : 0) + (traits & TRAIT.CHAIN ? k.CHAIN_BUDGET : 0),
    bounceLeft: traits & TRAIT.BOUNCE ? k.BOUNCE_BUDGET : 0, hitMask: 0, target,
  })
}
/** Fires the shots of one weapon. Returns false when the weapon cannot fire. */
const fire = (ctx: Ctx, st: Stats): boolean => {
  const { k, scenario, tick, px, py } = ctx
  const aim = st.aim
  if (aim === 'nearest') {
    ctx.resendGrid()
    const cands = near(ctx, px, py, k.NEAREST_RANGE).filter((m) => !ctx.tags.blocked(m, k.IMMUNE_HIT))
    if (cands.length === 0) return false
    const d = (m: { x: number; y: number }) => k.distSq(px, py, m.x, m.y)
    cands.sort((a, b) => d(a) - d(b) || a.gameId - b.gameId)
    for (let i = 0; i < st.count; i++) {
      const c = cands[i % cands.length]
      const [vx, vy] = k.velToward(px, py, c.x, c.y, st.speed)
      shoot(ctx, st, px, py, vx, vy, c.gameId)
    }
    return true
  }
  for (let i = 0; i < st.count; i++) {
    if (aim === 'random') {
      const [vx, vy] = k.randomAimVel(scenario.seed, tick, st.id, i, st.speed)
      shoot(ctx, st, px, py, vx, vy, -1)
    } else if (aim === 'facing') {
      const [fx, fy] = k.facing(tick)
      const reach = (i % 2 === 0 ? 1 : -1) * (k.FACING_NEAR + k.FACING_STEP * (i >> 1))
      shoot(ctx, st, k.clampToArena(px + k.fx.mul(fx, reach)), k.clampToArena(py + k.fx.mul(fy, reach)), 0, 0, -1)
    } else if (aim === 'drop' || aim === 'rain') {
      const [x, y] = k.scatterPoint(scenario.seed, tick, aim, st.id, i, px, py)
      shoot(ctx, st, x, y, 0, 0, -1)
    }
  }
  return true
}
export const weaponSystems: Pick<survivors.SystemTable<Ctx>, 'weapon.fire' | 'weapon.orbit' | 'weapon.pulse'> = {
  'weapon.fire': (ctx) => () => {
    const { k } = ctx
    for (let i = 0; i < ctx.held.length; i++) {
      const h = ctx.held[i]
      const aim = k.aimOf(h.id)
      if (aim === null || aim === 'orbit' || aim === 'aura') continue
      if (h.cd > 0) h.cd -= 1
      if (h.cd === 0 && fire(ctx, ctx.wstat[h.id]!)) h.cd = ctx.wstat[h.id]!.cooldown
    }
  },
  'weapon.orbit': (ctx) => {
    const { k } = ctx
    const { gate } = ctx.gates
    return () => {
      const { tick, px, py } = ctx
      const any = () => ctx.lists[ENT.PROJ].some((p) => !p.dead && p.weapon >= 0 && k.aimOf(p.weapon) === 'orbit')
      if (!gate('weapon.orbit', ctx.hasOrbit, any)) return
      for (let i = 0; i < ctx.held.length; i++) {
        const id = ctx.held[i].id
        if (k.aimOf(id) !== 'orbit') continue
        const orbiters = ctx.lists[ENT.PROJ].filter((p) => p.weapon === id && !p.dead)
        for (let s = 0; s < orbiters.length; s++) {
          const p = orbiters[s]
          ;[p.x, p.y] = k.ringPoint(px, py, k.ORBIT_RADIUS, (tick * k.ORBIT_STEP + k.fx.div(s * 256, orbiters.length)) & 255)
          if ((tick + p.gameId) % k.ORBIT_REARM === 0) p.hitMask = 0
        }
      }
    }
  },
  'weapon.pulse': (ctx) => {
    const { k } = ctx
    const { blocked } = ctx.tags
    const { gate } = ctx.gates
    const applyHits = applyHitsFor(ctx)
    return () => {
      const { px, py } = ctx
      if (!gate('weapon.pulse', ctx.hasAura, () => ctx.held.some((h) => k.aimOf(h.id) === 'aura'))) return
      for (let i = 0; i < ctx.held.length; i++) {
        const h = ctx.held[i]
        if (k.aimOf(h.id) !== 'aura') continue
        if (h.cd > 0) h.cd -= 1
        if (h.cd > 0) continue
        const st = ctx.wstat[h.id]!
        ctx.resendGrid()
        const hits = aoe(ctx, px, py, st.area)
        for (let j = 0; j < hits.length; j++) if (!blocked(hits[j], k.IMMUNE_HIT)) hit(ctx, hits[j], st.damage, k.PLAYER_ID, st.traits)
        h.cd = st.cooldown
      }
      applyHits()
    }
  },
}
