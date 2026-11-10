import { Not, type QueryTerm } from 'bitecs'
import {
  Age, Burn, Cooldown, Dead, Fleeing, FLAG_TAGS, Garrisoned, Ground, Haste, Health, Kind, Minion, Morale, Overwhelmed, Position,
  Projectile, Routed, Shrine, Start, Stats, Stun, Summoner, Team, Trail, Unit,
} from './components.ts'
import { GameId } from '../shared/components.ts'

// A bitECS query is a list of terms. The world caches the result list by its terms, so these constants are the queries.
export const Q = {
  units: [Unit],
  identified: [GameId],
  renderables: [Unit, GameId, Kind, Team, Position, Health, Trail],
  teams: [Unit, Team],
  thinkers: [Unit, GameId, Kind, Position, Team, Not(Stun), Not(Fleeing), Not(Garrisoned)],
  movers: [Unit, Kind, Team, Stats, Not(Stun), Not(Garrisoned)],
  fleeing: [Unit, Fleeing],
  projectiles: [Projectile, Position],
  attackers: [Unit, GameId, Kind, Team, Position, Stats, Cooldown, Not(Stun), Not(Fleeing)],
  cooldowns: [Unit, Cooldown],
  starts: [Position, Start],
  aged: [Age],
  summoners: [Summoner],
  shrines: [Shrine],
  stunned: [Stun],
  hasted: [Haste],
  burning: [Burn, Health],
  overwhelmed: [Overwhelmed],
  dead: [Dead],
  leaders: [Morale],
  unrouted: [Morale, Not(Routed)],
  members: [Unit, Not(Morale), Not(Fleeing), Not(Dead)],
  home: [Fleeing, GameId, Position, Team, Not(Dead)],
  agedMinions: [Minion, Age],
  agedProjectiles: [Projectile, Age],
  ground: [Ground, Age],
  allProjectiles: [Projectile],
} satisfies Record<string, QueryTerm[]>

/** One query for each SPEC §8 flag tag, in bit order. */
export const FLAG_QUERIES: QueryTerm[][] = FLAG_TAGS.map((tag) => [Unit, tag])
