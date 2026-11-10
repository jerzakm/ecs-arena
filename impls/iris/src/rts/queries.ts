import { added, type EntityId, not, pair } from 'iris-ecs'
import { GameId } from '../shared/components.ts'
import {
  Age, AnyChild, AnyGarrison, Bannered, Burn, Cooldown, Dead, Fleeing, GarrisonOf, Ground, Haste, Health, Kind, MemberOf, Minion, Morale,
  Overwhelmed, Position, Projectile, Routed, Shrine, Start, Stats, Stun, Summoner, Targets, Team, Threat, Trail, Unit, Veteran,
} from './components.ts'

// A query is a list of terms. iris caches the match of each distinct term list (by content, not identity), so the lists here are shared
// definitions.
// The trackers (`added`) keep one window for each system that reads them, and morale and stats own them.
export const newlyRouted = [Unit, added(Routed)] as const
export const newlyFleeing = [Unit, added(Fleeing)] as const
export const newlyVeteran = [Unit, added(Veteran)] as const
export const renderables = [Unit, GameId, Kind, Team, Position, Health, Trail] as const
export const teamQuery = [Unit, Team] as const
export const thinkers = [Unit, GameId, Kind, Position, Team, Targets, not(Stun), not(Fleeing), not(AnyGarrison)] as const
const movers = [Unit, Kind, Team, Stats, Position, Trail, Targets, not(Stun), not(AnyGarrison)] as const
// The movers by how they find a parent (see the banner pass): `MemberOf`, else `ChildOf`, else none.
export const moversMember = [...movers, MemberOf] as const
export const moversMinion = [...movers, not(MemberOf), AnyChild] as const
export const moversLoose = [...movers, not(MemberOf), not(AnyChild)] as const
// The banner pass: a unit has a parent through `MemberOf`, else through `ChildOf`, else none. A unit with none keeps no banner.
export const unitsMember = [Unit, MemberOf] as const
export const unitsMinion = [Unit, not(MemberOf), AnyChild] as const
export const unitsLoose = [Unit, Bannered, not(MemberOf), not(AnyChild)] as const
export const projectiles = [Projectile, Position] as const
export const attackers = [Unit, GameId, Kind, Team, Position, Stats, Cooldown, Targets, not(Stun), not(Fleeing)] as const
export const cooldowns = [Unit, Cooldown] as const
export const starts = [Position, Start] as const
export const aged = [Age] as const
export const targeting = [Unit, Team, Targets] as const
export const anyTargeting = [Targets] as const
export const threatened = [Threat] as const
export const members = [MemberOf] as const
export const leadersOfMembers = [Morale, MemberOf] as const
export const followers = [MemberOf, not(Morale), not(Fleeing), not(Dead)] as const
export const minionsOf = [AnyChild] as const
export const oldMinions = [Minion, Age] as const
export const doneProjectiles = [Projectile, Age] as const
export const groundAged = [Ground, Age] as const
export const overwhelmed = [Overwhelmed] as const
export const stunned = [Stun] as const
export const hasted = [Haste] as const
export const burning = [Burn, Health] as const
export const dead = [Dead] as const
export const identified = [GameId] as const
export const allShrines = [Shrine] as const
export const summonerUnits = [Summoner, GameId] as const
export const unroutedLeaders = [Morale, not(Routed)] as const
export const homebound = [Fleeing, GameId, Position, Team, not(Dead)] as const
/** The units in the garrison of one shrine. */
export const garrisonOf = (shrine: EntityId) => [pair(GarrisonOf, shrine)] as const

/** Per system: the tracker queries it reads. `load` reads each once to drop the events of the discarded ticks. */
export const TRACKERS = {
  morale: [newlyRouted, newlyFleeing],
  stats: [newlyVeteran],
} as const
