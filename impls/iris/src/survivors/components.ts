import { defineComponent, defineRelation, pair, Type, Wildcard } from 'iris-ecs'
import { survivors } from '@ecs-arena/spec'

const i32 = () => Type.i32()
const { BLOCKS_ACT, BLOCKS_MOVE, IMMUNE_HIT, TRAIT_COUNT } = survivors.kernel

export const Position = defineComponent('SvPosition', { schema: { x: i32(), y: i32() } })
export const Velocity = defineComponent('SvVelocity', { schema: { x: i32(), y: i32() } })

// Entity kinds, as tags.
export const Player = defineComponent('SvPlayer')
export const Mob = defineComponent('SvMob')
/** owner and target are gameIds: a link to a destroyed entity reads as -1. weapon is -1 for a hostile shot. */
export const Projectile = defineComponent('SvProjectile', {
  schema: { weapon: i32(), owner: i32(), pierceLeft: i32(), bounceLeft: i32(), hitMask: i32(), target: i32() },
})
export const Pickup = defineComponent('SvPickup', { schema: { kind: i32(), value: i32() } })
export const Particle = defineComponent('SvParticle', { schema: { kind: i32() } })
/** The tick at which cleanup.ttl destroys the entity. A projectile, a pickup or a particle holds it. */
export const Ttl = defineComponent('SvTtl', { schema: { at: i32() } })

// Mob state.
export const Kind = defineComponent('SvKind', { schema: { value: i32() } })
export const Hp = defineComponent('SvHp', { schema: { hp: i32(), shield: i32() } })
export const Affix = defineComponent('SvAffix', { schema: { bits: i32() } })
/** Charger stage, boss phase. Only chargers and the boss hold it. */
export const Aux = defineComponent('SvAux', { schema: { value: i32() } })
/** dmgIn, healIn and clearIn: 0 at every tick boundary. */
export const Incoming = defineComponent('SvIncoming', { schema: { dmg: i32(), heal: i32(), clear: i32() } })
/** Player hp. The iframes are the IFRAMES status of the player entity. */
export const PlayerHp = defineComponent('SvPlayerHp', { schema: { hp: i32() } })

// Behaviour tags that a kind gets from its table row (move and `has`).
export const Chase = defineComponent('SvChase')
export const Weave = defineComponent('SvWeave')
export const Charger = defineComponent('SvCharger')
export const Kite = defineComponent('SvKite')
export const Shoots = defineComponent('SvShoots')
export const Summons = defineComponent('SvSummons')
export const Heals = defineComponent('SvHeals')
export const Fuses = defineComponent('SvFuses')
export const Phases = defineComponent('SvPhases')
export const BossPhase = defineComponent('SvBossPhase')
/** A mob that a summoner made. It stays when the summoner is gone, so the cascade can find it. */
export const Summoned = defineComponent('SvSummoned')

// Status tags (SPEC-survivors §3.1). A timed status holds `until`, and BURNING also holds `stacks`. ELITE and DYING are plain tags.
const timed = (name: string) => defineComponent(name, { schema: { until: i32() } })
export const Elite = defineComponent('SvElite')
export const Dying = defineComponent('SvDying')
export const Burning = defineComponent('SvBurning', { schema: { until: i32(), stacks: i32() } })
export const Stunned = timed('SvStunned'), Slowed = timed('SvSlowed'), Frozen = timed('SvFrozen'), Knockback = timed('SvKnockback')
export const IFrames = timed('SvIFrames'), Marked = timed('SvMarked'), Enraged = timed('SvEnraged'), Shielded = timed('SvShielded')
export const Phased = timed('SvPhased'), Spawning = timed('SvSpawning'), Windup = timed('SvWindup'), Dash = timed('SvDash')
export const Recover = timed('SvRecover'), Fuse = timed('SvFuse')
/** The timed tags, indexed by status id (STATUS.STUNNED to STATUS.FUSE). */
export const TIMED = [
  Stunned, Slowed, Burning, Frozen, Knockback, IFrames, Marked, Enraged, Shielded, Phased, Spawning, Windup, Dash, Recover, Fuse,
] as const
/** Every status tag, indexed by status id: the timed tags, then ELITE and DYING. */
export const STATUS_TAGS = [...TIMED, Elite, Dying] as const

/** The status tags whose bit is set in `mask`. */
const statusTagsIn = (mask: number) => STATUS_TAGS.filter((_, id) => (mask & (1 << id)) !== 0)
// The kernel masks name the statuses that stop a mob (SPEC-survivors §3.1), so the tag lists come from them.
export const BLOCKS_MOVE_TAGS = statusTagsIn(BLOCKS_MOVE)
export const BLOCKS_ACT_TAGS = statusTagsIn(BLOCKS_ACT)
export const IMMUNE_TAGS = statusTagsIn(IMMUNE_HIT)

// One tag per trait bit of a projectile, in bit order (TRAIT in the spec).
export const TraitPierce = defineComponent('SvTraitPierce'), TraitBounce = defineComponent('SvTraitBounce')
export const TraitHoming = defineComponent('SvTraitHoming'), TraitSplit = defineComponent('SvTraitSplit')
export const TraitExplode = defineComponent('SvTraitExplode'), TraitChain = defineComponent('SvTraitChain')
export const TraitReturn = defineComponent('SvTraitReturn'), TraitFreeze = defineComponent('SvTraitFreeze')
export const TraitBurn = defineComponent('SvTraitBurn'), TraitMark = defineComponent('SvTraitMark')
export const TraitKnock = defineComponent('SvTraitKnock'), TraitStun = defineComponent('SvTraitStun')
export const TRAIT_TAGS = [
  TraitPierce, TraitBounce, TraitHoming, TraitSplit, TraitExplode, TraitChain, TraitReturn, TraitFreeze, TraitBurn, TraitMark, TraitKnock,
  TraitStun,
] as const
/** Fails to compile when the kernel gains or loses a trait bit. */
export const traitTagsMatchKernel: (typeof TRAIT_TAGS)['length'] extends typeof TRAIT_COUNT ? true : never = true

export const Orbiter = defineComponent('SvOrbiter')
export const Hostile = defineComponent('SvHostile')
export const Attracted = defineComponent('SvAttracted')

/** A held upgrade of the player: id, level, and the cooldown left of a weapon. It takes no gameId. */
export const Held = defineComponent('SvHeld', { schema: { id: i32(), level: i32(), cd: i32() } })

/**
 * A swarmling holds the pair with its summoner. When the summoner is destroyed iris removes the pair, and the child keeps its `Summoned`
 * tag, so `Summoned & !AnyChild` finds the orphans that cleanup.cascade destroys. T is the number of live summoners and bosses.
 */
export const ChildOf = defineRelation('SvChildOf', { exclusive: true, onDeleteTarget: 'remove' })
export const AnyChild = pair(ChildOf, Wildcard)

/** Resource: one copy per world. It holds the `Totals` of the spec, so the snapshot header comes from `worldHeader`. */
export const Run = defineComponent('SvRun', {
  schema: {
    tick: i32(), nextId: i32(), alive: i32(), kills: i32(), dmgOut: i32(), dmgTaken: i32(), level: i32(), xp: i32(), picks: i32(),
    evt: Type.ref<number[]>(), renderChain: i32(),
  },
})
