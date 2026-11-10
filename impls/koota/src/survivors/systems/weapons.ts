import type { Entity } from 'koota'
import { survivors } from '@ecs-arena/spec'
import { makeProj, near } from '../entities.ts'
import { applyHits, queueHit } from '../hits.ts'
import { heldList } from '../loadout.ts'
import { Clock, Held, Loadout, Position, Projectile } from '../traits.ts'
import { immune } from '../tags.ts'
import { byGameId, byNearest, pushTo } from '../../shared/util.ts'
import type { Ctx } from '../context.ts'

const { TRAIT } = survivors.kernel

const shoot = (ctx: Ctx, st: survivors.kernel.WeaponStats, x: number, y: number, vx: number, vy: number, target?: Entity) => {
  const { k, scenario, world } = ctx
  const traits = k.scaleTraits(st.traits, scenario.traitScale)
  makeProj(ctx, {
    weapon: st.id, owner: ctx.player, traits, x, y, vx, vy, ttl: world.get(Clock)!.tick + st.life,
    pierceLeft: (traits & TRAIT.PIERCE ? k.PIERCE_BUDGET : 0) + (traits & TRAIT.CHAIN ? k.CHAIN_BUDGET : 0),
    bounceLeft: traits & TRAIT.BOUNCE ? k.BOUNCE_BUDGET : 0, target,
  })
}

/** Fires the shots of one weapon. Returns false when the weapon cannot fire. */
const fire = (ctx: Ctx, st: survivors.kernel.WeaponStats): boolean => {
  const { k, scenario, world } = ctx
  const { tick } = world.get(Clock)!
  const { x: px, y: py } = ctx.player.get(Position)!
  const aim = st.aim
  if (aim === 'nearest') {
    const cands = near(ctx, px, py, k.NEAREST_RANGE).filter((c) => !immune(ctx.mobAt[c.h]))
    if (cands.length === 0) return false
    cands.sort(byNearest)
    for (let i = 0; i < st.count; i++) {
      const target = ctx.mobAt[cands[i % cands.length].h]
      const c = target.get(Position)!
      const [vx, vy] = k.velToward(px, py, c.x, c.y, st.speed)
      shoot(ctx, st, px, py, vx, vy, target)
    }
    return true
  }
  for (let i = 0; i < st.count; i++) {
    if (aim === 'random') {
      const [vx, vy] = k.randomAimVel(scenario.seed, tick, st.id, i, st.speed)
      shoot(ctx, st, px, py, vx, vy)
    } else if (aim === 'facing') {
      const [fx, fy] = k.facing(tick)
      const reach = (i % 2 === 0 ? 1 : -1) * (k.FACING_NEAR + k.FACING_STEP * (i >> 1))
      shoot(ctx, st, k.clampToArena(px + k.fx.mul(fx, reach)), k.clampToArena(py + k.fx.mul(fy, reach)), 0, 0)
    } else if (aim === 'drop' || aim === 'rain') {
      const [x, y] = k.scatterPoint(scenario.seed, tick, aim, st.id, i, px, py)
      shoot(ctx, st, x, y, 0, 0)
    }
  }
  return true
}

export const weaponSystems: Pick<survivors.SystemTable<Ctx>, 'weapon.fire' | 'weapon.orbit' | 'weapon.pulse'> = {
  'weapon.fire': (ctx) => () => {
    const { k, world } = ctx
    const { weapons } = world.get(Loadout)!
    for (const h of heldList(ctx)) {
      const aim = k.aimOf(h.id)
      if (aim === null || aim === 'orbit' || aim === 'aura') continue
      const st = weapons[h.id]!
      let cd = h.cd
      if (cd > 0) cd -= 1
      if (cd === 0 && fire(ctx, st)) cd = st.cooldown
      if (cd !== h.cd) h.e.set(Held, { cd })
    }
  },
  'weapon.orbit': (ctx) => () => {
    const { k, world } = ctx
    const { tick } = world.get(Clock)!
    const { x: px, y: py } = ctx.player.get(Position)!
    // Every projectile of an orbit weapon takes a slot, a split child of an orbiter included (the baseline does,
    // and the goldens follow it).
    const orbiters: { e: Entity; gameId: number; weapon: number }[] = []
    world.query(ctx.q.friendly).readEach(([p, g], e) => {
      if (k.aimOf(p.weapon) === 'orbit') orbiters.push({ e, gameId: g.id, weapon: p.weapon })
    })
    if (orbiters.length === 0) return
    orbiters.sort(byGameId)
    const byWeapon = new Map<number, typeof orbiters>()
    for (const o of orbiters) pushTo(byWeapon, o.weapon, o)
    for (const h of heldList(ctx)) {
      const list = byWeapon.get(h.id)
      if (!list || k.aimOf(h.id) !== 'orbit') continue
      list.forEach((o, s) => {
        const [x, y] = k.ringPoint(px, py, k.ORBIT_RADIUS, (tick * k.ORBIT_STEP + k.fx.div(s * 256, list.length)) & 255)
        o.e.set(Position, { x, y })
        if ((tick + o.gameId) % k.ORBIT_REARM === 0) o.e.set(Projectile, { hitMask: 0 })
      })
    }
  },
  'weapon.pulse': (ctx) => () => {
    const { k, world } = ctx
    const { weapons } = world.get(Loadout)!
    const { x: px, y: py } = ctx.player.get(Position)!
    for (const h of heldList(ctx)) {
      if (k.aimOf(h.id) !== 'aura') continue
      let cd = h.cd
      if (cd > 0) cd -= 1
      if (cd === 0) {
        const st = weapons[h.id]!
        for (const c of near(ctx, px, py, st.area)) {
          const m = ctx.mobAt[c.h]
          if (!immune(m)) queueHit(ctx, m, c.gameId, st.damage, k.PLAYER_ID, st.traits)
        }
        cd = st.cooldown
      }
      if (cd !== h.cd) h.e.set(Held, { cd })
    }
    applyHits(ctx)
  },
}
