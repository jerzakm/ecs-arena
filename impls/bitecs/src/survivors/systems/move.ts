import { query } from 'bitecs'
import { survivors } from '@ecs-arena/spec'
import { Position, Projectile, Velocity } from '../components.ts'
import type { Ctx } from '../context.ts'
import { Q } from '../queries.ts'
import { blocked, hasTag } from '../tags.ts'
const { STATUS } = survivors.kernel
type MoveIds = 'move.mobs' | 'move.proj' | 'move.particles' | 'grid.update'
export const moveSystems: Pick<survivors.SystemTable<Ctx>, MoveIds> = {
  'move.mobs': (ctx) => () => {
    const { k, px, py } = ctx
    for (const m of query(ctx.world, Q.mobs)) {
      if (hasTag(m, STATUS.KNOCKBACK)) {
        const x = Position.x[m], y = Position.y[m]
        ;[Position.x[m], Position.y[m]] = k.stepTo(x, y, 2 * x - px, 2 * y - py, k.KNOCK_SPEED)
      } else if (!blocked(m, k.BLOCKS_MOVE)) {
        Position.x[m] = k.clampToArena(Position.x[m] + Velocity.x[m])
        Position.y[m] = k.clampToArena(Position.y[m] + Velocity.y[m])
      }
    }
  },
  'move.proj': (ctx) => () => {
    const { k, px, py, mobById } = ctx
    const tick = ctx.world.tick
    for (const p of query(ctx.world, Q.homing)) {
      if (Projectile.weapon[p] < 0 || Projectile.ttl[p] === k.INF_TTL) continue
      const t = mobById.get(Projectile.target[p])
      if (t === undefined) continue
      const { speed } = ctx.loadout.weapons[Projectile.weapon[p]]!
      ;[Velocity.x[p], Velocity.y[p]] = k.velToward(Position.x[p], Position.y[p], Position.x[t], Position.y[t], speed)
    }
    for (const p of query(ctx.world, Q.returning)) {
      if (Projectile.weapon[p] < 0 || Projectile.ttl[p] === k.INF_TTL) continue
      const st = ctx.loadout.weapons[Projectile.weapon[p]]!
      if (tick >= Projectile.ttl[p] - Math.ceil(st.life / 2)) {
        ;[Velocity.x[p], Velocity.y[p]] = k.velToward(Position.x[p], Position.y[p], px, py, st.speed)
      }
    }
    for (const p of query(ctx.world, Q.projs)) {
      if (Projectile.ttl[p] === k.INF_TTL) continue
      Position.x[p] = k.clampToArena(Position.x[p] + Velocity.x[p])
      Position.y[p] = k.clampToArena(Position.y[p] + Velocity.y[p])
    }
  },
  'move.particles': (ctx) => () => {
    const { k } = ctx
    for (const p of query(ctx.world, Q.parts)) {
      Position.x[p] = k.clampToArena(Position.x[p] + Velocity.x[p])
      Position.y[p] = k.clampToArena(Position.y[p] + Velocity.y[p])
      Velocity.x[p] = k.fx.div(Velocity.x[p] * 7, 8)
      Velocity.y[p] = k.fx.div(Velocity.y[p] * 7, 8)
    }
  },
  'grid.update': (ctx) => () => {
    for (const m of query(ctx.world, Q.mobs)) ctx.grid.update(m, Position.x[m], Position.y[m])
  },
}
