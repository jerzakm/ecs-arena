import { query } from 'bitecs'
import { Drone, Machine, Motion, Transform } from '../components.ts'
import type { Ctx } from '../context.ts'
import { Q } from '../queries.ts'

/** SPEC-factory §5.4. */
export const steer = (ctx: Ctx) => {
  const { k, world } = ctx
  const { ACCEL, MAX_SPEED } = k
  return () => {
    for (const e of query(world, Q.drones)) {
      const goal = Drone.goal[e] === 0 ? Drone.source[e] : Drone.sink[e]
      const [dvx, dvy] = k.velToward(Transform.x[e], Transform.y[e], Machine.x[goal], Machine.y[goal], MAX_SPEED)
      Motion.ax[e] = Math.max(-ACCEL, Math.min(ACCEL, dvx - Motion.vx[e]))
      Motion.ay[e] = Math.max(-ACCEL, Math.min(ACCEL, dvy - Motion.vy[e]))
    }
  }
}

/** SPEC-factory §5.5. The drones are dense columns, so the loop reads typed arrays by entity id. */
export const move = (ctx: Ctx) => {
  const { k, scenario, world } = ctx
  return () => {
    for (const e of query(world, Q.drones)) {
      const vx = Motion.vx[e] += Motion.ax[e]
      const vy = Motion.vy[e] += Motion.ay[e]
      Transform.x[e] = k.clampX(scenario, Transform.x[e] + vx)
      Transform.y[e] = k.clampY(scenario, Transform.y[e] + vy)
      const len = k.isqrt(vx * vx + vy * vy)
      if (len >= 16) {
        Transform.c[e] = k.fx.div(vx * k.FX, len)
        Transform.s[e] = k.fx.div(vy * k.FX, len)
      }
    }
  }
}
