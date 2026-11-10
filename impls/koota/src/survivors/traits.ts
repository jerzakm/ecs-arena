// The traits, tags and relations of survivors (SPEC-survivors.md). Tag lists are `as const` tuples, so each tag keeps its own type.
// The timed tags and the plain tags are separate lists: a timed tag has an `until`, a plain tag has no data.
import { relation, trait } from 'koota'
import { survivors } from '@ecs-arena/spec'

const { STATUS, BLOCKS_MOVE, BLOCKS_ACT, bit } = survivors.kernel

export const GameId = trait({ id: 0 })
export const Position = trait({ x: 0, y: 0 })
export const Velocity = trait({ x: 0, y: 0 })
export const Kind = trait({ value: 0 })
export const Hp = trait({ hp: 0 })
export const Shield = trait({ value: 0 })
/** Charger stage, or boss phase (SPEC-survivors §4). */
export const Aux = trait({ value: 0 })
/** The transient dmgIn, healIn and clearIn of a mob. All 0 at a tick boundary. */
export const Incoming = trait({ dmg: 0, heal: 0, clear: 0 })
export const Ttl = trait({ value: 0 })
export const Projectile = trait({ weapon: 0, pierceLeft: 0, bounceLeft: 0, hitMask: 0 })
export const Pickup = trait({ kind: 0, value: 0, attracted: 0 })
export const Particle = trait({ kind: 0 })
/** A held upgrade of the player: one entity for each held weapon or passive. Not a game entity, so no GameId. */
export const Held = trait({ id: 0, level: 0, cd: 0 })

export const Player = trait()
export const Mob = trait()
export const Hostile = trait()
export const Orbiter = trait()
export const Elite = trait()
export const Dying = trait()
// What a kind can do. The systems of SPEC-survivors §6.6 to §6.11 each query one of these.
export const Chase = trait()
export const Weaver = trait()
export const Charger = trait()
export const Kite = trait()
export const Shoot = trait()
export const Summon = trait()
export const Healer = trait()
export const Exploder = trait()
export const Ghost = trait()
export const Boss = trait()
// One tag for each affix bit of an elite.
export const Swift = trait()
export const Armored = trait()
export const Vampiric = trait()
export const Scorching = trait()
export const Frenzied = trait()
export const ShieldAffix = trait()
export const AFFIX_TAGS = [Swift, Armored, Vampiric, Scorching, Frenzied, ShieldAffix] as const

/** The timed tags. Each holds the tick at which `status.expire` removes it. `Burning` also holds its stacks. */
const timed = () => trait({ until: 0 })
export const Stunned = timed()
export const Slowed = timed()
export const Burning = trait({ until: 0, stacks: 0 })
export const Frozen = timed()
export const Knockback = timed()
export const Iframes = timed()
export const Marked = timed()
export const Enraged = timed()
export const Shielded = timed()
export const Phased = timed()
export const Spawning = timed()
export const Windup = timed()
export const Dash = timed()
export const Recover = timed()
export const Fuse = timed()
/** The timed tags by status id 0 to 14: `TIMED[STATUS.BURNING]` is `Burning`. */
export const TIMED = [
  Stunned, Slowed, Burning, Frozen, Knockback, Iframes, Marked, Enraged, Shielded, Phased, Spawning, Windup, Dash, Recover, Fuse,
] as const

// One tag for each projectile trait bit i (value 1 << i), named after survivors.kernel.TRAIT. A projectile carries the tags of its traits.
export const Pierce = trait()
export const Bounce = trait()
export const Homing = trait()
export const Split = trait()
export const Explode = trait()
export const Chain = trait()
export const Return = trait()
export const Freeze = trait()
export const Burn = trait()
export const Mark = trait()
export const Knock = trait()
export const Stun = trait()
export const TRAIT_TAGS = [Pierce, Bounce, Homing, Split, Explode, Chain, Return, Freeze, Burn, Mark, Knock, Stun] as const

/** The tags that a kernel status mask names: the timed tags by id, then `Dying`. */
const tagsOfStatusMask = (mask: number) => [...TIMED.filter((_, id) => mask & (1 << id)), ...(mask & bit(STATUS.DYING) ? [Dying] : [])]
/** The tags that stop a mob from moving or from acting (BLOCKS_MOVE and BLOCKS_ACT of the kernel). */
export const BLOCKS_MOVE_TAGS = tagsOfStatusMask(BLOCKS_MOVE)
export const BLOCKS_ACT_TAGS = tagsOfStatusMask(BLOCKS_ACT)
/** A mob with one of these tags takes no damage. The kernel IMMUNE_HIT also holds IFRAMES, which only the player has. */
export const IMMUNE_TAGS = [Phased, Spawning, Dying] as const

/** A projectile owner, a homing or chain target, and the summoner of a swarmling. A destroyed target drops the pair. */
export const FiredBy = relation({ exclusive: true })
export const Targets = relation({ exclusive: true })
export const SummonedBy = relation({ exclusive: true })

// World traits: the singletons of the world.
/** The tick that is running. It advances in the last phase (stats.render). */
export const Clock = trait({ tick: 0 })
/** The totals of SPEC-survivors §8, updated in place. */
export const Totals = trait(() => survivors.kernel.newTotals())
/** The weapon and stat blocks that the held upgrades give. `refreshLoadout` derives them. */
export const Loadout = trait(() => ({
  weapons: [] as (survivors.kernel.WeaponStats | undefined)[], // by upgrade id
  stats: { might: 0, haste: 0, reach: 0, velocity: 0, magnet: 0, amount: 0, vigor: 0, greed: 0 } as survivors.kernel.Stats,
}))
