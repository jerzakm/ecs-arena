import { EXPERIMENTAL_queryColumns as queryColumns, getComponentValue } from 'iris-ecs'
import { Place } from '../components.ts'
import type { Ctx } from '../context.ts'
import { fliers } from '../queries.ts'

/** SPEC-factory §5.4. */
export const steer = (ctx: Ctx) => () => {
  const { k, world, machines } = ctx
  queryColumns(world, fliers, (entities, [drone, pos, vel, acc]) => {
    for (let i = 0; i < entities.length; i++) {
      const goal = machines[(drone.goal[i] === 0 ? drone.source[i] : drone.sink[i]) - 1]
      const [dvx, dvy] = k.velToward(pos.x[i], pos.y[i], getComponentValue(world, goal, Place, 'x')!, getComponentValue(world, goal, Place, 'y')!, k.MAX_SPEED)
      acc.x[i] = Math.max(-k.ACCEL, Math.min(k.ACCEL, dvx - vel.x[i]))
      acc.y[i] = Math.max(-k.ACCEL, Math.min(k.ACCEL, dvy - vel.y[i]))
    }
  })
}

/** SPEC-factory §5.5. */
export const move = (ctx: Ctx) => () => {
  const { k, scenario, world } = ctx
  queryColumns(world, fliers, (entities, [, pos, vel, acc]) => {
    for (let i = 0; i < entities.length; i++) {
      vel.x[i] += acc.x[i]
      vel.y[i] += acc.y[i]
      pos.x[i] = k.clampX(scenario, pos.x[i] + vel.x[i])
      pos.y[i] = k.clampY(scenario, pos.y[i] + vel.y[i])
      const len = k.isqrt(vel.x[i] * vel.x[i] + vel.y[i] * vel.y[i])
      if (len >= 16) {
        pos.c[i] = k.fx.div(vel.x[i] * k.FX, len)
        pos.s[i] = k.fx.div(vel.y[i] * k.FX, len)
      }
    }
  })
}
