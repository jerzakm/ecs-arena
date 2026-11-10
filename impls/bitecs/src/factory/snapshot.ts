import { query } from 'bitecs'
import type { CanonicalState } from '@ecs-arena/spec'
import { GameId } from '../shared/components.ts'
import { byGameId, sortedByGameId } from '../shared/util.ts'
import { Crate, Drone, Machine, Motion, Transform } from './components.ts'
import type { Ctx } from './context.ts'
import { flagsOf } from './entities.ts'
import { Q } from './queries.ts'

/** SPEC-factory §8. The changed list is sorted here, so a run that never takes a snapshot never pays for the sort. */
export const snapshot = (ctx: Ctx): CanonicalState => {
  const { k, totals, world, changed } = ctx
  const drones = sortedByGameId(ctx, Q.drones)
  const crates = sortedByGameId(ctx, Q.crates)
  const s: number[] = k.worldHeader(totals, {
    powered: ctx.up.filter(Boolean).length, working: query(world, Q.working).length, drones: drones.length, crates: crates.length,
  })
  changed.sort(byGameId)
  s.push(changed.length)
  for (const m of changed) s.push(GameId.id[m], Machine.kind[m], Machine.input[m], Machine.output[m], Machine.progress[m], flagsOf(ctx, m))
  for (const d of drones) {
    const top = Drone.top[d]
    s.push(
      GameId.id[d], Transform.x[d], Transform.y[d], Motion.vx[d], Motion.vy[d], Transform.c[d], Transform.s[d], Drone.born[d],
      Drone.goal[d], Drone.cargo[d], Drone.item[d], GameId.id[Drone.source[d]], GameId.id[Drone.sink[d]], top === -1 ? -1 : GameId.id[top],
    )
  }
  for (const c of crates) {
    s.push(GameId.id[c], GameId.id[Crate.parent[c]], Crate.item[c], Transform.x[c], Transform.y[c], Transform.c[c], Transform.s[c])
  }
  return s
}
