import {
  collectEntities, destroyEntity, type EntityId, EXPERIMENTAL_queryColumns as queryColumns, getComponentValue, hasComponent,
  setComponentValue,
} from 'iris-ecs'
import { survivors } from '@ecs-arena/spec'
import { GameId } from '../../shared/components.ts'
import { byGameId } from '../../shared/util.ts'
import { Affix, BLOCKS_ACT_TAGS, IFrames, Incoming, Position, Projectile, Velocity } from '../components.ts'
import type { Ctx } from '../context.ts'
import { distSqTo, makeProj, near } from '../entities.ts'
import { applyHits, hurtPlayer, queueHit } from '../hits.ts'
import { fuseDue, hostile, moving } from '../queries.ts'
import { hasAny, immune, markDying, traitsOf } from '../tags.ts'

const { TRAIT, AFFIX, MOBS } = survivors.kernel

/** The largest mob radius: the reach of a grid search that has to see every mob that a shape could touch. */
const MAX_RADIUS = Math.max(...MOBS.map((m) => m.radius))

/** One projectile, read from its columns. A system that changes it writes the changed fields back. */
interface Shot {
  e: EntityId; id: number; weapon: number; traits: number; x: number; y: number; vx: number; vy: number; ttl: number
  owner: number; pierce: number; bounce: number; hitMask: number; target: number
}

/** Every projectile, ascending gameId. The trait tags are the same for a whole archetype, so one tag read per archetype gives `traits`. */
const projectileRows = (ctx: Ctx): Shot[] => {
  const rows: Shot[] = []
  queryColumns(ctx.world, moving, (entities, [proj, id, pos, vel, ttl]) => {
    const traits = traitsOf(ctx.world, entities[0])
    for (let i = 0; i < entities.length; i++) {
      rows.push({
        e: entities[i], id: id.id[i], weapon: proj.weapon[i], traits, x: pos.x[i], y: pos.y[i], vx: vel.x[i], vy: vel.y[i], ttl: ttl.at[i],
        owner: proj.owner[i], pierce: proj.pierceLeft[i], bounce: proj.bounceLeft[i], hitMask: proj.hitMask[i], target: proj.target[i],
      })
    }
  })
  return rows.sort((a, b) => a.id - b.id)
}

export const combatSystems: Pick<survivors.SystemTable<Ctx>, 'combat.hit' | 'combat.hostile' | 'combat.contact' | 'combat.explode'> = {
  'combat.hit': (ctx) => {
    const reach = MAX_RADIUS
    return () => {
      const { k, world, tick, mobs } = ctx
      const bitSet = (p: Shot, id: number) => ((p.hitMask >>> (id & 31)) & 1) === 1
      for (const p of projectileRows(ctx)) {
        if (p.weapon < 0 || (p.traits & TRAIT.EXPLODE && p.pierce < 0)) continue
        const st = ctx.loadout.weapons[p.weapon]!
        const r = k.hitRadius(st.area)
        const cands: number[] = []
        mobs.grid.forNear(p.x, p.y, r + reach, (h, d2) => {
          const rr = r + k.MOBS[mobs.tagAt[h]].radius
          if (d2 <= rr * rr && !immune(world, mobs.entityAt[h]) && !bitSet(p, mobs.idAt[h])) cands.push(h)
        })
        if (cands.length === 0) continue
        cands.sort((a, b) => mobs.idAt[a] - mobs.idAt[b])
        const orbiter = k.aimOf(p.weapon) === 'orbit'
        let dead = false
        for (let c = 0; c < cands.length && !dead; c++) {
          const h = cands[c], mobId = mobs.idAt[h]
          p.hitMask |= 1 << (mobId & 31)
          if (p.traits & TRAIT.EXPLODE) { p.pierce = -1; break }
          queueHit(ctx, mobs.entityAt[h], st.damage, p.id, p.traits)
          if (p.traits & TRAIT.SPLIT) {
            for (const [vx, vy] of [[-p.vy, p.vx], [p.vy, -p.vx]])
              makeProj(ctx, {
                weapon: p.weapon, owner: p.owner, traits: p.traits & ~TRAIT.SPLIT, x: p.x, y: p.y, vx, vy, ttl: tick + k.SPLIT_LIFE,
              })
          }
          if (orbiter) continue
          if (p.traits & TRAIT.CHAIN) {
            let next = -1, best = 0
            if (p.pierce > 0) {
              mobs.grid.forNear(p.x, p.y, k.CHAIN_RANGE, (o, d2, oid) => {
                if (o === h || immune(world, mobs.entityAt[o]) || bitSet(p, oid)) return
                if (next === -1 || d2 < best || (d2 === best && oid < mobs.idAt[next])) { next = o; best = d2 }
              })
            }
            if (next !== -1) {
              p.pierce -= 1
              const t = mobs.entityAt[next]
              const tx = getComponentValue(world, t, Position, 'x')!, ty = getComponentValue(world, t, Position, 'y')!
              ;[p.vx, p.vy] = k.velToward(p.x, p.y, tx, ty, st.speed)
              p.target = mobs.idAt[next]
            } else dead = true
          } else if (p.pierce > 0) p.pierce -= 1
          else if (p.bounce > 0) { p.bounce -= 1; p.vx = -p.vx; p.vy = -p.vy }
          else dead = true
        }
        if (dead) destroyEntity(world, p.e)
        else {
          setComponentValue(world, p.e, Projectile, 'hitMask', p.hitMask)
          setComponentValue(world, p.e, Projectile, 'pierceLeft', p.pierce)
          setComponentValue(world, p.e, Projectile, 'bounceLeft', p.bounce)
          setComponentValue(world, p.e, Projectile, 'target', p.target)
          setComponentValue(world, p.e, Velocity, 'x', p.vx)
          setComponentValue(world, p.e, Velocity, 'y', p.vy)
        }
      }
      applyHits(ctx)
    }
  },
  'combat.hostile': (ctx) => () => {
    const { k, px, py, world, player } = ctx
    const reach = k.PLAYER_RADIUS + k.HOSTILE_HIT_PAD
    const shots = collectEntities(world, hostile).map((e) => ({ id: getComponentValue(world, e, GameId, 'id')!, e })).sort(byGameId)
    for (const { e } of shots) {
      if (distSqTo(ctx, e, px, py) > reach * reach) continue
      if (!hasComponent(world, player, IFrames)) hurtPlayer(ctx, k.HOSTILE_DAMAGE)
      destroyEntity(world, e)
    }
  },
  'combat.contact': (ctx) => {
    const reach = MAX_RADIUS + ctx.k.PLAYER_RADIUS
    return () => {
      const { k, world, px, py, mobs, player } = ctx
      for (const h of near(ctx, px, py, reach)) {
        const e = mobs.entityAt[h]
        const def = k.MOBS[mobs.tagAt[h]]
        const r = def.radius + k.PLAYER_RADIUS
        if (def.contact === 0 || distSqTo(ctx, e, px, py) > r * r || hasAny(world, e, BLOCKS_ACT_TAGS)) continue
        if (hasComponent(world, player, IFrames)) continue
        hurtPlayer(ctx, def.contact)
        if (getComponentValue(world, e, Affix, 'bits')! & AFFIX.VAMPIRIC) {
          setComponentValue(world, e, Incoming, 'heal', getComponentValue(world, e, Incoming, 'heal')! + k.VAMPIRIC_HEAL)
        }
      }
    }
  },
  'combat.explode': (ctx) => {
    return () => {
      const { k, tick, world, mobs } = ctx
      const lit: EntityId[] = []
      queryColumns(world, fuseDue, (entities, [fuse]) => {
        for (let i = 0; i < entities.length; i++) if (fuse.until[i] <= tick) lit.push(entities[i])
      })
      for (const e of lit) markDying(world, e)
      for (const p of projectileRows(ctx)) {
        if (p.weapon < 0 || !(p.traits & TRAIT.EXPLODE) || !(p.pierce < 0 || p.ttl <= tick)) continue
        const st = ctx.loadout.weapons[p.weapon]!
        for (const h of near(ctx, p.x, p.y, k.BLAST_RADIUS + MAX_RADIUS)) {
          const rr = k.BLAST_RADIUS + k.MOBS[mobs.tagAt[h]].radius
          const m = mobs.entityAt[h]
          if (distSqTo(ctx, m, p.x, p.y) <= rr * rr && !immune(world, m)) queueHit(ctx, m, st.damage, p.id, p.traits)
        }
        destroyEntity(world, p.e)
      }
      applyHits(ctx)
    }
  },
}
