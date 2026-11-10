// SoA components for the survivors game. A component is an object of typed arrays indexed by the native entity id.
// A tag is an empty object.
// bitECS recycles ids and never clears a store, so every spawn writes every field of every component it adds.
import { createRelation } from 'bitecs'

export const CAP = 1 << 16
const ints = () => new Int32Array(CAP)

export const Position = { x: ints(), y: ints() }
export const Velocity = { x: ints(), y: ints() }

export const Mob = {
  kind: ints(), hp: ints(), shield: ints(), flags: ints(), affix: ints(), aux: ints(),
  dmgIn: ints(), healIn: ints(), clearIn: ints(), prevHp: ints(),
}
export const Player = { hp: ints(), iframes: ints() }
export const Projectile = {
  weapon: ints(), owner: ints(), traits: ints(), ttl: ints(), pierceLeft: ints(), bounceLeft: ints(), hitMask: ints(), target: ints(),
}
export const Pickup = { kind: ints(), value: ints(), ttl: ints(), attracted: ints() }
export const Particle = { kind: ints(), ttl: ints() }
/** A weapon or passive record of the player held list. Not an entity of the game: it has no GameId. */
export const Held = { id: ints(), level: ints(), cd: ints() }

// Kind tags of a mob, set at spawn from the kind table.
export const Chase = {}
export const Weave = {}
export const Charger = {}
export const Kite = {}
export const Shooter = {}
export const Summoner = {}
export const Healer = {}
export const Exploder = {}
export const Ghost = {}
export const Boss = {}

// Kind tags of a projectile.
export const Hostile = {}
export const Orbiter = {}
export const Homing = {}
export const Returning = {}
export const Explosive = {}

/** One tag component for each status (SPEC-survivors §3.1). A timed tag has `until`. `Mob.flags` caches the tags as bits (tags.ts). */
const timed = () => ({ until: ints() })
export const Stunned = timed(), Slowed = timed(), Burning = timed(), Frozen = timed(), Knockback = timed()
export const IframesTag = timed(), Marked = timed(), Enraged = timed(), Shielded = timed(), Phased = timed()
export const Spawning = timed(), Windup = timed(), Dash = timed(), Recover = timed(), Fuse = timed()
export const Elite = {}
export const Dying = {}
/** The timed tags, indexed by status id. */
export const TIMED = [
  Stunned, Slowed, Burning, Frozen, Knockback, IframesTag, Marked, Enraged, Shielded, Phased, Spawning, Windup, Dash, Recover, Fuse,
] as const
/** The tags without `until`, indexed by status id minus the number of timed tags. */
export const PLAIN = [Elite, Dying] as const
export const BurnStacks = { n: ints() }

/** Swarmling to summoner. Exclusive. The subject is destroyed with its target, which is the minion cascade of §6.20. */
export const SummonedBy = createRelation({ exclusive: true, autoRemoveSubject: true })
