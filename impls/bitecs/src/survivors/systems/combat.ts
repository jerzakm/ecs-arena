import { query } from 'bitecs'
import { survivors, type SvKernel } from '@ecs-arena/spec'
import { Fuse, Mob, Player, Position, Projectile, Velocity } from '../components.ts'
import { GameId } from '../../shared/components.ts'
import type { Ctx } from '../context.ts'
import { destroy, flush, makeProj, near } from '../entities.ts'
import { applyHits, hurtPlayer, queueHit } from '../hits.ts'
import { Q } from '../queries.ts'
import { addTag, blocked, hasTag } from '../tags.ts'
import { byGameId, sortedByGameId } from '../../shared/util.ts'

const { TRAIT, STATUS } = survivors.kernel

const maxMobRadius = (k: SvKernel) => Math.max(...k.MOBS.map((m) => m.radius))
const alreadyHit = (p: number, m: number) => ((Projectile.hitMask[p] >>> (GameId.id[m] & 31)) & 1) === 1

type CombatIds = 'combat.hit' | 'combat.hostile' | 'combat.contact' | 'combat.explode'
export const combatSystems: Pick<survivors.SystemTable<Ctx>, CombatIds> = {
  'combat.hit': (ctx) => {
    const reach = maxMobRadius(ctx.k)
    return () => {
      const { k } = ctx
      const tick = ctx.world.tick
      // The children that this loop makes are next-phase, so the loop runs over the projectiles of the start.
      for (const p of sortedByGameId(ctx, Q.projs)) {
        const traits = Projectile.traits[p], weapon = Projectile.weapon[p]
        if (weapon < 0 || (traits & TRAIT.EXPLODE && Projectile.pierceLeft[p] < 0)) continue
        const st = ctx.loadout.weapons[weapon]!
        const r = k.hitRadius(st.area)
        const px = Position.x[p], py = Position.y[p]
        const cands = near(ctx, px, py, r + reach).filter((m) => {
          const rr = r + k.MOBS[Mob.kind[m]].radius
          return k.distSq(px, py, Position.x[m], Position.y[m]) <= rr * rr && !blocked(m, k.IMMUNE_HIT) && !alreadyHit(p, m)
        }).sort(byGameId)
        const orbiter = k.aimOf(weapon) === 'orbit'
        let gone = false
        for (let c = 0; c < cands.length && !gone; c++) {
          const m = cands[c]
          Projectile.hitMask[p] |= 1 << (GameId.id[m] & 31)
          if (traits & TRAIT.EXPLODE) { Projectile.pierceLeft[p] = -1; break }
          queueHit(ctx, m, st.damage, GameId.id[p], traits)
          if (traits & TRAIT.SPLIT) {
            const vx = Velocity.x[p], vy = Velocity.y[p]
            for (const [cx, cy] of [[-vy, vx], [vy, -vx]]) {
              makeProj(ctx, {
                weapon, owner: Projectile.owner[p], traits: traits & ~TRAIT.SPLIT, x: px, y: py, vx: cx, vy: cy, ttl: tick + k.SPLIT_LIFE,
                pierceLeft: 0, bounceLeft: 0, hitMask: 0, target: -1,
              })
            }
          }
          if (orbiter) continue
          if (traits & TRAIT.CHAIN) {
            let next = -1, bestD = 0
            if (Projectile.pierceLeft[p] > 0)
              ctx.grid.forNear(px, py, k.CHAIN_RANGE, (o, d2, gid) => {
                if (o === m || blocked(o, k.IMMUNE_HIT) || alreadyHit(p, o)) return
                if (next === -1 || d2 < bestD || (d2 === bestD && gid < GameId.id[next])) { next = o; bestD = d2 }
              })
            if (next !== -1) {
              Projectile.pierceLeft[p] -= 1
              ;[Velocity.x[p], Velocity.y[p]] = k.velToward(px, py, Position.x[next], Position.y[next], st.speed)
              Projectile.target[p] = GameId.id[next]
            } else { destroy(ctx, p); gone = true }
          } else if (Projectile.pierceLeft[p] > 0) Projectile.pierceLeft[p] -= 1
          else if (Projectile.bounceLeft[p] > 0) {
            Projectile.bounceLeft[p] -= 1
            Velocity.x[p] = -Velocity.x[p]; Velocity.y[p] = -Velocity.y[p]
          }
          else { destroy(ctx, p); gone = true }
        }
      }
      applyHits(ctx)
      flush(ctx)
    }
  },
  'combat.hostile': (ctx) => () => {
    const { k } = ctx
    const reach = k.PLAYER_RADIUS + k.HOSTILE_HIT_PAD
    for (const p of query(ctx.world, Q.hostile)) {
      if (k.distSq(Position.x[p], Position.y[p], ctx.px, ctx.py) > reach * reach) continue
      if (Player.iframes[ctx.player] === 0) hurtPlayer(ctx, k.HOSTILE_DAMAGE)
      destroy(ctx, p)
    }
    flush(ctx)
  },
  'combat.contact': (ctx) => () => {
    const { k, player } = ctx
    const px = Position.x[player], py = Position.y[player]
    // Only the first mob in gameId order that touches the player lands a hit, so the touching mobs are sorted.
    const touching = Array.from(query(ctx.world, Q.mobs)).filter((m) => {
      const def = k.MOBS[Mob.kind[m]]
      const r = def.radius + k.PLAYER_RADIUS
      return def.contact !== 0 && k.distSq(Position.x[m], Position.y[m], px, py) <= r * r && !blocked(m, k.BLOCKS_ACT)
    }).sort(byGameId)
    for (const m of touching) {
      if (Player.iframes[player] !== 0) break
      hurtPlayer(ctx, k.MOBS[Mob.kind[m]].contact)
      if (Mob.affix[m] & k.AFFIX.VAMPIRIC) Mob.healIn[m] += k.VAMPIRIC_HEAL
    }
  },
  'combat.explode': (ctx) => {
    const reach = maxMobRadius(ctx.k)
    return () => {
      const { k } = ctx
      const tick = ctx.world.tick
      for (const m of query(ctx.world, Q.exploders)) if (hasTag(m, STATUS.FUSE) && Fuse.until[m] <= tick) addTag(ctx, m, STATUS.DYING, 0)
      for (const p of sortedByGameId(ctx, Q.explosive)) {
        if (Projectile.weapon[p] < 0 || !(Projectile.pierceLeft[p] < 0 || Projectile.ttl[p] <= tick)) continue
        const st = ctx.loadout.weapons[Projectile.weapon[p]]!
        const px = Position.x[p], py = Position.y[p]
        for (const m of near(ctx, px, py, k.BLAST_RADIUS + reach)) {
          const rr = k.BLAST_RADIUS + k.MOBS[Mob.kind[m]].radius
          if (k.distSq(px, py, Position.x[m], Position.y[m]) <= rr * rr && !blocked(m, k.IMMUNE_HIT)) {
            queueHit(ctx, m, st.damage, GameId.id[p], Projectile.traits[p])
          }
        }
        destroy(ctx, p)
      }
      applyHits(ctx)
      flush(ctx)
    }
  },
}
