import { addComponent, query } from 'bitecs'
import { survivors } from '@ecs-arena/spec'
import { Mob, Position, SummonedBy, Velocity } from '../components.ts'
import { GameId } from '../../shared/components.ts'
import type { Ctx } from '../context.ts'
import { makeMob, makeProj, near } from '../entities.ts'
import { minionsOf, Q } from '../queries.ts'
import { addTag, blocked, hasTag } from '../tags.ts'
import { byGameId, sortedByGameId } from '../../shared/util.ts'
const { MOB, STATUS } = survivors.kernel
const speedOf = (ctx: Ctx, m: number) => ctx.k.mobSpeed(Mob.kind[m], Mob.affix[m], Mob.flags[m])
const setVel = (m: number, v: [number, number]) => { Velocity.x[m] = v[0]; Velocity.y[m] = v[1] }
type AiIds = 'ai.chase' | 'ai.weave' | 'ai.charge' | 'ai.kite' | 'ai.shoot' | 'ai.summon' | 'ai.heal' | 'ai.fuse'
export const aiSystems: Pick<survivors.SystemTable<Ctx>, AiIds> = {
  'ai.chase': (ctx) => () => {
    const { k, px, py } = ctx
    for (const m of query(ctx.world, Q.chasers)) {
      if (!blocked(m, k.BLOCKS_MOVE)) setVel(m, k.velToward(Position.x[m], Position.y[m], px, py, speedOf(ctx, m)))
    }
  },
  'ai.weave': (ctx) => () => {
    const { k, scenario, px, py } = ctx
    const tick = ctx.world.tick
    for (const m of query(ctx.world, Q.weavers)) {
      if (blocked(m, k.BLOCKS_MOVE)) continue
      const [bx, by] = k.velToward(Position.x[m], Position.y[m], px, py, speedOf(ctx, m))
      const s = k.SIN[k.weaveIndex(scenario.seed, GameId.id[m], tick)]
      Velocity.x[m] = bx + k.fx.div(k.fx.mul(-by, s), k.WEAVE_AMP_DIV)
      Velocity.y[m] = by + k.fx.div(k.fx.mul(bx, s), k.WEAVE_AMP_DIV)
    }
  },
  'ai.charge': (ctx) => () => {
    const { k, px, py } = ctx
    const tick = ctx.world.tick
    for (const m of query(ctx.world, Q.chargers)) {
      if (blocked(m, k.BLOCKS_ACT)) continue
      const aux = Mob.aux[m]
      if (aux === 0) {
        if (k.distSq(Position.x[m], Position.y[m], px, py) <= k.CHARGE_RANGE * k.CHARGE_RANGE) {
          addTag(ctx, m, STATUS.WINDUP, tick + k.DUR.WINDUP)
          Mob.aux[m] = 1
          setVel(m, k.velToward(Position.x[m], Position.y[m], px, py, k.CHARGE_SPEED))
        } else if (!blocked(m, k.BLOCKS_MOVE)) setVel(m, k.velToward(Position.x[m], Position.y[m], px, py, speedOf(ctx, m)))
      } else if (aux === 1 && !hasTag(m, STATUS.WINDUP)) {
        addTag(ctx, m, STATUS.DASH, tick + k.DUR.DASH)
        Mob.aux[m] = 2
      } else if (aux === 2 && !hasTag(m, STATUS.DASH)) {
        addTag(ctx, m, STATUS.RECOVER, tick + k.DUR.RECOVER)
        Mob.aux[m] = 3
      } else if (aux === 3 && !hasTag(m, STATUS.RECOVER)) Mob.aux[m] = 0
    }
  },
  'ai.kite': (ctx) => () => {
    const { k, px, py } = ctx
    for (const m of query(ctx.world, Q.kiters)) {
      if (blocked(m, k.BLOCKS_MOVE)) continue
      const x = Position.x[m], y = Position.y[m]
      const d2 = k.distSq(x, y, px, py)
      if (d2 > k.KITE_FAR * k.KITE_FAR) setVel(m, k.velToward(x, y, px, py, speedOf(ctx, m)))
      else if (d2 < k.KITE_NEAR * k.KITE_NEAR) setVel(m, k.velToward(x, y, 2 * x - px, 2 * y - py, speedOf(ctx, m)))
      else setVel(m, [0, 0])
    }
  },
  'ai.shoot': (ctx) => () => {
    const { k, px, py } = ctx
    const tick = ctx.world.tick
    const act = Array.from(query(ctx.world, Q.shooters)).filter((m) =>
      (Mob.kind[m] !== MOB.BOSS || Mob.aux[m] >= k.BOSS_PHASE_SHOOT) && (tick + GameId.id[m]) % k.SHOOT_PERIOD === 0 &&
      !blocked(m, k.BLOCKS_ACT))
    act.sort(byGameId)
    for (const m of act) {
      const [vx, vy] = k.velToward(Position.x[m], Position.y[m], px, py, k.HOSTILE_SPEED)
      makeProj(ctx, {
        weapon: -1, owner: GameId.id[m], traits: 0, x: Position.x[m], y: Position.y[m], vx, vy, ttl: tick + k.HOSTILE_LIFE,
        pierceLeft: 0, bounceLeft: 0, hitMask: 0, target: -1,
      })
    }
  },
  'ai.summon': (ctx) => () => {
    const { k } = ctx
    const tick = ctx.world.tick
    const act = Array.from(query(ctx.world, Q.summoners)).filter((m) =>
      (Mob.kind[m] !== MOB.BOSS || Mob.aux[m] >= k.BOSS_PHASE_SUMMON) && (tick + GameId.id[m]) % k.SUMMON_PERIOD === 0 &&
      !blocked(m, k.BLOCKS_ACT))
    act.sort(byGameId)
    for (const m of act) {
      const n = Math.min(k.SUMMON_BATCH, k.SUMMON_CAP - query(ctx.world, minionsOf(m)).length)
      for (let j = 0; j < n; j++) addComponent(ctx.world, makeMob(ctx, MOB.SWARMLING, Position.x[m], Position.y[m]), SummonedBy(m))
    }
  },
  'ai.heal': (ctx) => () => {
    const { k } = ctx
    const tick = ctx.world.tick
    const act = sortedByGameId(ctx, Q.healers).filter((m) => (tick + GameId.id[m]) % k.HEAL_PERIOD === 0 && !blocked(m, k.BLOCKS_ACT))
    for (const m of act) {
      const d = (o: number) => k.distSq(Position.x[m], Position.y[m], Position.x[o], Position.y[o])
      const cands = near(ctx, Position.x[m], Position.y[m], k.HEAL_RANGE)
        .filter((o) => o !== m && Mob.hp[o] < k.mobMaxHp(Mob.kind[o], Mob.flags[o]))
        .sort((a, b) => d(a) - d(b) || byGameId(a, b))
      for (let j = 0; j < Math.min(k.HEAL_TARGETS, cands.length); j++) Mob.healIn[cands[j]] += k.HEAL_AMOUNT
    }
  },
  'ai.fuse': (ctx) => () => {
    const { k, px, py } = ctx
    const tick = ctx.world.tick
    for (const m of query(ctx.world, Q.exploders)) {
      if (blocked(m, k.BLOCKS_ACT)) continue
      if (!hasTag(m, STATUS.FUSE) && k.distSq(Position.x[m], Position.y[m], px, py) <= k.FUSE_RANGE * k.FUSE_RANGE) {
        addTag(ctx, m, STATUS.FUSE, tick + k.DUR.FUSE)
      }
    }
  },
}
