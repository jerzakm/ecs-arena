import { Not, createAdded, createChanged, createQuery } from 'koota'
import {
  Cooldown, Fleeing, GameId, Garrisoned, Health, KillCount, Kind, Position, Projectile, Routed, Start, Stats, Stun, Team, Trail, Unit,
  Veteran,
} from './traits.ts'
import { trackerQuery } from '../shared/workarounds.ts'

export const createQueries = () => {
  const Added = createAdded()
  const Changed = createChanged()
  const newlyRouted = trackerQuery(Unit, Added(Routed))
  const newlyFleeing = trackerQuery(Unit, Added(Fleeing))
  const newlyVeteran = trackerQuery(Unit, Added(Veteran))
  const killsChanged = trackerQuery(Unit, Changed(KillCount), Not(Veteran))
  return {
    newlyRouted,
    newlyFleeing,
    newlyVeteran,
    killsChanged,
    trackers: [newlyRouted, newlyFleeing, newlyVeteran, killsChanged], // reading a tracker resets it, so `load` reads them all
    renderables: createQuery(Unit, GameId, Kind, Team, Position, Health, Trail),
    teams: createQuery(Unit, Team),
    thinkers: createQuery(Unit, GameId, Kind, Position, Team, Not(Stun), Not(Fleeing), Not(Garrisoned)),
    movers: createQuery(Unit, Kind, Team, Stats, Not(Stun), Not(Garrisoned)),
    projectiles: createQuery(Projectile, Position),
    attackers: createQuery(Unit, GameId, Kind, Team, Position, Stats, Cooldown, Not(Stun), Not(Fleeing)),
    cooldowns: createQuery(Unit, Cooldown),
    starts: createQuery(Position, Start),
  }
}

export type Queries = ReturnType<typeof createQueries>
