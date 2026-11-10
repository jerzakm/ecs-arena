import { survivors } from '@ecs-arena/spec'
import type { Ctx } from '../context.ts'
import { makeMob, makeProj, near } from '../entities.ts'
import { ENT, type Mob } from '../types.ts'
import { pushTo } from '../../shared/util.ts'
const { MOB, STATUS, HAS } = survivors.kernel
const pick = (mobs: Mob[], f: (m: Mob) => boolean): Mob[] => {
  const out: Mob[] = []
  for (let i = 0; i < mobs.length; i++) if (f(mobs[i])) out.push(mobs[i])
  return out
}
const hasBit = (ctx: Ctx, m: Mob, b: number) => (ctx.k.MOBS[m.kind].has & b) !== 0
type AiSystem = 'ai.chase' | 'ai.weave' | 'ai.charge' | 'ai.kite' | 'ai.shoot' | 'ai.summon' | 'ai.heal' | 'ai.fuse'
export const aiSystems: Pick<survivors.SystemTable<Ctx>, AiSystem> = {
  'ai.chase': (ctx) => {
    const { k } = ctx
    const { speedOf, hasAffix, gateFree } = ctx.tags
    return () => {
      const { px, py } = ctx
      const mobs = ctx.lists[ENT.MOB]
      // Speed does not change inside the ai phase, so one pass gives every ai system its mobSpeed.
      for (let i = 0; i < mobs.length; i++) mobs[i].spd = speedOf(mobs[i])
      ctx.begin('flag.reads')
      let swift = 0
      for (let i = 0; i < mobs.length; i++) if (hasAffix(mobs[i], k.AFFIX.SWIFT)) swift++
      ctx.end('flag.reads')
      ctx.add('rule.affix', swift)
      const free = gateFree(pick(mobs, (m) => k.MOBS[m.kind].move === 'chase'), k.BLOCKS_MOVE)
      for (let i = 0; i < free.length; i++) [free[i].vx, free[i].vy] = k.velToward(free[i].x, free[i].y, px, py, free[i].spd)
    }
  },
  'ai.weave': (ctx) => {
    const { k, scenario } = ctx
    const { gateFree } = ctx.tags
    const { kindGate } = ctx.gates
    return () => {
      const { tick, px, py } = ctx
      if (!kindGate('ai.weave', MOB.WEAVER)) return
      const free = gateFree(pick(ctx.lists[ENT.MOB], (m) => m.kind === MOB.WEAVER), k.BLOCKS_MOVE)
      for (let i = 0; i < free.length; i++) {
        const m = free[i]
        const [bx, by] = k.velToward(m.x, m.y, px, py, m.spd)
        const s = k.SIN[k.weaveIndex(scenario.seed, m.gameId, tick)]
        m.vx = bx + k.fx.div(k.fx.mul(-by, s), k.WEAVE_AMP_DIV)
        m.vy = by + k.fx.div(k.fx.mul(bx, s), k.WEAVE_AMP_DIV)
      }
    }
  },
  'ai.charge': (ctx) => {
    const { k } = ctx
    const { gateFree, blocked, hasTag, addTag } = ctx.tags
    const { kindGate } = ctx.gates
    return () => {
      const { tick, px, py } = ctx
      if (!kindGate('ai.charge', MOB.CHARGER)) return
      const act = gateFree(pick(ctx.lists[ENT.MOB], (m) => m.kind === MOB.CHARGER), k.BLOCKS_ACT)
      for (let i = 0; i < act.length; i++) {
        const m = act[i]
        const aux = m.aux
        if (aux === 0) {
          if (k.distSq(m.x, m.y, px, py) <= k.CHARGE_RANGE * k.CHARGE_RANGE) {
            addTag(m, STATUS.WINDUP, tick + k.DUR.WINDUP)
            m.aux = 1
            ;[m.vx, m.vy] = k.velToward(m.x, m.y, px, py, k.CHARGE_SPEED)
          } else if (!blocked(m, k.BLOCKS_MOVE)) [m.vx, m.vy] = k.velToward(m.x, m.y, px, py, m.spd)
        } else if (aux === 1 && !hasTag(m, STATUS.WINDUP)) {
          addTag(m, STATUS.DASH, tick + k.DUR.DASH)
          m.aux = 2
        } else if (aux === 2 && !hasTag(m, STATUS.DASH)) {
          addTag(m, STATUS.RECOVER, tick + k.DUR.RECOVER)
          m.aux = 3
        } else if (aux === 3 && !hasTag(m, STATUS.RECOVER)) m.aux = 0
        if (m.aux !== aux) ctx.add('rule.chargeCycle')
      }
    }
  },
  'ai.kite': (ctx) => {
    const { k } = ctx
    const { gateFree } = ctx.tags
    const { kindGate } = ctx.gates
    return () => {
      const { px, py } = ctx
      if (!kindGate('ai.kite', MOB.SHOOTER, MOB.HEALER, MOB.SUMMONER)) return
      const free = gateFree(pick(ctx.lists[ENT.MOB], (m) => k.MOBS[m.kind].move === 'kite'), k.BLOCKS_MOVE)
      for (let i = 0; i < free.length; i++) {
        const m = free[i]
        const d2 = k.distSq(m.x, m.y, px, py)
        if (d2 > k.KITE_FAR * k.KITE_FAR) [m.vx, m.vy] = k.velToward(m.x, m.y, px, py, m.spd)
        else if (d2 < k.KITE_NEAR * k.KITE_NEAR) [m.vx, m.vy] = k.velToward(m.x, m.y, 2 * m.x - px, 2 * m.y - py, m.spd)
        else [m.vx, m.vy] = [0, 0]
      }
    }
  },
  'ai.shoot': (ctx) => {
    const { k } = ctx
    const { gateFree } = ctx.tags
    const { kindGate } = ctx.gates
    return () => {
      const { tick, px, py } = ctx
      if (!kindGate('ai.shoot', MOB.SHOOTER, MOB.BOSS)) return
      const canShoot = (m: Mob) =>
        hasBit(ctx, m, HAS.SHOOT) && (m.kind !== MOB.BOSS || m.aux >= k.BOSS_PHASE_SHOOT) && (tick + m.gameId) % k.SHOOT_PERIOD === 0
      const act = gateFree(pick(ctx.lists[ENT.MOB], canShoot), k.BLOCKS_ACT)
      for (let i = 0; i < act.length; i++) {
        const m = act[i]
        const [vx, vy] = k.velToward(m.x, m.y, px, py, k.HOSTILE_SPEED)
        makeProj(ctx, {
          weapon: -1, owner: m.gameId, traits: 0, x: m.x, y: m.y, vx, vy, ttl: tick + k.HOSTILE_LIFE,
          pierceLeft: 0, bounceLeft: 0, hitMask: 0, target: -1,
        })
      }
    }
  },
  'ai.summon': (ctx) => {
    const { k } = ctx
    const { gateFree } = ctx.tags
    const { kindGate } = ctx.gates
    return () => {
      const { tick } = ctx
      if (!kindGate('ai.summon', MOB.SUMMONER, MOB.BOSS)) return
      const canSummon = (m: Mob) =>
        hasBit(ctx, m, HAS.SUMMON) && (m.kind !== MOB.BOSS || m.aux >= k.BOSS_PHASE_SUMMON) && (tick + m.gameId) % k.SUMMON_PERIOD === 0
      const act = gateFree(pick(ctx.lists[ENT.MOB], canSummon), k.BLOCKS_ACT)
      for (let i = 0; i < act.length; i++) {
        const m = act[i]
        const n = Math.min(k.SUMMON_BATCH, k.SUMMON_CAP - (ctx.kids.get(m.gameId)?.length ?? 0))
        for (let j = 0; j < n; j++) {
          const c = makeMob(ctx, MOB.SWARMLING, m.x, m.y)
          c.summoner = m.gameId
          pushTo(ctx.kids, m.gameId, c)
        }
      }
    }
  },
  'ai.heal': (ctx) => {
    const { k } = ctx
    const { gateFree } = ctx.tags
    const { kindGate } = ctx.gates
    return () => {
      const { tick } = ctx
      if (!kindGate('ai.heal', MOB.HEALER)) return
      const act = gateFree(pick(ctx.lists[ENT.MOB], (m) => m.kind === MOB.HEALER && (tick + m.gameId) % k.HEAL_PERIOD === 0), k.BLOCKS_ACT)
      for (let i = 0; i < act.length; i++) {
        const m = act[i]
        ctx.resendGrid()
        const d = (o: Mob) => k.distSq(m.x, m.y, o.x, o.y)
        const cands = near(ctx, m.x, m.y, k.HEAL_RANGE)
          .filter((o) => o !== m && o.hp < k.mobMaxHp(o.kind, o.flags))
          .sort((a, b) => d(a) - d(b) || a.gameId - b.gameId)
        for (let j = 0; j < Math.min(k.HEAL_TARGETS, cands.length); j++) cands[j].healIn += k.HEAL_AMOUNT
      }
    }
  },
  'ai.fuse': (ctx) => {
    const { k } = ctx
    const { gateFree, hasTag, addTag } = ctx.tags
    const { kindGate } = ctx.gates
    return () => {
      const { tick, px, py } = ctx
      if (!kindGate('ai.fuse', MOB.EXPLODER)) return
      const act = gateFree(pick(ctx.lists[ENT.MOB], (m) => m.kind === MOB.EXPLODER), k.BLOCKS_ACT)
      for (let i = 0; i < act.length; i++) {
        const m = act[i]
        if (!hasTag(m, STATUS.FUSE) && k.distSq(m.x, m.y, px, py) <= k.FUSE_RANGE * k.FUSE_RANGE) addTag(m, STATUS.FUSE, tick + k.DUR.FUSE)
      }
    }
  },
}
