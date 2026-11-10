import {
  collectEntities, type EntityId, EXPERIMENTAL_queryColumns as queryColumns, getComponentValue, getResourceValue, hasComponent,
  setComponentValue, setResourceValue,
} from 'iris-ecs'
import { survivors } from '@ecs-arena/spec'
import { GameId } from '../../shared/components.ts'
import { byGameId } from '../../shared/util.ts'
import {
  Affix, Aux, BossPhase, Burning, Dying, Enraged, Frozen, Hp, IFrames, Incoming, Kind, Marked, Position, Run, Shielded, Slowed,
} from '../components.ts'
import type { Ctx } from '../context.ts'
import { makePart } from '../entities.ts'
import { pushStatus, STRIDE } from '../events.ts'
import { hurtPlayer } from '../hits.ts'
import { affixed, burningDamage, burningMobs, expiring, ghosts, incoming } from '../queries.ts'
import { addTag, immune, markDying, maxHpOf, removeTag } from '../tags.ts'

const { STATUS, PARTICLE_KIND, EVENT } = survivors.kernel

type StatusId = 'status.apply' | 'status.tick' | 'status.expire' | 'resolve.damage' | 'resolve.changed'

export const statusSystems: Pick<survivors.SystemTable<Ctx>, StatusId> = {
  'status.apply': (ctx) => () => {
    const { k, world, scenario, tick } = ctx
    const hits = ctx.events.lists[EVENT.HIT]
    // Every hit reads the mask of the start of the system, so read every SLOWED before the first add.
    const work: { e: EntityId; traits: number; mask: number }[] = []
    for (let i = 0; i < hits.length; i += STRIDE.HIT) {
      const e = ctx.entityOf.get(hits[i])!
      work.push({ e, traits: hits[i + 1], mask: hasComponent(world, e, Slowed) ? k.bit(STATUS.SLOWED) : 0 })
    }
    for (const { e, traits, mask } of work) {
      for (const [id, dur, delta] of k.statusFromTraits(traits, mask)) {
        addTag(ctx, e, id, tick + k.tagDuration(dur, scenario.tagScale), delta)
        pushStatus(ctx, getComponentValue(world, e, GameId, 'id')!)
      }
    }
  },
  'status.tick': (ctx) => () => {
    const { k, scenario, tick, world, mobs, player } = ctx
    if (tick % k.BURN_PERIOD === 0) {
      queryColumns(world, burningDamage, (entities, [burn, inc]) => {
        for (let i = 0; i < entities.length; i++) inc.dmg[i] += burn.stacks[i]
      })
    }
    // Fire spread. Each burning mob (its turn is tick + gameId) lights the mobs near it.
    // Every query reads the tags of the start of the step.
    const lit = new Map<number, EntityId>()
    const spreaders: { id: number; e: EntityId; x: number; y: number }[] = []
    queryColumns(world, burningMobs, (entities, [, id, pos]) => {
      for (let i = 0; i < entities.length; i++) {
        if ((tick + id.id[i]) % k.FIRE_SPREAD_PERIOD === 0) spreaders.push({ id: id.id[i], e: entities[i], x: pos.x[i], y: pos.y[i] })
      }
    })
    for (const s of spreaders) {
      mobs.grid.forNear(s.x, s.y, k.FIRE_SPREAD_RANGE, (h) => {
        const o = mobs.entityAt[h]
        if (!hasComponent(world, o, Burning) && !lit.has(mobs.idAt[h]) && !immune(world, o)) lit.set(mobs.idAt[h], o)
      })
    }
    const burnUntil = tick + k.tagDuration(k.DUR.BURNING, scenario.tagScale)
    for (const id of [...lit.keys()].sort((a, b) => a - b)) addTag(ctx, lit.get(id)!, STATUS.BURNING, burnUntil, 1)
    if (tick % k.SCORCH_PERIOD === 0) {
      const hot: { id: number; x: number; y: number }[] = []
      queryColumns(world, affixed, (entities, [id, affix, pos]) => {
        for (let i = 0; i < entities.length; i++) {
          if (affix.bits[i] & k.AFFIX.SCORCHING) hot.push({ id: id.id[i], x: pos.x[i], y: pos.y[i] })
        }
      })
      hot.sort(byGameId)
      for (const m of hot) {
        if (k.distSq(m.x, m.y, ctx.px, ctx.py) > k.SCORCH_RANGE * k.SCORCH_RANGE || hasComponent(world, player, IFrames)) continue
        hurtPlayer(ctx, 1)
      }
    }
    for (const e of collectEntities(world, ghosts)) {
      if ((tick + getComponentValue(world, e, GameId, 'id')) % k.GHOST_PERIOD === 0) addTag(ctx, e, STATUS.PHASED, tick + k.DUR.PHASED)
    }
  },
  'status.expire': (ctx) => () => {
    const { tick, world } = ctx
    for (let id = 0; id < expiring.length; id++) {
      const due: EntityId[] = []
      queryColumns(world, expiring[id], (entities, [col]) => {
        for (let i = 0; i < entities.length; i++) if (col.until[i] <= tick) due.push(entities[i])
      })
      for (const e of due) removeTag(world, e, id)
    }
  },
  'resolve.damage': (ctx) => () => {
    const { k, world } = ctx
    const rows: { id: number; e: EntityId; kind: number }[] = []
    queryColumns(world, incoming, (entities, [id, , inc, kind]) => {
      for (let i = 0; i < entities.length; i++) {
        if (inc.dmg[i] > 0 || inc.heal[i] > 0 || inc.clear[i] !== 0) rows.push({ id: id.id[i], e: entities[i], kind: kind.value[i] })
      }
    })
    rows.sort(byGameId)
    ctx.events.changed.length = 0
    for (const { e, kind } of rows) {
      const dmg = getComponentValue(world, e, Incoming, 'dmg')!, heal = getComponentValue(world, e, Incoming, 'heal')!
      const clear = getComponentValue(world, e, Incoming, 'clear')!
      const hp0 = getComponentValue(world, e, Hp, 'hp')!
      let shield = getComponentValue(world, e, Hp, 'shield')!
      let hp = Math.min(maxHpOf(ctx, e, kind), hp0 + heal)
      const absorb = Math.min(shield, dmg)
      shield -= absorb
      if (shield === 0 && hasComponent(world, e, Shielded)) removeTag(world, e, STATUS.SHIELDED)
      hp = Math.max(0, hp - (dmg - absorb))
      if (hp === 0) markDying(world, e)
      if (clear & k.bit(STATUS.MARKED) && hasComponent(world, e, Marked)) removeTag(world, e, STATUS.MARKED)
      if (clear & k.bit(STATUS.FROZEN) && hasComponent(world, e, Frozen)) removeTag(world, e, STATUS.FROZEN)
      setResourceValue(world, Run, 'dmgOut', (getResourceValue(world, Run, 'dmgOut')! + dmg) | 0)
      setComponentValue(world, e, Hp, 'hp', hp)
      setComponentValue(world, e, Hp, 'shield', shield)
      setComponentValue(world, e, Incoming, 'dmg', 0)
      setComponentValue(world, e, Incoming, 'heal', 0)
      setComponentValue(world, e, Incoming, 'clear', 0)
      if (hp !== hp0) ctx.events.changed.push({ e, hp0 })
    }
  },
  'resolve.changed': (ctx) => () => {
    const { k, world, scenario, tick } = ctx
    for (const { e, hp0 } of ctx.events.changed) {
      if (hasComponent(world, e, Dying)) continue
      const hp = getComponentValue(world, e, Hp, 'hp')!
      const max = maxHpOf(ctx, e, getComponentValue(world, e, Kind, 'value')!)
      const frenzied = (getComponentValue(world, e, Affix, 'bits')! & k.AFFIX.FRENZIED) !== 0
      if (frenzied && hp * 2 < max && !hasComponent(world, e, Enraged)) addTag(ctx, e, STATUS.ENRAGED, tick + k.DUR.ENRAGED)
      if (hasComponent(world, e, BossPhase)) {
        setComponentValue(world, e, Aux, 'value', k.bossPhase(hp, max, getComponentValue(world, e, Aux, 'value')!))
      }
      if (hp < hp0) {
        const x = getComponentValue(world, e, Position, 'x')!, y = getComponentValue(world, e, Position, 'y')!
        const id = getComponentValue(world, e, GameId, 'id')!
        for (let n = 0; n < k.scaleCount(k.SPARK_COUNT, scenario.particleScale); n++) {
          const [vx, vy] = k.sparkVel(scenario.seed, tick, id, n)
          makePart(ctx, PARTICLE_KIND.SPARK, x, y, vx, vy, tick + k.SPARK_LIFE)
        }
      }
    }
  },
}
