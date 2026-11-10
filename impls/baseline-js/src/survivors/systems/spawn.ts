import { survivors } from '@ecs-arena/spec'
import type { Ctx } from '../context.ts'
import { makeMob } from '../entities.ts'
import { ENT } from '../types.ts'
const { MOB, STATUS } = survivors.kernel
export const spawnSystems: Pick<survivors.SystemTable<Ctx>, 'spawn.wave' | 'spawn.elite' | 'player.path'> = {
  'spawn.wave': (ctx) => () => {
    const { k, scenario } = ctx
    for (let t = 0; t < 5; t++) ctx.ev[t].length = 0
    ctx.evAll.length = 0
    const plan = k.spawnPlan(scenario.seed, ctx.tick, ctx.lists[ENT.MOB].length, scenario.mobCap, scenario.spawnEvery, scenario.paceScale)
    const [px, py] = k.playerPos(ctx.tick)
    for (let i = 0; i < plan.length; i++) {
      const [x, y] = k.ringPoint(px, py, k.SPAWN_RING, k.spawnAngle(scenario.seed, ctx.tick, i))
      makeMob(ctx, plan[i], x, y)
    }
  },
  'spawn.elite': (ctx) => {
    const { k, scenario } = ctx
    const { addTag } = ctx.tags
    const { gate } = ctx.gates
    return () => {
      const { tick } = ctx
      const elite = tick > 0 && tick % scenario.eliteEvery === 0
      const boss = tick > 0 && tick % scenario.bossEvery === 0 && ctx.kindCount[MOB.BOSS] === 0
      const ring = tick > 0 && tick % (k.RING_SWARM_EVERY * scenario.eliteEvery) === 0
      if (!gate('spawn.elite', elite || boss || ring, () => elite || boss || ring)) return
      const [px, py] = k.playerPos(tick)
      if (elite) {
        const kind = k.eliteKind(scenario.seed, tick, scenario.paceScale)
        const [x, y] = k.eliteSpawnPoint(scenario.seed, tick, px, py)
        const m = makeMob(ctx, kind, x, y, k.bit(STATUS.ELITE))
        m.affix = k.eliteAffixes(scenario.seed, tick, m.gameId)
        if (m.affix & k.AFFIX.SHIELDED) {
          m.shield = k.SHIELD_VALUE
          addTag(m, STATUS.SHIELDED, tick + k.DUR.SHIELDED)
        }
        if (m.affix) ctx.add('rule.affix')
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
    }
  },
  'player.path': (ctx) => () => {
    const { k, player } = ctx
    ;[ctx.px, ctx.py] = k.playerPos(ctx.tick)
    player.x = ctx.px
    player.y = ctx.py
    if (ctx.tick % k.REGEN_PERIOD === 0 && player.hp < k.maxHp(ctx.pstat.vigor)) player.hp += 1
  },
}
