import { collectEntities, getComponentValue, setComponentValue } from 'iris-ecs'
import { survivors } from '@ecs-arena/spec'
import { GameId } from '../../shared/components.ts'
import { byGameId } from '../../shared/util.ts'
import { Held, Position, Projectile } from '../components.ts'
import type { Ctx } from '../context.ts'
import { makeProj, near } from '../entities.ts'
import { applyHits, queueHit } from '../hits.ts'
import { heldList } from '../loadout.ts'
import { orbiters } from '../queries.ts'
import { immune } from '../tags.ts'

const { TRAIT } = survivors.kernel
type Stats = survivors.kernel.WeaponStats

const shoot = (ctx: Ctx, st: Stats, x: number, y: number, vx: number, vy: number, target: number) => {
  const { k, scenario, tick } = ctx
  const traits = k.scaleTraits(st.traits, scenario.traitScale)
  makeProj(ctx, {
    weapon: st.id, owner: k.PLAYER_ID, traits, x, y, vx, vy, ttl: tick + st.life,
    pierceLeft: (traits & TRAIT.PIERCE ? k.PIERCE_BUDGET : 0) + (traits & TRAIT.CHAIN ? k.CHAIN_BUDGET : 0),
    bounceLeft: traits & TRAIT.BOUNCE ? k.BOUNCE_BUDGET : 0, target,
  })
}

/** Fires the shots of one weapon. Returns false when the weapon cannot fire. */
const fire = (ctx: Ctx, st: Stats): boolean => {
  const { k, world, scenario, tick, px, py, mobs } = ctx
  const aim = st.aim
  if (aim === 'nearest') {
    const cands = near(ctx, px, py, k.NEAREST_RANGE)
      .filter((h) => !immune(world, mobs.entityAt[h]))
      .map((h) => {
        const e = mobs.entityAt[h]
        return { id: mobs.idAt[h], e, x: getComponentValue(world, e, Position, 'x')!, y: getComponentValue(world, e, Position, 'y')! }
      })
    if (cands.length === 0) return false
    const d = (m: { x: number; y: number }) => k.distSq(px, py, m.x, m.y)
    cands.sort((a, b) => d(a) - d(b) || a.id - b.id)
    for (let i = 0; i < st.count; i++) {
      const c = cands[i % cands.length]
      const [vx, vy] = k.velToward(px, py, c.x, c.y, st.speed)
      shoot(ctx, st, px, py, vx, vy, c.id)
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
    const { k, world } = ctx
    for (const h of heldList(ctx)) {
      const aim = k.aimOf(h.id)
      if (aim === null || aim === 'orbit' || aim === 'aura') continue
      let cd = h.cd
      if (cd > 0) cd -= 1
      if (cd === 0) {
        const st = ctx.loadout.weapons[h.id]!
        if (fire(ctx, st)) cd = st.cooldown
      }
      if (cd !== h.cd) setComponentValue(world, h.e, Held, 'cd', cd)
    }
  },
  'weapon.orbit': (ctx) => () => {
    const { k, tick, px, py, world } = ctx
    const all = collectEntities(world, orbiters)
    if (all.length === 0) return
    const byWeapon = new Map<number, { id: number; e: (typeof all)[number] }[]>()
    for (const e of all) {
      const w = getComponentValue(world, e, Projectile, 'weapon')
      const list = byWeapon.get(w)
      const row = { id: getComponentValue(world, e, GameId, 'id'), e }
      if (list) list.push(row)
      else byWeapon.set(w, [row])
    }
    for (const list of byWeapon.values()) {
      list.sort(byGameId)
      for (let s = 0; s < list.length; s++) {
        const { id, e } = list[s]
        const [x, y] = k.ringPoint(px, py, k.ORBIT_RADIUS, (tick * k.ORBIT_STEP + k.fx.div(s * 256, list.length)) & 255)
        setComponentValue(world, e, Position, 'x', x)
        setComponentValue(world, e, Position, 'y', y)
        if ((tick + id) % k.ORBIT_REARM === 0) setComponentValue(world, e, Projectile, 'hitMask', 0)
      }
    }
  },
  'weapon.pulse': (ctx) => () => {
    const { k, world, px, py, mobs } = ctx
    let fired = false
    for (const h of heldList(ctx)) {
      if (k.aimOf(h.id) !== 'aura') continue
      fired = true
      let cd = h.cd
      if (cd > 0) cd -= 1
      if (cd > 0) { setComponentValue(world, h.e, Held, 'cd', cd); continue }
      const st = ctx.loadout.weapons[h.id]!
      for (const handle of near(ctx, px, py, st.area)) {
        const e = mobs.entityAt[handle]
        if (!immune(world, e)) queueHit(ctx, e, st.damage, k.PLAYER_ID, st.traits)
      }
      setComponentValue(world, h.e, Held, 'cd', st.cooldown)
    }
    if (fired) applyHits(ctx)
  },
}
