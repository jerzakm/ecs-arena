import type { Entity } from 'koota'
import { survivors } from '@ecs-arena/spec'
import { makeProj, near } from '../entities.ts'
import { applyHits, hurtPlayer, queueHit } from '../hits.ts'
import { Clock, Incoming, Iframes, Loadout, Position, Projectile, Targets, Vampiric, Velocity } from '../traits.ts'
import { immune, markDying, traitsOf } from '../tags.ts'
import { byGameId, byNearest } from '../../shared/util.ts'
import type { Ctx } from '../context.ts'

const { TRAIT, MOBS } = survivors.kernel
const REACH = Math.max(...MOBS.map((m) => m.radius))

interface Shot {
  e: Entity; gameId: number; weapon: number; x: number; y: number; vx: number; vy: number
  pierce: number; bounce: number; hitMask: number; traits: number; dirty: boolean; dead: boolean
}
const bitSet = (mask: number, id: number) => ((mask >>> (id & 31)) & 1) === 1

/** The nearest mob within chain range of the shot that it has not hit yet, other than the one it just hit. */
const nextChainTarget = (ctx: Ctx, p: Shot, hitId: number) => {
  const inReach = near(ctx, p.x, p.y, ctx.k.CHAIN_RANGE)
  const cands = inReach.filter((o) => o.gameId !== hitId && !bitSet(p.hitMask, o.gameId) && !immune(ctx.mobAt[o.h]))
  return cands.sort(byNearest)[0]
}

export const combatSystems: Pick<survivors.SystemTable<Ctx>, 'combat.hit' | 'combat.hostile' | 'combat.contact' | 'combat.explode'> = {
  'combat.hit': (ctx) => () => {
    const { k, world } = ctx
    const { tick } = world.get(Clock)!
    const { weapons } = world.get(Loadout)!
    const shots: Shot[] = []
    world.query(ctx.q.friendly).readEach(([pr, g, p, v], e) => {
      shots.push({
        e, gameId: g.id, weapon: pr.weapon, x: p.x, y: p.y, vx: v.x, vy: v.y,
        pierce: pr.pierceLeft, bounce: pr.bounceLeft, hitMask: pr.hitMask, traits: 0, dirty: false, dead: false,
      })
    })
    shots.sort(byGameId)
    for (const p of shots) {
      p.traits = traitsOf(p.e)
      if (p.traits & TRAIT.EXPLODE && p.pierce < 0) continue
      const st = weapons[p.weapon]!
      const r = k.hitRadius(st.area)
      const cands: { h: number; gameId: number }[] = []
      ctx.grid.forNear(p.x, p.y, r + REACH, (h, d2, gameId) => {
        const rr = r + MOBS[ctx.kindAt[h]].radius
        if (d2 <= rr * rr && !bitSet(p.hitMask, gameId) && !immune(ctx.mobAt[h])) cands.push({ h, gameId })
      })
      cands.sort(byGameId)
      const orbiter = k.aimOf(p.weapon) === 'orbit'
      for (let c = 0; c < cands.length && !p.dead; c++) {
        const m = cands[c]
        p.hitMask |= 1 << (m.gameId & 31)
        p.dirty = true
        if (p.traits & TRAIT.EXPLODE) { p.pierce = -1; break }
        queueHit(ctx, ctx.mobAt[m.h], m.gameId, st.damage, p.gameId, p.traits)
        if (p.traits & TRAIT.SPLIT) {
          for (const [vx, vy] of [[-p.vy, p.vx], [p.vy, -p.vx]]) {
            makeProj(ctx, {
              weapon: p.weapon, owner: ctx.player, traits: p.traits & ~TRAIT.SPLIT, x: p.x, y: p.y, vx, vy,
              ttl: tick + k.SPLIT_LIFE, pierceLeft: 0, bounceLeft: 0,
            })
          }
        }
        if (orbiter) continue
        if (p.traits & TRAIT.CHAIN) {
          const next = p.pierce > 0 ? nextChainTarget(ctx, p, m.gameId) : undefined
          if (next) {
            const target = ctx.mobAt[next.h]
            const t = target.get(Position)!
            p.pierce -= 1
            ;[p.vx, p.vy] = k.velToward(p.x, p.y, t.x, t.y, st.speed)
            p.e.add(Targets(target))
          } else { p.e.destroy(); p.dead = true }
        } else if (p.pierce > 0) p.pierce -= 1
        else if (p.bounce > 0) { p.bounce -= 1; p.vx = -p.vx; p.vy = -p.vy }
        else { p.e.destroy(); p.dead = true }
      }
    }
    for (const p of shots) {
      if (p.dead || !p.dirty) continue
      p.e.set(Projectile, { pierceLeft: p.pierce, bounceLeft: p.bounce, hitMask: p.hitMask })
      p.e.set(Velocity, { x: p.vx, y: p.vy })
    }
    applyHits(ctx)
  },
  'combat.hostile': (ctx) => () => {
    const { k, world, player } = ctx
    const reach = k.PLAYER_RADIUS + k.HOSTILE_HIT_PAD
    const hit: Entity[] = []
    const pp = player.get(Position)!
    world.query(ctx.q.hostile).readEach(([p], e) => {
      if (k.distSq(p.x, p.y, pp.x, pp.y) <= reach * reach) hit.push(e)
    })
    for (const e of hit) {
      if (!player.has(Iframes)) hurtPlayer(ctx, k.HOSTILE_DAMAGE)
      e.destroy()
    }
  },
  'combat.contact': (ctx) => () => {
    const { k, world, player } = ctx
    const pp = player.get(Position)!
    const touch: { e: Entity; gameId: number; contact: number }[] = []
    world.query(ctx.q.touching).readEach(([g, p, kind], e) => {
      const def = MOBS[kind.value]
      const r = def.radius + k.PLAYER_RADIUS
      if (def.contact > 0 && k.distSq(p.x, p.y, pp.x, pp.y) <= r * r) touch.push({ e, gameId: g.id, contact: def.contact })
    })
    touch.sort(byGameId)
    for (const m of touch) {
      if (player.has(Iframes)) continue
      hurtPlayer(ctx, m.contact)
      if (m.e.has(Vampiric)) m.e.set(Incoming, { heal: m.e.get(Incoming)!.heal + k.VAMPIRIC_HEAL })
    }
  },
  'combat.explode': (ctx) => () => {
    const { k, world } = ctx
    const { tick } = world.get(Clock)!
    const { weapons } = world.get(Loadout)!
    const fused: Entity[] = []
    world.query(ctx.q.fused).readEach(([f], e) => { if (f.until <= tick) fused.push(e) })
    for (const e of fused) markDying(e)
    const due: { e: Entity; gameId: number; weapon: number; x: number; y: number }[] = []
    world.query(ctx.q.exploders).readEach(([pr, g, p, ttl], e) => {
      if (pr.pierceLeft < 0 || ttl.value <= tick) due.push({ e, gameId: g.id, weapon: pr.weapon, x: p.x, y: p.y })
    })
    due.sort(byGameId)
    for (const p of due) {
      const st = weapons[p.weapon]!
      const traits = traitsOf(p.e)
      for (const c of near(ctx, p.x, p.y, k.BLAST_RADIUS + REACH)) {
        const rr = k.BLAST_RADIUS + MOBS[ctx.kindAt[c.h]].radius
        const m = ctx.mobAt[c.h]
        if (c.d2 <= rr * rr && !immune(m)) queueHit(ctx, m, c.gameId, st.damage, p.gameId, traits)
      }
      p.e.destroy()
    }
    applyHits(ctx)
  },
}
