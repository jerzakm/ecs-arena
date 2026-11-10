import { survivors } from '@ecs-arena/spec'
import type { Ctx } from '../context.ts'
import { makeProj, near } from '../entities.ts'
import { aoe, applyHitsFor, hit, hurtPlayer } from '../hits.ts'
import { timedOf } from '../tags.ts'
import { ENT, type Mob, type Proj } from '../types.ts'
const { TRAIT, STATUS, MOB } = survivors.kernel
/** Whether the projectile has already hit the mob. The mask has one bit for each gameId mod 32. */
const alreadyHit = (p: Proj, m: Mob) => ((p.hitMask >>> (m.gameId & 31)) & 1) === 1
export const combatSystems: Pick<survivors.SystemTable<Ctx>, 'combat.hit' | 'combat.hostile' | 'combat.contact' | 'combat.explode'> = {
  'combat.hit': (ctx) => {
    const { k } = ctx
    const { blocked } = ctx.tags
    const applyHits = applyHitsFor(ctx)
    const reach = Math.max(...k.MOBS.map((m) => m.radius))
    return () => {
      const { tick } = ctx
      ctx.resendGrid()
      const ps = ctx.lists[ENT.PROJ]
      const n = ps.length
      for (let i = 0; i < n; i++) {
        const p = ps[i]
        if (p.dead || p.weapon < 0 || (p.traits & TRAIT.EXPLODE && p.pierceLeft < 0)) continue
        const st = ctx.wstat[p.weapon]!
        const r = k.hitRadius(st.area)
        const cands = near(ctx, p.x, p.y, r + reach).filter((m) => {
          const rr = r + k.MOBS[m.kind].radius
          return k.distSq(p.x, p.y, m.x, m.y) <= rr * rr && !blocked(m, k.IMMUNE_HIT) && !alreadyHit(p, m)
        })
        const orbiter = k.aimOf(p.weapon) === 'orbit'
        for (let c = 0; c < cands.length && !p.dead; c++) {
          const m = cands[c]
          p.hitMask |= 1 << (m.gameId & 31)
          if (p.traits & TRAIT.EXPLODE) { p.pierceLeft = -1; break }
          hit(ctx, m, st.damage, p.gameId, p.traits)
          if (p.traits & TRAIT.SPLIT) {
            for (const [vx, vy] of [[-p.vy, p.vx], [p.vy, -p.vx]])
              makeProj(ctx, {
                weapon: p.weapon, owner: p.owner, traits: p.traits & ~TRAIT.SPLIT, x: p.x, y: p.y, vx, vy, ttl: tick + k.SPLIT_LIFE,
                pierceLeft: 0, bounceLeft: 0, hitMask: 0, target: -1,
              })
          }
          if (orbiter) continue
          if (p.traits & TRAIT.CHAIN) {
            const next = p.pierceLeft > 0
              ? near(ctx, p.x, p.y, k.CHAIN_RANGE).filter((o) => o !== m && !blocked(o, k.IMMUNE_HIT) && !alreadyHit(p, o))
                .sort((a, b) => k.distSq(p.x, p.y, a.x, a.y) - k.distSq(p.x, p.y, b.x, b.y) || a.gameId - b.gameId)[0]
              : undefined
            if (next) {
              p.pierceLeft -= 1
              ;[p.vx, p.vy] = k.velToward(p.x, p.y, next.x, next.y, st.speed)
              p.target = next.gameId
            } else ctx.churn.destroy(p)
          } else if (p.pierceLeft > 0) p.pierceLeft -= 1
          else if (p.bounceLeft > 0) { p.bounceLeft -= 1; p.vx = -p.vx; p.vy = -p.vy }
          else ctx.churn.destroy(p)
        }
      }
      applyHits()
      ctx.churn.compact()
    }
  },
  'combat.hostile': (ctx) => {
    const { k } = ctx
    const { gate } = ctx.gates
    const { destroy, compact } = ctx.churn
    const reach = k.PLAYER_RADIUS + k.HOSTILE_HIT_PAD
    return () => {
      const { player } = ctx
      if (!gate('combat.hostile', ctx.hostile > 0, () => ctx.lists[ENT.PROJ].some((p) => !p.dead && p.weapon === -1))) return
      const ps = ctx.lists[ENT.PROJ]
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i]
        if (p.dead || p.weapon !== -1 || k.distSq(p.x, p.y, player.x, player.y) > reach * reach) continue
        if (player.iframes === 0) hurtPlayer(ctx, k.HOSTILE_DAMAGE)
        destroy(p)
      }
      compact()
    }
  },
  'combat.contact': (ctx) => {
    const { k } = ctx
    const { blocked, hasAffix } = ctx.tags
    return () => {
      const { player } = ctx
      const mobs = ctx.lists[ENT.MOB]
      for (let i = 0; i < mobs.length; i++) {
        const m = mobs[i]
        const def = k.MOBS[m.kind]
        const r = def.radius + k.PLAYER_RADIUS
        if (def.contact === 0 || k.distSq(m.x, m.y, player.x, player.y) > r * r || blocked(m, k.BLOCKS_ACT)) continue
        if (player.iframes !== 0) continue
        hurtPlayer(ctx, def.contact)
        if (hasAffix(m, k.AFFIX.VAMPIRIC)) { m.healIn += k.VAMPIRIC_HEAL; ctx.add('rule.affix') }
      }
    }
  },
  'combat.explode': (ctx) => {
    const { k } = ctx
    const { blocked, addTag } = ctx.tags
    const { gate } = ctx.gates
    const { destroy, compact } = ctx.churn
    const applyHits = applyHitsFor(ctx)
    const reach = Math.max(...k.MOBS.map((m) => m.radius))
    return () => {
      const { tick } = ctx
      const any = () =>
        ctx.lists[ENT.MOB].some((m) => m.kind === MOB.EXPLODER) || ctx.lists[ENT.PROJ].some((p) => !p.dead && p.traits & TRAIT.EXPLODE)
      if (!gate('combat.explode', ctx.hasExplode || ctx.kindCount[MOB.EXPLODER] > 0, any)) return
      ctx.resendGrid()
      const mobs = ctx.lists[ENT.MOB]
      for (let i = 0; i < mobs.length; i++) {
        const m = mobs[i]
        const fuse = m.kind === MOB.EXPLODER ? timedOf(m, STATUS.FUSE) : undefined
        if (fuse && fuse.until <= tick) addTag(m, STATUS.DYING, 0)
      }
      const ps = ctx.lists[ENT.PROJ]
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i]
        if (p.dead || p.weapon < 0 || !(p.traits & TRAIT.EXPLODE) || !(p.pierceLeft < 0 || p.ttl <= tick)) continue
        const st = ctx.wstat[p.weapon]!
        const hits = aoe(ctx, p.x, p.y, k.BLAST_RADIUS + reach)
        for (let j = 0; j < hits.length; j++) {
          const m = hits[j]
          const rr = k.BLAST_RADIUS + k.MOBS[m.kind].radius
          if (k.distSq(p.x, p.y, m.x, m.y) <= rr * rr && !blocked(m, k.IMMUNE_HIT)) hit(ctx, m, st.damage, p.gameId, p.traits)
        }
        destroy(p)
      }
      applyHits()
      compact()
    }
  },
}
