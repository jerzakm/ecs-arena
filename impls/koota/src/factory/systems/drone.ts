import type { Ctx } from '../context.ts'
import { Sink, Slot, Source } from '../traits.ts'

/** SPEC-factory §5.4. The goal machine is the target of the Source or Sink relation. */
export const steer = (ctx: Ctx) => {
  const { k, world, q } = ctx
  const { MAX_SPEED, ACCEL } = k
  return () => {
    world.query(q.steering).updateEach(([p, m, mi], e) => {
      const goal = e.targetFor(mi.goal === 0 ? Source : Sink)!.get(Slot)!
      const [dvx, dvy] = k.velToward(p.x, p.y, goal.x, goal.y, MAX_SPEED)
      m.ax = Math.max(-ACCEL, Math.min(ACCEL, dvx - m.vx))
      m.ay = Math.max(-ACCEL, Math.min(ACCEL, dvy - m.vy))
    })
  }
}

/** SPEC-factory §5.5. */
export const move = (ctx: Ctx) => {
  const { k, scenario, world, q } = ctx
  return () => {
    world.query(q.flying).updateEach(([p, m]) => {
      m.vx += m.ax
      m.vy += m.ay
      p.x = k.clampX(scenario, p.x + m.vx)
      p.y = k.clampY(scenario, p.y + m.vy)
      const len = k.isqrt(m.vx * m.vx + m.vy * m.vy)
      if (len >= 16) {
        p.c = k.fx.div(m.vx * k.FX, len)
        p.s = k.fx.div(m.vy * k.FX, len)
      }
    })
  }
}
