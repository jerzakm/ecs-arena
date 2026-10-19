import { Not, type QueryTerm } from 'bitecs'
import {
  Cooldown, Fleeing, GameId, Garrisoned, Health, Kind, Position, Projectile, Start, Stats, Stun, Team, Trail, Unit,
} from './components.ts'

// A bitECS query is a list of terms. The world caches the result list by its terms, so these constants are the queries.
export const Q = {
  renderables: [Unit, GameId, Kind, Team, Position, Health, Trail],
  teamQuery: [Unit, Team],
  thinkers: [Unit, GameId, Kind, Position, Team, Not(Stun), Not(Fleeing), Not(Garrisoned)],
  movers: [Unit, Kind, Team, Stats, Not(Stun), Not(Garrisoned)],
  fleeing: [Unit, Fleeing],
  projectiles: [Projectile, Position],
  attackers: [Unit, GameId, Kind, Team, Position, Stats, Cooldown, Not(Stun), Not(Fleeing)],
  cooldowns: [Unit, Cooldown],
  starts: [Position, Start],
} satisfies Record<string, QueryTerm[]>
