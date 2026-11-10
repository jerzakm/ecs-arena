import { survivors } from '@ecs-arena/spec'
import { makeMob } from '../entities.ts'
import { clearEvents } from '../events.ts'
import { Clock, Hp, Loadout, Position, Totals } from '../traits.ts'
import type { Ctx } from '../context.ts'

const { MOB } = survivors.kernel

export const spawnSystems: Pick<survivors.SystemTable<Ctx>, 'spawn.wave' | 'spawn.elite' | 'player.path'> = {
  'spawn.wave': (ctx) => () => {
    const { k, scenario, world } = ctx
    const { tick } = world.get(Clock)!
    clearEvents(ctx.events)
    const plan = k.spawnPlan(scenario.seed, tick, world.get(Totals)!.alive, scenario.mobCap, scenario.spawnEvery, scenario.paceScale)
    const [px, py] = k.playerPos(tick)
    for (let i = 0; i < plan.length; i++) {
      const [x, y] = k.ringPoint(px, py, k.SPAWN_RING, k.spawnAngle(scenario.seed, tick, i))
      makeMob(ctx, plan[i], x, y)
    }
  },
  'spawn.elite': (ctx) => () => {
    const { k, scenario, world } = ctx
    const { tick } = world.get(Clock)!
    const elite = tick > 0 && tick % scenario.eliteEvery === 0
    const boss = tick > 0 && tick % scenario.bossEvery === 0 && world.query(ctx.q.bosses).length === 0
    const ring = tick > 0 && tick % (k.RING_SWARM_EVERY * scenario.eliteEvery) === 0
    if (!elite && !boss && !ring) return
    const [px, py] = k.playerPos(tick)
    if (elite) {
      const kind = k.eliteKind(scenario.seed, tick, scenario.paceScale)
      const [x, y] = k.eliteSpawnPoint(scenario.seed, tick, px, py)
      makeMob(ctx, kind, x, y, { elite: true, affix: (gameId) => k.eliteAffixes(scenario.seed, tick, gameId) })
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
    const { tick } = world.get(Clock)!
    const [x, y] = k.playerPos(tick)
    player.set(Position, { x, y })
    const hp = player.get(Hp)!.hp
    if (tick % k.REGEN_PERIOD === 0 && hp < k.maxHp(world.get(Loadout)!.stats.vigor)) player.set(Hp, { hp: hp + 1 })
  },
}
