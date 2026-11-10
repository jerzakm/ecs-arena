import { EXPERIMENTAL_queryColumns as queryColumns, getComponentValue, hasComponent } from 'iris-ecs'
import { survivors } from '@ecs-arena/spec'
import { Position, TRAIT_TAGS } from '../components.ts'
import type { Ctx } from '../context.ts'
import { allMobs, knocked, movers, moving, particles } from '../queries.ts'

const { TRAIT } = survivors.kernel
const HOMING = Math.log2(TRAIT.HOMING), RETURN = Math.log2(TRAIT.RETURN)

export const moveSystems: Pick<survivors.SystemTable<Ctx>, 'move.mobs' | 'move.proj' | 'move.particles' | 'grid.update'> = {
  'move.mobs': (ctx) => () => {
    const { k, px, py, world } = ctx
    queryColumns(world, knocked, (entities, [, pos]) => {
      for (let i = 0; i < entities.length; i++) {
        const [x, y] = k.stepTo(pos.x[i], pos.y[i], 2 * pos.x[i] - px, 2 * pos.y[i] - py, k.KNOCK_SPEED)
        pos.x[i] = x
        pos.y[i] = y
      }
    })
    queryColumns(world, movers, (entities, [pos, vel]) => {
      for (let i = 0; i < entities.length; i++) {
        pos.x[i] = k.clampToArena(pos.x[i] + vel.x[i])
        pos.y[i] = k.clampToArena(pos.y[i] + vel.y[i])
      }
    })
  },
  'move.proj': (ctx) => () => {
    const { k, tick, px, py, world } = ctx
    queryColumns(world, moving, (entities, [proj, , pos, vel, ttl]) => {
      // The trait tags are the same for the whole archetype: one read steers or skips every projectile in it.
      const homing = hasComponent(world, entities[0], TRAIT_TAGS[HOMING]), back = hasComponent(world, entities[0], TRAIT_TAGS[RETURN])
      for (let i = 0; i < entities.length; i++) {
        if (ttl.at[i] === k.INF_TTL) continue // an orbiter does not move here
        const weapon = proj.weapon[i]
        if (weapon >= 0) {
          const st = ctx.loadout.weapons[weapon]!
          if (homing) {
            const t = ctx.entityOf.get(proj.target[i])
            if (t !== undefined) {
              const tx = getComponentValue(world, t, Position, 'x')!, ty = getComponentValue(world, t, Position, 'y')!
              const [vx, vy] = k.velToward(pos.x[i], pos.y[i], tx, ty, st.speed)
              vel.x[i] = vx
              vel.y[i] = vy
            }
          }
          if (back && tick >= ttl.at[i] - Math.ceil(st.life / 2)) {
            const [vx, vy] = k.velToward(pos.x[i], pos.y[i], px, py, st.speed)
            vel.x[i] = vx
            vel.y[i] = vy
          }
        }
        pos.x[i] = k.clampToArena(pos.x[i] + vel.x[i])
        pos.y[i] = k.clampToArena(pos.y[i] + vel.y[i])
      }
    })
  },
  'move.particles': (ctx) => () => {
    const { k, world } = ctx
    queryColumns(world, particles, (entities, [, pos, vel]) => {
      for (let i = 0; i < entities.length; i++) {
        pos.x[i] = k.clampToArena(pos.x[i] + vel.x[i])
        pos.y[i] = k.clampToArena(pos.y[i] + vel.y[i])
        vel.x[i] = k.fx.div(vel.x[i] * 7, 8)
        vel.y[i] = k.fx.div(vel.y[i] * 7, 8)
      }
    })
  },
  'grid.update': (ctx) => () => {
    const { mobs, world } = ctx
    queryColumns(world, allMobs, (entities, [pos]) => {
      for (let i = 0; i < entities.length; i++) mobs.grid.update(mobs.handleOf.get(entities[i])!, pos.x[i], pos.y[i])
    })
  },
}
