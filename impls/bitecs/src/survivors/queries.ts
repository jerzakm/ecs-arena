import type { QueryTerm } from 'bitecs'
import {
  Boss, Burning, Charger, Chase, Dying, Exploder, Explosive, Ghost, Healer, Held, Homing, Hostile, Kite, Mob, Orbiter, Particle, Pickup,
  Projectile, Returning, Shooter, Summoner, SummonedBy, TIMED, Weave,
} from './components.ts'

// A bitECS query is a list of terms. The world caches the result list by its terms, so these constants are the queries.
export const Q = {
  mobs: [Mob],
  chasers: [Mob, Chase],
  weavers: [Mob, Weave],
  chargers: [Mob, Charger],
  kiters: [Mob, Kite],
  shooters: [Mob, Shooter],
  summoners: [Mob, Summoner],
  healers: [Mob, Healer],
  exploders: [Mob, Exploder],
  ghosts: [Mob, Ghost],
  bosses: [Mob, Boss],
  burning: [Mob, Burning],
  dying: [Mob, Dying],
  minions: [Mob, SummonedBy('*')],
  projs: [Projectile],
  hostile: [Projectile, Hostile],
  orbiters: [Projectile, Orbiter],
  homing: [Projectile, Homing],
  returning: [Projectile, Returning],
  explosive: [Projectile, Explosive],
  pickups: [Pickup],
  parts: [Particle],
  held: [Held],
} satisfies Record<string, QueryTerm[]>

/** One query for each timed tag, by status id. */
export const TIMED_QUERIES: QueryTerm[][] = TIMED.map((tag) => [Mob, tag])

/** The mobs summoned by the mob `m`. */
export const minionsOf = (m: number): QueryTerm[] => [SummonedBy(m)]
