import type { Entity, Relation } from 'koota'
import type { CanonicalState } from '@ecs-arena/spec'
import type { Ctx } from './context.ts'
import { ChildOf, Crate, Drone, GameId, Lit, Mission, Motion, Pose, Sink, Source, Top, Totals, Working, Cargo } from './traits.ts'
import { sortedByGameId } from '../shared/util.ts'

/** The gameId that a relation of `e` points to, or -1 for none. */
const link = (e: Entity, relation: Relation): number => e.targetFor(relation)?.get(GameId)!.id ?? -1

/** SPEC-factory §8. The changed list was built by `state`. It is sorted here, so a run that never takes a snapshot never pays for it. */
export const snapshot = (ctx: Ctx): CanonicalState => {
  const { k, world, changed } = ctx
  const drones = sortedByGameId(world, GameId, Drone)
  const crates = sortedByGameId(world, GameId, Crate)
  const s: number[] = k.worldHeader(world.get(Totals)!, {
    powered: world.query(Lit).length, working: world.query(Working).length, drones: drones.length, crates: crates.length,
  })
  changed.sort((a, b) => a.gameId - b.gameId)
  s.push(changed.length)
  for (const m of changed) s.push(m.gameId, m.kind, m.input, m.output, m.progress, m.flags)
  for (const { gameId, e } of drones) {
    const p = e.get(Pose)!, v = e.get(Motion)!, mi = e.get(Mission)!
    s.push(gameId, p.x, p.y, v.vx, v.vy, p.c, p.s, mi.born, mi.goal, mi.cargo, mi.item, link(e, Source), link(e, Sink), link(e, Top))
  }
  for (const { gameId, e } of crates) {
    const p = e.get(Pose)!
    s.push(gameId, link(e, ChildOf), e.get(Cargo)!.item, p.x, p.y, p.c, p.s)
  }
  return s
}
