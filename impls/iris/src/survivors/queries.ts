import { type EntityId, not, pair } from 'iris-ecs'
import { GameId } from '../shared/components.ts'
import {
  Affix, AnyChild, Aux, BLOCKS_ACT_TAGS, BLOCKS_MOVE_TAGS, BossPhase, Burning, Charger, Chase, ChildOf, Dying, Fuse, Fuses, Heals, Held,
  Hostile, Hp, Incoming, Kind, Kite, Knockback, Mob, Orbiter, Particle, Phases, Pickup, Position, Projectile, Shoots, Summoned, Summons,
  TIMED, Ttl, Velocity, Weave,
} from './components.ts'

// The tags that stop an action are negated terms, so one archetype test drops every blocked mob (SPEC-survivors §3.1). The tag lists
// come from the kernel masks BLOCKS_MOVE and BLOCKS_ACT, so a change of the kernel changes these queries.
const free = BLOCKS_MOVE_TAGS.map((tag) => not(tag))
const able = BLOCKS_ACT_TAGS.map((tag) => not(tag))

export const movers = [Mob, Position, Velocity, ...free] as const
export const allMobs = [Mob, Position] as const
export const knocked = [Mob, Knockback, Position] as const
export const chasers = [Mob, Chase, Kind, Affix, Position, Velocity, ...free] as const
export const weavers = [Mob, Weave, GameId, Kind, Affix, Position, Velocity, ...free] as const
export const chargers = [Mob, Charger, GameId, Kind, Affix, Position, Velocity, Aux, ...able] as const
export const kiters = [Mob, Kite, GameId, Kind, Affix, Position, Velocity, ...free] as const
export const shooters = [Mob, Shoots, GameId, Position, ...able] as const
export const summoners = [Mob, Summons, GameId, Position, ...able] as const
export const healers = [Mob, Heals, GameId, Position, ...able] as const
export const fusers = [Mob, Fuses, GameId, Position, not(Fuse), ...able] as const
export const fuseDue = [Mob, Fuses, Fuse] as const
export const burningDamage = [Mob, Burning, Incoming] as const
export const burningMobs = [Mob, Burning, GameId, Position] as const
export const ghosts = [Mob, Phases, GameId] as const
export const bosses = [Mob, BossPhase] as const
export const affixed = [Mob, GameId, Affix, Position] as const
export const orbiters = [Orbiter, Projectile, GameId] as const
export const moving = [Projectile, GameId, Position, Velocity, Ttl] as const
export const ttls = [Ttl] as const
export const dying = [Mob, Dying, GameId] as const
export const orphans = [Mob, Summoned, not(AnyChild)] as const
export const pickups = [Pickup, GameId, Position] as const
export const particles = [Particle, Position, Velocity] as const
export const incoming = [Mob, GameId, Hp, Incoming, Kind] as const
export const hostile = [Hostile, Projectile, GameId, Position] as const
export const held = [Held] as const
export const allProjectiles = [Projectile] as const
export const renderMobs = [Mob, GameId, Kind, Position, Hp] as const
export const renderPickups = [Pickup, GameId, Position] as const
export const renderParticles = [Particle, GameId, Position] as const
export const renderProjs = [Projectile, GameId, Position, Velocity] as const
export const identified = [GameId] as const
/** One single-component query for each timed status, by status id. */
export const expiring = TIMED.map((tag) => [tag] as const)
export const snapMobs = [Mob, GameId, Kind, Position, Velocity, Hp, Affix] as const
export const snapProjs = [Projectile, GameId, Position, Velocity, Ttl] as const
export const snapPickups = [Pickup, GameId, Position, Ttl] as const
export const snapParts = [Particle, GameId, Position, Velocity, Ttl] as const
/** The swarmlings of one summoner. */
export const childrenOf = (summoner: EntityId) => [pair(ChildOf, summoner)] as const
export const mobsAlive = [Mob] as const
