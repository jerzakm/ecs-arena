import { collectEntities, getComponentValue, getResourceValue, setComponentValue } from 'iris-ecs'
import { survivors } from '@ecs-arena/spec'
import { PlayerHp, Position, Run } from '../components.ts'
import type { Ctx } from '../context.ts'
import { makeMob } from '../entities.ts'
import { clearLists } from '../events.ts'
import { bosses } from '../queries.ts'

const { MOB } = survivors.kernel

export const spawnSystems: Pick<survivors.SystemTable<Ctx>, 'spawn.wave' | 'spawn.elite' | 'player.path'> = {
  'spawn.wave': (ctx) => () => {
    const { k, world, scenario, tick } = ctx
    clearLists(ctx.events)
    const alive = getResourceValue(world, Run, 'alive')! // counted by stats.render of the last tick, and no mob changed since
    const plan = k.spawnPlan(scenario.seed, tick, alive, scenario.mobCap, scenario.spawnEvery, scenario.paceScale)
    const [px, py] = k.playerPos(tick)
    for (let i = 0; i < plan.length; i++) {
      const [x, y] = k.ringPoint(px, py, k.SPAWN_RING, k.spawnAngle(scenario.seed, tick, i))
      makeMob(ctx, plan[i], x, y)
    }
  },
  'spawn.elite': (ctx) => () => {
    const { k, world, scenario, tick } = ctx
    const elite = tick > 0 && tick % scenario.eliteEvery === 0
    const boss = tick > 0 && tick % scenario.bossEvery === 0 && collectEntities(world, bosses).length === 0
    const ring = tick > 0 && tick % (k.RING_SWARM_EVERY * scenario.eliteEvery) === 0
    if (!elite && !boss && !ring) return
    const [px, py] = k.playerPos(tick)
    if (elite) {
      const kind = k.eliteKind(scenario.seed, tick, scenario.paceScale)
      const [x, y] = k.eliteSpawnPoint(scenario.seed, tick, px, py)
      makeMob(ctx, kind, x, y, { elite: true })
    }
    if (boss) {
      const [x, y] = k.bossSpawnPoint(scenario.seed, tick, px, py)
      makeMob(ctx, MOB.BOSS, x, y)
    }
    if (ring) {
      for (let i = 0; i < k.RING_SWARM; i++) {
        const [x, y] = k.ringSwarmPoint(scenario.seed, tick, px, py, i)
        makeMob(ctx, MOB.SWARMLING, x, y)
      }
    }
  },
  'player.path': (ctx) => () => {
    const { k, world, player } = ctx
    ;[ctx.px, ctx.py] = k.playerPos(ctx.tick)
    setComponentValue(world, player, Position, 'x', ctx.px)
    setComponentValue(world, player, Position, 'y', ctx.py)
    const hp = getComponentValue(world, player, PlayerHp, 'hp')!
    if (ctx.tick % k.REGEN_PERIOD === 0 && hp < k.maxHp(ctx.loadout.stats.vigor)) setComponentValue(world, player, PlayerHp, 'hp', hp + 1)
  },
}
