import type { Entity } from 'koota'
import { survivors } from '@ecs-arena/spec'
import { makeMob, makeProj, near } from '../entities.ts'
import { Aux, Clock, Hp, Incoming, Position, SummonedBy, TIMED, Velocity } from '../traits.ts'
import { addTag, blocksMove, maxHpOf, speedOf } from '../tags.ts'
import { byGameId, byNearest } from '../../shared/util.ts'
import type { Ctx } from '../context.ts'

const { MOB, STATUS } = survivors.kernel

// The systems that create entities or add tags collect plain rows first and change them after the loop, so no structural change
// runs inside a query.
interface Charging { e: Entity; x: number; y: number; aux: number; kind: number }
interface Source { e: Entity; gameId: number; x: number; y: number }

export const aiSystems: Pick<
  survivors.SystemTable<Ctx>,
  'ai.chase' | 'ai.weave' | 'ai.charge' | 'ai.kite' | 'ai.shoot' | 'ai.summon' | 'ai.heal' | 'ai.fuse'
> = {
  // A mob with a bit of BLOCKS_MOVE is not in these queries, so it keeps its old velocity.
  'ai.chase': (ctx) => () => {
    const { k, world } = ctx
    const { x: px, y: py } = ctx.player.get(Position)!
    world.query(ctx.q.chase).updateEach(([p, v, kind], e) => {
      ;[v.x, v.y] = k.velToward(p.x, p.y, px, py, speedOf(ctx, e, kind.value))
    })
  },
  'ai.weave': (ctx) => () => {
    const { k, scenario, world } = ctx
    const { tick } = world.get(Clock)!
    const { x: px, y: py } = ctx.player.get(Position)!
    world.query(ctx.q.weave).updateEach(([g, p, v, kind], e) => {
      const [bx, by] = k.velToward(p.x, p.y, px, py, speedOf(ctx, e, kind.value))
      const s = k.SIN[k.weaveIndex(scenario.seed, g.id, tick)]
      v.x = bx + k.fx.div(k.fx.mul(-by, s), k.WEAVE_AMP_DIV)
      v.y = by + k.fx.div(k.fx.mul(bx, s), k.WEAVE_AMP_DIV)
    })
  },
  'ai.charge': (ctx) => () => {
    const { k, world } = ctx
    const { tick } = world.get(Clock)!
    const { x: px, y: py } = ctx.player.get(Position)!
    const act: Charging[] = []
    world.query(ctx.q.chargers).readEach(([p, , aux, kind], e) => void act.push({ e, x: p.x, y: p.y, aux: aux.value, kind: kind.value }))
    for (const m of act) {
      const { e, aux } = m
      let next = aux
      if (aux === 0) {
        if (k.distSq(m.x, m.y, px, py) <= k.CHARGE_RANGE * k.CHARGE_RANGE) {
          addTag(ctx, e, STATUS.WINDUP, tick + k.DUR.WINDUP)
          next = 1
          const [vx, vy] = k.velToward(m.x, m.y, px, py, k.CHARGE_SPEED)
          e.set(Velocity, { x: vx, y: vy })
        } else if (!blocksMove(e)) {
          const [vx, vy] = k.velToward(m.x, m.y, px, py, speedOf(ctx, e, m.kind))
          e.set(Velocity, { x: vx, y: vy })
        }
      } else if (aux === 1 && !e.has(TIMED[STATUS.WINDUP])) {
        addTag(ctx, e, STATUS.DASH, tick + k.DUR.DASH)
        next = 2
      } else if (aux === 2 && !e.has(TIMED[STATUS.DASH])) {
        addTag(ctx, e, STATUS.RECOVER, tick + k.DUR.RECOVER)
        next = 3
      } else if (aux === 3 && !e.has(TIMED[STATUS.RECOVER])) next = 0
      if (next !== aux) e.set(Aux, { value: next })
    }
  },
  'ai.kite': (ctx) => () => {
    const { k, world } = ctx
    const { x: px, y: py } = ctx.player.get(Position)!
    world.query(ctx.q.kite).updateEach(([p, v, kind], e) => {
      const d2 = k.distSq(p.x, p.y, px, py)
      if (d2 > k.KITE_FAR * k.KITE_FAR) [v.x, v.y] = k.velToward(p.x, p.y, px, py, speedOf(ctx, e, kind.value))
      else if (d2 < k.KITE_NEAR * k.KITE_NEAR) [v.x, v.y] = k.velToward(p.x, p.y, 2 * p.x - px, 2 * p.y - py, speedOf(ctx, e, kind.value))
      else [v.x, v.y] = [0, 0]
    })
  },
  'ai.shoot': (ctx) => () => {
    const { k, world } = ctx
    const { tick } = world.get(Clock)!
    const { x: px, y: py } = ctx.player.get(Position)!
    const act: Source[] = []
    world.query(ctx.q.shooters).readEach(([g, p, aux, kind], e) => {
      if ((tick + g.id) % k.SHOOT_PERIOD === 0 && (kind.value !== MOB.BOSS || aux.value >= k.BOSS_PHASE_SHOOT)) {
        act.push({ e, gameId: g.id, x: p.x, y: p.y })
      }
    })
    act.sort(byGameId)
    for (const m of act) {
      const [vx, vy] = k.velToward(m.x, m.y, px, py, k.HOSTILE_SPEED)
      makeProj(ctx, { weapon: -1, owner: m.e, traits: 0, x: m.x, y: m.y, vx, vy, ttl: tick + k.HOSTILE_LIFE, pierceLeft: 0, bounceLeft: 0 })
    }
  },
  'ai.summon': (ctx) => () => {
    const { k, world } = ctx
    const { tick } = world.get(Clock)!
    const act: Source[] = []
    world.query(ctx.q.summoners).readEach(([g, p, aux, kind], e) => {
      if ((tick + g.id) % k.SUMMON_PERIOD === 0 && (kind.value !== MOB.BOSS || aux.value >= k.BOSS_PHASE_SUMMON)) {
        act.push({ e, gameId: g.id, x: p.x, y: p.y })
      }
    })
    act.sort(byGameId)
    for (const m of act) {
      const n = Math.min(k.SUMMON_BATCH, k.SUMMON_CAP - world.query(SummonedBy(m.e)).length)
      for (let j = 0; j < n; j++) makeMob(ctx, MOB.SWARMLING, m.x, m.y, { summoner: m.e })
    }
  },
  'ai.heal': (ctx) => () => {
    const { k, world } = ctx
    const { tick } = world.get(Clock)!
    const act: Source[] = []
    world.query(ctx.q.healers).readEach(([g, p], e) => {
      if ((tick + g.id) % k.HEAL_PERIOD === 0) act.push({ e, gameId: g.id, x: p.x, y: p.y })
    })
    for (const m of act) {
      const cands = near(ctx, m.x, m.y, k.HEAL_RANGE).filter((c) => {
        const o = ctx.mobAt[c.h]
        return o !== m.e && o.get(Hp)!.hp < maxHpOf(ctx, o, ctx.kindAt[c.h])
      })
      cands.sort(byNearest)
      for (let j = 0; j < Math.min(k.HEAL_TARGETS, cands.length); j++) {
        const o = ctx.mobAt[cands[j].h]
        o.set(Incoming, { heal: o.get(Incoming)!.heal + k.HEAL_AMOUNT })
      }
    }
  },
  'ai.fuse': (ctx) => () => {
    const { k, world } = ctx
    const { tick } = world.get(Clock)!
    const { x: px, y: py } = ctx.player.get(Position)!
    const act: Entity[] = []
    world.query(ctx.q.unfused).readEach(([p], e) => {
      if (k.distSq(p.x, p.y, px, py) <= k.FUSE_RANGE * k.FUSE_RANGE) act.push(e)
    })
    for (const e of act) addTag(ctx, e, STATUS.FUSE, tick + k.DUR.FUSE)
  },
}
