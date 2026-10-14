import { Not, createAdded, createChanged, createQuery } from 'koota'
import {
  Cooldown, Fleeing, GameId, Health, KillCount, Kind, Position, Projectile, Routed, Start, Stats, Stun, Team, Unit, Veteran,
} from './components.ts'

export const createQueries = () => {
  const Added = createAdded()
  const Changed = createChanged()
  return {
    // A query that holds only a tracker reports every new entity in koota 0.6.6, so each tracker is paired with Unit.
    newlyRouted: createQuery(Unit, Added(Routed)),
    newlyFleeing: createQuery(Unit, Added(Fleeing)),
    newlyVeteran: createQuery(Unit, Added(Veteran)),
    killsChanged: createQuery(Unit, Changed(KillCount), Not(Veteran)),
    unitsQuery: createQuery(Unit, GameId, Team, Position, Health),
    teamQuery: createQuery(Unit, Team),
    thinkers: createQuery(Unit, GameId, Kind, Position, Team, Not(Stun), Not(Fleeing)),
    movers: createQuery(Unit, Kind, Team, Stats, Not(Stun)),
    projectiles: createQuery(Projectile, Position),
    attackers: createQuery(Unit, GameId, Kind, Team, Position, Stats, Cooldown, Not(Stun), Not(Fleeing)),
    cooldowns: createQuery(Unit, Cooldown),
    starts: createQuery(Position, Start),
  }
}

export type Queries = ReturnType<typeof createQueries>
