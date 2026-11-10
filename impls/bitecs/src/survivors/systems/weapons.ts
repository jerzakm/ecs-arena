import { query } from 'bitecs'
import { survivors } from '@ecs-arena/spec'
import { Held, Position, Projectile } from '../components.ts'
import { GameId } from '../../shared/components.ts'
import type { Ctx } from '../context.ts'
import { makeProj, near } from '../entities.ts'
import { applyHits, queueHit } from '../hits.ts'
import { heldEntities } from '../loadout.ts'
import { Q } from '../queries.ts'
import { blocked } from '../tags.ts'
import { byGameId, sortedByGameId } from '../../shared/util.ts'
const { TRAIT } = survivors.kernel
type WeaponStats = survivors.kernel.WeaponStats
const shoot = (ctx: Ctx, st: WeaponStats, x: number, y: number, vx: number, vy: number, target: number) => {
  const { k, scenario } = ctx
  const traits = k.scaleTraits(st.traits, scenario.traitScale)
  makeProj(ctx, {
    weapon: st.id, owner: k.PLAYER_ID, traits, x, y, vx, vy, ttl: ctx.world.tick + st.life,
    pierceLeft: (traits & TRAIT.PIERCE ? k.PIERCE_BUDGET : 0) + (traits & TRAIT.CHAIN ? k.CHAIN_BUDGET : 0),
    bounceLeft: traits & TRAIT.BOUNCE ? k.BOUNCE_BUDGET : 0, hitMask: 0, target,
  })
}
/** Fires the shots of one weapon. Returns false when the weapon cannot fire. */
const fire = (ctx: Ctx, st: WeaponStats): boolean => {
  const { k, scenario, px, py } = ctx
  const tick = ctx.world.tick
  const aim = st.aim
  if (aim === 'nearest') {
    const cands = near(ctx, px, py, k.NEAREST_RANGE).filter((m) => !blocked(m, k.IMMUNE_HIT))
    if (cands.length === 0) return false
    const d = (m: number) => k.distSq(px, py, Position.x[m], Position.y[m])
    cands.sort((a, b) => d(a) - d(b) || byGameId(a, b))
    for (let i = 0; i < st.count; i++) {
      const c = cands[i % cands.length]
      const [vx, vy] = k.velToward(px, py, Position.x[c], Position.y[c], st.speed)
      shoot(ctx, st, px, py, vx, vy, GameId.id[c])
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
type WeaponIds = 'weapon.fire' | 'weapon.orbit' | 'weapon.pulse'
export const weaponSystems: Pick<survivors.SystemTable<Ctx>, WeaponIds> = {
  'weapon.fire': (ctx) => () => {
    const { k } = ctx
    for (const h of heldEntities(ctx)) {
      const id = Held.id[h]
      const aim = k.aimOf(id)
      if (aim === null || aim === 'orbit' || aim === 'aura') continue
      if (Held.cd[h] > 0) Held.cd[h] -= 1
      const st = ctx.loadout.weapons[id]!
      if (Held.cd[h] === 0 && fire(ctx, st)) Held.cd[h] = st.cooldown
    }
  },
  'weapon.orbit': (ctx) => () => {
    const { k, px, py } = ctx
    const tick = ctx.world.tick
    if (query(ctx.world, Q.orbiters).length === 0) return
    for (const h of heldEntities(ctx)) {
      const id = Held.id[h]
      if (k.aimOf(id) !== 'orbit') continue
      const orbiters = sortedByGameId(ctx, Q.orbiters).filter((p) => Projectile.weapon[p] === id)
      for (let s = 0; s < orbiters.length; s++) {
        const p = orbiters[s]
        const angle = (tick * k.ORBIT_STEP + k.fx.div(s * 256, orbiters.length)) & 255
        ;[Position.x[p], Position.y[p]] = k.ringPoint(px, py, k.ORBIT_RADIUS, angle)
        if ((tick + GameId.id[p]) % k.ORBIT_REARM === 0) Projectile.hitMask[p] = 0
      }
    }
  },
  'weapon.pulse': (ctx) => () => {
    const { k, px, py } = ctx
    for (const h of heldEntities(ctx)) {
      const id = Held.id[h]
      if (k.aimOf(id) !== 'aura') continue
      if (Held.cd[h] > 0) Held.cd[h] -= 1
      if (Held.cd[h] > 0) continue
      const st = ctx.loadout.weapons[id]!
      const hits = near(ctx, px, py, st.area).sort(byGameId)
      for (let j = 0; j < hits.length; j++) {
        if (!blocked(hits[j], k.IMMUNE_HIT)) queueHit(ctx, hits[j], st.damage, k.PLAYER_ID, st.traits)
      }
      Held.cd[h] = st.cooldown
    }
    applyHits(ctx)
  },
}