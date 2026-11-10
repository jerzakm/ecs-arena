import { Not, Or, createAdded, createChanged, createQuery, createRemoved } from 'koota'
import { Boost, Crate, Drone, GameId, Io, Kind, Machine, Manual, Mission, Motion, Pose, Powered, Working } from './traits.ts'

export const createQueries = () => {
  // Each tracker query has its own modifier, because reading a tracker resets it. Machine anchors it (workarounds.ts trackerQuery).
  const ioAble = createQuery(Machine, createChanged()(Io), Kind, Or(Powered, Manual))
  const ioUnable = createQuery(Machine, createChanged()(Io), Not(Powered), Not(Manual))
  const gained = createQuery(Machine, createAdded()(Powered), Io, Kind)
  const lost = createQuery(Machine, createRemoved()(Powered))
  return {
    // work, state. A tracker modifier puts its trait first in the result tuple.
    boosted: createQuery(Working, Io, Kind, Boost),
    plain: createQuery(Working, Io, Kind, Not(Boost)),
    ioAble, ioUnable, gained, lost,
    machines: createQuery(Machine, Io, Kind),
    // drones and crates
    steering: createQuery(Drone, Pose, Motion, Mission),
    flying: createQuery(Drone, Pose, Motion),
    docking: createQuery(Drone, GameId, Pose, Mission),
    crates: createQuery(Crate, GameId),
  }
}
export type Queries = ReturnType<typeof createQueries>
