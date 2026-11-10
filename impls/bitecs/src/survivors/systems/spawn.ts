import { query } from 'bitecs'
import { survivors } from '@ecs-arena/spec'
import { Mob, Player, Position } from '../components.ts'
import type { Ctx } from '../context.ts'
import { makeMob } from '../entities.ts'
import { clearEvents } from '../events.ts'
import { Q } from '../queries.ts'
import { addTag } from '../tags.ts'
const { MOB, STATUS } = survivors.kernel
type SpawnIds = 'spawn.wave' | 'spawn.elite' | 'player.path'
export const spawnSystems: Pick<survivors.SystemTable<Ctx>, SpawnIds> = {
  'spawn.wave': (ctx) => () => {
    const { k, scenario, world } = ctx
    const tick = world.tick
    clearEvents(ctx.events)
    const alive = query(ctx.world, Q.mobs).length
    const plan = k.spawnPlan(scenario.seed, tick, alive, scenario.mobCap, scenario.spawnEvery, scenario.paceScale)
    const [px, py] = k.playerPos(tick)
    for (let i = 0; i < plan.length; i++) {
      const [x, y] = k.ringPoint(px, py, k.SPAWN_RING, k.spawnAngle(scenario.seed, tick, i))
      makeMob(ctx, plan[i], x, y)
    }
  },
  'spawn.elite': (ctx) => () => {
    const { k, scenario, world } = ctx
    const tick = world.tick
    const elite = tick > 0 && tick % scenario.eliteEvery === 0
    const boss = tick > 0 && tick % scenario.bossEvery === 0 && query(ctx.world, Q.bosses).length === 0
    const ring = tick > 0 && tick % (k.RING_SWARM_EVERY * scenario.eliteEvery) === 0
    if (!(elite || boss || ring)) return
    const [px, py] = k.playerPos(tick)
    if (elite) {
      const kind = k.eliteKind(scenario.seed, tick, scenario.paceScale)
      const [x, y] = k.eliteSpawnPoint(scenario.seed, tick, px, py)
      const m = makeMob(ctx, kind, x, y, k.bit(STATUS.ELITE))
      Mob.affix[m] = k.eliteAffixes(scenario.seed, tick, ctx.totals.nextId - 1)
      if (Mob.affix[m] & k.AFFIX.SHIELDED) {
        Mob.shield[m] = k.SHIELD_VALUE
        addTag(ctx, m, STATUS.SHIELDED, tick + k.DUR.SHIELDED)
      }
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
    ;[ctx.px, ctx.py] = k.playerPos(world.tick)
    Position.x[player] = ctx.px
    Position.y[player] = ctx.py
    if (world.tick % k.REGEN_PERIOD === 0 && Player.hp[player] < k.maxHp(ctx.loadout.stats.vigor)) Player.hp[player] += 1
  },
}
