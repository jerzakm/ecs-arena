import {
  addComponent, collectEntities, destroyEntity, getComponentValue, getResourceValue, hasComponent, setComponentValue,
  setResourceValue,
} from 'iris-ecs'
import { survivors } from '@ecs-arena/spec'
import { GameId } from '../../shared/components.ts'
import { byGameId } from '../../shared/util.ts'
import { Attracted, Held, Pickup, PlayerHp, Position, Projectile, Run } from '../components.ts'
import type { Ctx } from '../context.ts'
import { distSqTo, makeHeld, makeProj } from '../entities.ts'
import { pushLevelUp, pushPickup, STRIDE } from '../events.ts'
import { heldList, refreshLoadout } from '../loadout.ts'
import { orbiters, pickups } from '../queries.ts'
import { setTraits } from '../tags.ts'

const { PICKUP_KIND, EVENT, INF_TTL } = survivors.kernel

type ProgressId = 'pickup.magnet' | 'pickup.collect' | 'progress.pick' | 'progress.apply'

export const progressSystems: Pick<survivors.SystemTable<Ctx>, ProgressId> = {
  'pickup.magnet': (ctx) => () => {
    const { k, px, py, world } = ctx
    const r = k.MAGNET_BASE + ctx.loadout.stats.magnet
    for (const e of collectEntities(world, pickups)) {
      const x = getComponentValue(world, e, Position, 'x')!, y = getComponentValue(world, e, Position, 'y')!
      let attracted = hasComponent(world, e, Attracted)
      if (!attracted && k.distSq(x, y, px, py) <= r * r) {
        addComponent(world, e, Attracted)
        attracted = true
      }
      if (attracted) {
        const [nx, ny] = k.stepTo(x, y, px, py, k.PICKUP_SPEED)
        setComponentValue(world, e, Position, 'x', nx)
        setComponentValue(world, e, Position, 'y', ny)
      }
    }
  },
  'pickup.collect': (ctx) => () => {
    const { k, scenario, px, py, world, player } = ctx
    const all = collectEntities(world, pickups).map((e) => ({ id: getComponentValue(world, e, GameId, 'id')!, e })).sort(byGameId)
    let xp = getResourceValue(world, Run, 'xp')!, level = getResourceValue(world, Run, 'level')!
    const { greed, vigor } = ctx.loadout.stats
    for (const { id, e } of all) {
      if (distSqTo(ctx, e, px, py) > k.PICKUP_RANGE * k.PICKUP_RANGE) continue
      const kind = getComponentValue(world, e, Pickup, 'kind')!, value = getComponentValue(world, e, Pickup, 'value')!
      pushPickup(ctx, id, kind)
      destroyEntity(world, e)
      if (kind === PICKUP_KIND.GEM) xp += k.fx.div(value * (1000 + greed), 1000)
      else if (kind === PICKUP_KIND.HEART) {
        const hp = getComponentValue(world, player, PlayerHp, 'hp')!
        setComponentValue(world, player, PlayerHp, 'hp', Math.min(k.maxHp(vigor), hp + value))
      }
    }
    while (xp >= k.xpForLevel(level, scenario.xpScale)) {
      xp -= k.xpForLevel(level, scenario.xpScale)
      level++
      pushLevelUp(ctx, level)
    }
    setResourceValue(world, Run, 'xp', xp)
    setResourceValue(world, Run, 'level', level)
  },
  'progress.pick': (ctx) => () => {
    const { k, world, scenario, tick } = ctx
    ctx.events.evolved.length = 0
    const before = heldList(ctx)
    let held: survivors.kernel.Held[] = before.map(({ id, level, cd }) => ({ id, level, cd }))
    const take = (id: number) => {
      if (id < 0) return
      const d = k.UPGRADES[id]
      if (d.kind === 'evolution') ctx.events.evolved.push([d.from, id])
      held = k.takeUpgrade(held, id)
      setResourceValue(world, Run, 'picks', (getResourceValue(world, Run, 'picks')! + 1) | 0)
      ctx.events.picked = true
    }
    const levels = ctx.events.lists[EVENT.LEVELUP]
    for (let i = 0; i < levels.length; i++) take(k.pickUpgrade(scenario.seed, tick, levels[i], held))
    const got = ctx.events.lists[EVENT.PICKUP]
    for (let i = 0; i < got.length; i += STRIDE.PICKUP) {
      if (got[i + 1] === PICKUP_KIND.CHEST) take(k.chestPick(scenario.seed, tick, k.CHEST_KEY + got[i], held))
    }
    if (!ctx.events.picked) return
    // Write the new held list back: an evolution drops its `from` record, a level up changes a level, a new upgrade is a new record.
    for (const row of before) {
      const now = held.find((h) => h.id === row.id)
      if (!now) destroyEntity(world, row.e)
      else if (now.level !== row.level) setComponentValue(world, row.e, Held, 'level', now.level)
    }
    for (const h of held) if (!before.some((row) => row.id === h.id)) makeHeld(ctx, h.id, h.level, h.cd)
  },
  'progress.apply': (ctx) => () => {
    const { k, scenario, px, py, world } = ctx
    if (!ctx.events.picked) return
    ctx.events.picked = false
    refreshLoadout(ctx)
    if (ctx.events.evolved.length > 0) {
      const live = collectEntities(world, [Projectile] as const)
      for (const [from, to] of ctx.events.evolved)
        for (const e of live) {
          if (getComponentValue(world, e, Projectile, 'weapon') !== from) continue
          setComponentValue(world, e, Projectile, 'weapon', to)
          setTraits(world, e, k.scaleTraits(ctx.loadout.weapons[to]!.traits, scenario.traitScale))
        }
    }
    for (const h of heldList(ctx)) {
      if (k.aimOf(h.id) !== 'orbit') continue
      for (const old of collectEntities(world, orbiters)) {
        if (getComponentValue(world, old, Projectile, 'weapon') === h.id) destroyEntity(world, old)
      }
      const st = ctx.loadout.weapons[h.id]!
      const traits = k.scaleTraits(st.traits, scenario.traitScale)
      for (let s = 0; s < st.count; s++) {
        makeProj(ctx, { weapon: h.id, owner: k.PLAYER_ID, traits, x: px, y: py, vx: 0, vy: 0, ttl: INF_TTL })
      }
    }
  },
}
