import {
  collectEntities, type EntityId, EXPERIMENTAL_queryColumns as queryColumns, getComponentValue, hasComponent, setComponentValue,
} from 'iris-ecs'
import { survivors } from '@ecs-arena/spec'
import { GameId } from '../../shared/components.ts'
import { byGameId } from '../../shared/util.ts'
import { Affix, Aux, BossPhase, Dash, Hp, Incoming, Kind, Position, Recover, Velocity, Windup } from '../components.ts'
import type { Ctx } from '../context.ts'
import { makeMob, makeProj, near } from '../entities.ts'
import { chargers, chasers, childrenOf, fusers, healers, kiters, shooters, summoners, weavers } from '../queries.ts'
import { addTag, blocksMove, maxHpOf, speedFlags } from '../tags.ts'

const { MOB, STATUS } = survivors.kernel

/** The speed of one mob. Only SLOWED and ENRAGED change `mobSpeed`, so a mob needs no other tag read. */
const speedOf = (ctx: Ctx, e: EntityId): number => {
  const { k, world } = ctx
  return k.mobSpeed(getComponentValue(world, e, Kind, 'value')!, getComponentValue(world, e, Affix, 'bits')!, speedFlags(world, e))
}

/** A shooter or a summoner acts on its period, staggered by gameId, and a boss only from its phase on. */
const acts = (ctx: Ctx, e: EntityId, id: number, period: number, phase: number): boolean =>
  (ctx.tick + id) % period === 0 && (!hasComponent(ctx.world, e, BossPhase) || getComponentValue(ctx.world, e, Aux, 'value')! >= phase)

type AiId = 'ai.chase' | 'ai.weave' | 'ai.charge' | 'ai.kite' | 'ai.shoot' | 'ai.summon' | 'ai.heal' | 'ai.fuse'

export const aiSystems: Pick<survivors.SystemTable<Ctx>, AiId> = {
  'ai.chase': (ctx) => () => {
    const { k, px, py, world } = ctx
    queryColumns(world, chasers, (entities, [kind, affix, pos, vel]) => {
      // The tags that change the speed are the same for the whole archetype.
      const flags = speedFlags(world, entities[0])
      for (let i = 0; i < entities.length; i++) {
        const [vx, vy] = k.velToward(pos.x[i], pos.y[i], px, py, k.mobSpeed(kind.value[i], affix.bits[i], flags))
        vel.x[i] = vx
        vel.y[i] = vy
      }
    })
  },
  'ai.weave': (ctx) => () => {
    const { k, scenario, tick, px, py, world } = ctx
    queryColumns(world, weavers, (entities, [id, kind, affix, pos, vel]) => {
      const flags = speedFlags(world, entities[0])
      for (let i = 0; i < entities.length; i++) {
        const [bx, by] = k.velToward(pos.x[i], pos.y[i], px, py, k.mobSpeed(kind.value[i], affix.bits[i], flags))
        const s = k.SIN[k.weaveIndex(scenario.seed, id.id[i], tick)]
        vel.x[i] = bx + k.fx.div(k.fx.mul(-by, s), k.WEAVE_AMP_DIV)
        vel.y[i] = by + k.fx.div(k.fx.mul(bx, s), k.WEAVE_AMP_DIV)
      }
    })
  },
  'ai.charge': (ctx) => () => {
    const { k, tick, px, py, world } = ctx
    for (const e of collectEntities(world, chargers)) {
      const x = getComponentValue(world, e, Position, 'x'), y = getComponentValue(world, e, Position, 'y')
      const aux = getComponentValue(world, e, Aux, 'value')
      let next = aux
      if (aux === 0) {
        if (k.distSq(x, y, px, py) <= k.CHARGE_RANGE * k.CHARGE_RANGE) {
          addTag(ctx, e, STATUS.WINDUP, tick + k.DUR.WINDUP)
          next = 1
          const [vx, vy] = k.velToward(x, y, px, py, k.CHARGE_SPEED)
          setComponentValue(world, e, Velocity, 'x', vx)
          setComponentValue(world, e, Velocity, 'y', vy)
        } else if (!blocksMove(world, e)) {
          const [vx, vy] = k.velToward(x, y, px, py, speedOf(ctx, e))
          setComponentValue(world, e, Velocity, 'x', vx)
          setComponentValue(world, e, Velocity, 'y', vy)
        }
      } else if (aux === 1 && !hasComponent(world, e, Windup)) {
        addTag(ctx, e, STATUS.DASH, tick + k.DUR.DASH)
        next = 2
      } else if (aux === 2 && !hasComponent(world, e, Dash)) {
        addTag(ctx, e, STATUS.RECOVER, tick + k.DUR.RECOVER)
        next = 3
      } else if (aux === 3 && !hasComponent(world, e, Recover)) next = 0
      if (next !== aux) setComponentValue(world, e, Aux, 'value', next)
    }
  },
  'ai.kite': (ctx) => () => {
    const { k, px, py, world } = ctx
    for (const e of collectEntities(world, kiters)) {
      const x = getComponentValue(world, e, Position, 'x'), y = getComponentValue(world, e, Position, 'y')
      const speed = () => speedOf(ctx, e)
      const d2 = k.distSq(x, y, px, py)
      let v: [number, number]
      if (d2 > k.KITE_FAR * k.KITE_FAR) v = k.velToward(x, y, px, py, speed())
      else if (d2 < k.KITE_NEAR * k.KITE_NEAR) v = k.velToward(x, y, 2 * x - px, 2 * y - py, speed())
      else v = [0, 0]
      setComponentValue(world, e, Velocity, 'x', v[0])
      setComponentValue(world, e, Velocity, 'y', v[1])
    }
  },
  'ai.shoot': (ctx) => () => {
    const { k, tick, px, py, world } = ctx
    const act = collectEntities(world, shooters).map((e) => ({ id: getComponentValue(world, e, GameId, 'id'), e }))
      .filter(({ id, e }) => acts(ctx, e, id, k.SHOOT_PERIOD, k.BOSS_PHASE_SHOOT))
      .sort(byGameId)
    for (const { id, e } of act) {
      const x = getComponentValue(world, e, Position, 'x'), y = getComponentValue(world, e, Position, 'y')
      const [vx, vy] = k.velToward(x, y, px, py, k.HOSTILE_SPEED)
      makeProj(ctx, { weapon: -1, owner: id, traits: 0, x, y, vx, vy, ttl: tick + k.HOSTILE_LIFE })
    }
  },
  'ai.summon': (ctx) => () => {
    const { k, world } = ctx
    const act = collectEntities(world, summoners).map((e) => ({ id: getComponentValue(world, e, GameId, 'id'), e }))
      .filter(({ id, e }) => acts(ctx, e, id, k.SUMMON_PERIOD, k.BOSS_PHASE_SUMMON))
      .sort(byGameId)
    // The counts read the start of the system: a summoner makes its children one at a time, and no summoner is a child.
    const counts = act.map(({ e }) => collectEntities(world, childrenOf(e)).length)
    act.forEach(({ e }, i) => {
      const x = getComponentValue(world, e, Position, 'x'), y = getComponentValue(world, e, Position, 'y')
      const n = Math.min(k.SUMMON_BATCH, k.SUMMON_CAP - counts[i])
      for (let j = 0; j < n; j++) makeMob(ctx, MOB.SWARMLING, x, y, { summoner: e })
    })
  },
  'ai.heal': (ctx) => () => {
    const { k, tick, world, mobs } = ctx
    for (const e of collectEntities(world, healers)) {
      if ((tick + getComponentValue(world, e, GameId, 'id')) % k.HEAL_PERIOD !== 0) continue
      const x = getComponentValue(world, e, Position, 'x'), y = getComponentValue(world, e, Position, 'y')
      const cands = near(ctx, x, y, k.HEAL_RANGE)
        .map((h) => mobs.entityAt[h])
        .filter((o) => o !== e && getComponentValue(world, o, Hp, 'hp')! < maxHpOf(ctx, o, getComponentValue(world, o, Kind, 'value')!))
        .map((o) => {
          const ox = getComponentValue(world, o, Position, 'x')!, oy = getComponentValue(world, o, Position, 'y')!
          return { id: getComponentValue(world, o, GameId, 'id')!, e: o, d: k.distSq(x, y, ox, oy) }
        })
        .sort((a, b) => a.d - b.d || a.id - b.id)
      for (let j = 0; j < Math.min(k.HEAL_TARGETS, cands.length); j++) {
        const target = cands[j].e
        setComponentValue(world, target, Incoming, 'heal', getComponentValue(world, target, Incoming, 'heal')! + k.HEAL_AMOUNT)
      }
    }
  },
  'ai.fuse': (ctx) => () => {
    const { k, tick, px, py, world } = ctx
    for (const e of collectEntities(world, fusers)) {
      const x = getComponentValue(world, e, Position, 'x'), y = getComponentValue(world, e, Position, 'y')
      if (k.distSq(x, y, px, py) <= k.FUSE_RANGE * k.FUSE_RANGE) addTag(ctx, e, STATUS.FUSE, tick + k.DUR.FUSE)
    }
  },
}
