import { survivors } from '@ecs-arena/spec'
import { Clock, Loadout, Mob, Position, Targets } from '../traits.ts'
import { FLAG_CHANGED } from '../../shared/workarounds.ts'
import type { Ctx } from '../context.ts'

export const moveSystems: Pick<survivors.SystemTable<Ctx>, 'move.mobs' | 'move.proj' | 'move.particles' | 'grid.update'> = {
  'move.mobs': (ctx) => () => {
    const { k, world } = ctx
    const { x: px, y: py } = ctx.player.get(Position)!
    // `grid.update` reads the Changed(Position) tracker, which these writes feed only with FLAG_CHANGED.
    world.query(ctx.q.knocked).updateEach(([, p]) => {
      ;[p.x, p.y] = k.stepTo(p.x, p.y, 2 * p.x - px, 2 * p.y - py, k.KNOCK_SPEED)
    }, FLAG_CHANGED)
    world.query(ctx.q.free).updateEach(([p, v]) => {
      p.x = k.clampToArena(p.x + v.x)
      p.y = k.clampToArena(p.y + v.y)
    }, FLAG_CHANGED)
  },
  'move.proj': (ctx) => () => {
    const { k, world } = ctx
    const { tick } = world.get(Clock)!
    const { weapons } = world.get(Loadout)!
    const { x: px, y: py } = ctx.player.get(Position)!
    // (a) homing, then (b) return, then (c) the step. A hostile shot and an orbiter skip (a) and (b), and an orbiter skips (c).
    world.query(ctx.q.homing).updateEach(([pr, p, v], e) => {
      const target = e.targetFor(Targets)
      if (target) {
        const t = target.get(Position)!
        ;[v.x, v.y] = k.velToward(p.x, p.y, t.x, t.y, weapons[pr.weapon]!.speed)
      }
    })
    world.query(ctx.q.returning).updateEach(([pr, p, v, ttl]) => {
      const st = weapons[pr.weapon]!
      if (tick >= ttl.value - Math.ceil(st.life / 2)) [v.x, v.y] = k.velToward(p.x, p.y, px, py, st.speed)
    })
    world.query(ctx.q.projectiles).updateEach(([, p, v]) => {
      p.x = k.clampToArena(p.x + v.x)
      p.y = k.clampToArena(p.y + v.y)
    })
  },
  'move.particles': (ctx) => () => {
    const { k } = ctx
    ctx.world.query(ctx.q.particles).updateEach(([, p, v]) => {
      p.x = k.clampToArena(p.x + v.x)
      p.y = k.clampToArena(p.y + v.y)
      v.x = k.fx.div(v.x * 7, 8)
      v.y = k.fx.div(v.y * 7, 8)
    })
  },
  'grid.update': (ctx) => () => {
    // koota 0.6.6 can report an entity that is not a Mob on the first read of a tracker query (workarounds.ts),
    // so the system checks the tag.
    ctx.world.query(ctx.q.moved).readEach(([p], e) => { if (e.has(Mob)) ctx.grid.update(e.id(), p.x, p.y) })
  },
}
