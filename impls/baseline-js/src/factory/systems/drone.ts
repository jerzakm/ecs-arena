import type { Ctx } from '../context.ts'

/** SPEC-factory §5.4. */
export const steer = (ctx: Ctx) => {
  const { k } = ctx
  return () => {
    const drones = ctx.drones
    for (let i = 0; i < drones.length; i++) {
      const d = drones[i]
      const goal = d.goal === 0 ? d.source : d.sink
      const [dvx, dvy] = k.velToward(d.x, d.y, goal.x, goal.y, k.MAX_SPEED)
      d.ax = Math.max(-k.ACCEL, Math.min(k.ACCEL, dvx - d.vx))
      d.ay = Math.max(-k.ACCEL, Math.min(k.ACCEL, dvy - d.vy))
    }
  }
}

/** SPEC-factory §5.5. The naive code reaches each field of a drone through a `Map` lookup by gameId. */
export const move = (ctx: Ctx) => {
  const { k, scenario, nv } = ctx
  const direct = () => {
    const drones = ctx.drones
    for (let i = 0; i < drones.length; i++) {
      const d = drones[i]
      d.vx += d.ax
      d.vy += d.ay
      d.x = k.clampX(scenario, d.x + d.vx)
      d.y = k.clampY(scenario, d.y + d.vy)
      const len = k.isqrt(d.vx * d.vx + d.vy * d.vy)
      if (len >= 16) {
        d.c = k.fx.div(d.vx * k.FX, len)
        d.s = k.fx.div(d.vy * k.FX, len)
      }
    }
  }
  const byId = () => {
    const drones = ctx.drones
    const at = (id: number) => ctx.droneById.get(id)!
    for (let i = 0; i < drones.length; i++) {
      const id = drones[i].gameId
      at(id).vx = at(id).vx + at(id).ax
      at(id).vy = at(id).vy + at(id).ay
      at(id).x = k.clampX(scenario, at(id).x + at(id).vx)
      at(id).y = k.clampY(scenario, at(id).y + at(id).vy)
      const len = k.isqrt(at(id).vx * at(id).vx + at(id).vy * at(id).vy)
      if (len >= 16) {
        at(id).c = k.fx.div(at(id).vx * k.FX, len)
        at(id).s = k.fx.div(at(id).vy * k.FX, len)
      }
    }
  }
  const run = nv['drone.move'] ? byId : direct
  return () => {
    ctx.begin('drone.move')
    run()
    ctx.end('drone.move')
    ctx.add('drone.move', ctx.drones.length)
  }
}
