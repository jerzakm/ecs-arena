import {
  collectEntities, destroyEntity, type EntityId, EXPERIMENTAL_queryColumns as queryColumns, getComponentValue, getResourceValue,
  hasComponent, setResourceValue,
} from 'iris-ecs'
import { survivors } from '@ecs-arena/spec'
import { GameId } from '../../shared/components.ts'
import { byGameId } from '../../shared/util.ts'
import { IFrames, Kind, Position, Run } from '../components.ts'
import type { Ctx } from '../context.ts'
import { makeMob, makePart, makePickup } from '../entities.ts'
import { pushKill, STRIDE } from '../events.ts'
import { hurtPlayer } from '../hits.ts'
import { dying, orphans, ttls } from '../queries.ts'
import { flagsOf } from '../tags.ts'

const { STATUS, MOB, PICKUP_KIND, PARTICLE_KIND, EVENT } = survivors.kernel

export const cleanupSystems: Pick<survivors.SystemTable<Ctx>, 'cleanup.ttl' | 'cleanup.death' | 'cleanup.drops' | 'cleanup.cascade'> = {
  'cleanup.ttl': (ctx) => () => {
    const { tick, world } = ctx
    const due: EntityId[] = []
    queryColumns(world, ttls, (entities, [ttl]) => {
      for (let i = 0; i < entities.length; i++) if (ttl.at[i] <= tick) due.push(entities[i])
    })
    for (const e of due) destroyEntity(world, e)
  },
  'cleanup.death': (ctx) => () => {
    const { world } = ctx
    const dead = collectEntities(world, dying).map((e) => ({ id: getComponentValue(world, e, GameId, 'id'), e })).sort(byGameId)
    for (const { id, e } of dead) {
      const x = getComponentValue(world, e, Position, 'x')!, y = getComponentValue(world, e, Position, 'y')!
      pushKill(ctx, id, getComponentValue(world, e, Kind, 'value')!, x, y, flagsOf(world, e))
      setResourceValue(world, Run, 'kills', (getResourceValue(world, Run, 'kills')! + 1) | 0)
    }
    // A projectile that targets a dead mob reads as targetless: the link is a gameId that no live entity holds.
    for (const { e } of dead) destroyEntity(world, e)
  },
  'cleanup.drops': (ctx) => () => {
    const { k, world, scenario, tick } = ctx
    const kills = ctx.events.lists[EVENT.KILL]
    for (let i = 0; i < kills.length; i += STRIDE.KILL) {
      const [id, kind, x, y, flags] = kills.slice(i, i + STRIDE.KILL)
      const def = k.MOBS[kind]
      const elite = (flags & k.bit(STATUS.ELITE)) !== 0
      const xp = def.xp * (elite ? k.ELITE_XP_MULT : 1)
      if (xp > 0) makePickup(ctx, PICKUP_KIND.GEM, x, y, xp)
      if (k.dropsHeart(scenario.seed, tick, id, kind)) makePickup(ctx, PICKUP_KIND.HEART, x, y, k.HEART_HEAL)
      if (kind === MOB.BOSS || elite) makePickup(ctx, PICKUP_KIND.CHEST, x, y, 0)
      if (def.death === 'split') {
        makeMob(ctx, MOB.SWARMLING, k.clampToArena(x - k.SPLIT_OFFSET), y)
        makeMob(ctx, MOB.SWARMLING, k.clampToArena(x + k.SPLIT_OFFSET), y)
      } else if (def.death === 'explode' && k.distSq(x, y, ctx.px, ctx.py) <= k.EXPLODER_BLAST * k.EXPLODER_BLAST) {
        if (!hasComponent(world, ctx.player, IFrames)) hurtPlayer(ctx, k.EXPLODER_DAMAGE)
      }
      for (let n = 0; n < k.scaleCount(k.BURST_COUNT, scenario.particleScale); n++) {
        const [vx, vy] = k.burstVel(scenario.seed, tick, id, n)
        makePart(ctx, PARTICLE_KIND.BURST, x, y, vx, vy, tick + k.BURST_LIFE)
      }
    }
  },
  'cleanup.cascade': (ctx) => () => {
    const { world } = ctx
    for (const e of collectEntities(world, orphans)) destroyEntity(world, e)
  },
}
