// ONE table of systems and ONE table of facets.
// The phases, the budget regions, the liveness rows and the docs facet table all come from these two.
/** Same shape as the runner liveness row: rule, counter, late, minMean. */
export type LivenessRow = readonly [rule: string, counter: string, late?: boolean, minMean?: number]

export const PHASES = [
  'spawn', 'player', 'weapons', 'ai', 'move', 'combat', 'status', 'resolve', 'cleanup', 'progress', 'stats',
] as const
export type SvPhase = (typeof PHASES)[number]

/**
 * `gated`: the system is idle until a kind or an upgrade makes its query non-empty.
 * `creates`: the system creates entities. It handles its sources in ascending gameId order and gives each new entity
 * the next `nextId` at once (the rule of SPEC.md §5.6 and SPEC-survivors.md §6.2). `visible` says if later systems of the same phase see them.
 */
export interface SystemDef {
  id: string
  phase: SvPhase
  gated?: 'kind' | 'upgrade'
  creates?: { order: string; visible: 'same-phase' | 'next-phase' }
  does: string
}

/** Tick order. Inside a phase, the order of this list. 36 systems. */
export const SYSTEMS = [
  { id: 'spawn.wave',      phase: 'spawn',    does: 'spawnPlan: pack of mobs on a ring around the player, SPAWNING(15)',
    creates: { order: 'kind order of spawnPlan, then ring index', visible: 'same-phase' } },
  { id: 'spawn.elite',     phase: 'spawn',    gated: 'kind', does: 'elite with 1 to 3 affixes; boss; swarmling ring',
    creates: { order: 'elite, then boss, then ring index', visible: 'same-phase' } },
  { id: 'player.path',     phase: 'player',   does: 'playerPos(tick) -> Pos; regen' },
  { id: 'weapon.fire',     phase: 'weapons',  does: 'cooldown -= 1; ready weapons make projectiles with one component per trait bit (mines too)',
    creates: { order: 'weapons by upgrade id, then shot index', visible: 'next-phase' } },
  { id: 'weapon.orbit',    phase: 'weapons',  gated: 'upgrade', does: 'orbiters take a slot position around the player' },
  { id: 'weapon.pulse',    phase: 'weapons',  gated: 'upgrade', does: 'aura weapon: range query from the player, HIT events' },
  { id: 'ai.chase',        phase: 'ai',       does: 'v toward the player. Query: Chase & !BLOCKS_MOVE' },
  { id: 'ai.weave',        phase: 'ai',       gated: 'kind', does: 'v toward the player + sine-table offset' },
  { id: 'ai.charge',       phase: 'ai',       gated: 'kind', does: 'Charger: in range -> WINDUP(20) -> DASH(12) -> RECOVER(30). The stage is in aux' },
  { id: 'ai.kite',         phase: 'ai',       gated: 'kind', does: 'hold distance 10 tiles' },
  { id: 'ai.shoot',        phase: 'ai',       gated: 'kind', does: 'Shooter and Boss every 45 ticks: one hostile projectile',
    creates: { order: 'shooters in gameId order', visible: 'next-phase' } },
  { id: 'ai.summon',       phase: 'ai',       gated: 'kind', does: 'Summoner and Boss: swarmlings with a SummonedBy link, cap 6',
    creates: { order: 'summoners in gameId order, then slot', visible: 'next-phase' } },
  { id: 'ai.heal',         phase: 'ai',       gated: 'kind', does: 'Healer every 15 ticks: heal the 2 nearest mobs within 5 tiles (ties: lowest gameId)' },
  { id: 'ai.fuse',         phase: 'ai',       gated: 'kind', does: 'Exploder within 2 tiles of the player: FUSE(20)' },
  { id: 'move.mobs',       phase: 'move',     does: 'Pos += Vel for Mob & !BLOCKS_MOVE; KNOCKBACK mobs move away from the player' },
  { id: 'move.proj',       phase: 'move',     does: 'straight; HOMING steers; RETURN flips at half life; a BOUNCE hit reverses the velocity (in combat.hit)' },
  { id: 'move.particles',  phase: 'move',     does: 'Pos += Vel, Vel decays' },
  { id: 'grid.update',     phase: 'move',     does: 'send moved mobs to the grid' },
  { id: 'combat.hit',      phase: 'combat',   does: 'projectiles x mobs via the grid: HIT events, pierce/chain/bounce budget, dmgIn += dmg',
    creates: { order: 'SPLIT children: projectiles in gameId order, then child index', visible: 'next-phase' } },
  { id: 'combat.hostile',  phase: 'combat',   gated: 'kind', does: 'hostile projectiles against the player: damagePlayer unless IFRAMES' },
  { id: 'combat.contact',  phase: 'combat',   does: 'mobs that touch the player: damagePlayer unless IFRAMES, then IFRAMES(30)' },
  { id: 'combat.explode',  phase: 'combat',   gated: 'upgrade', does: 'EXPLODE projectiles and FUSE = 0: AoE range query, HIT events' },
  { id: 'status.apply',    phase: 'status',   does: 'HIT events -> statusFromTraits -> add tag or merge until by max; STATUS events' },
  { id: 'status.tick',     phase: 'status',   does: 'BURNING deals stacks dmg every 6 ticks; SCORCHING aura; Ghost toggles PHASED (30 of 90)' },
  { id: 'status.expire',   phase: 'status',   does: 'tags with until <= tick are removed (includes SPAWNING and IFRAMES)' },
  { id: 'resolve.damage',  phase: 'resolve',  does: 'hp -= dmgIn through hitOutcome; SHIELDED absorbs; DYING at hp <= 0; clear dmgIn' },
  { id: 'resolve.changed', phase: 'resolve',  does: 'hp changed this tick -> ENRAGED below 50% (FRENZIED); boss phase swap at 66% and 33%; spark particles',
    creates: { order: 'changed mobs in gameId order', visible: 'next-phase' } },
  { id: 'cleanup.ttl',     phase: 'cleanup',  does: 'projectiles, pickups and particles with ttl <= tick are destroyed' },
  { id: 'cleanup.death',   phase: 'cleanup',  does: 'DYING mobs: KILL events, destroy; clear homing and chain targets that point to them' },
  { id: 'cleanup.drops',   phase: 'cleanup',  does: 'KILL events -> xp gem, heart, chest; split children; explode blast; burst particles',
    creates: { order: 'dead mobs in gameId order, then drop, split, particle index', visible: 'next-phase' } },
  { id: 'cleanup.cascade', phase: 'cleanup',  gated: 'kind', does: 'summoned children whose summoner is gone are destroyed with no KILL event' },
  { id: 'pickup.magnet',   phase: 'progress', does: 'range query from the player (magnet radius) -> ATTRACTED; attracted pickups move toward the player' },
  { id: 'pickup.collect',  phase: 'progress', does: 'pickups within 1 tile: PICKUP events, xp and hp, destroy; xp >= xpForLevel -> LEVELUP' },
  { id: 'progress.pick',   phase: 'progress', does: 'LEVELUP or chest -> pickUpgrade -> held list' },
  { id: 'progress.apply',  phase: 'progress', does: 'held changed -> deriveLoadout; add a weapon; an evolution replaces a weapon and swaps live components',
    creates: { order: 'new weapon entity, then orbiter slots', visible: 'next-phase' } },
  { id: 'stats.render',    phase: 'stats',    does: 'entities in the camera window -> render buffer -> renderChain; world counters' },
] as const satisfies readonly SystemDef[]
export type SystemId = (typeof SYSTEMS)[number]['id']

export interface FacetDef {
  id: string
  /** baseline-js region name for the budget. null = liveness only (the cost sits in another region). */
  region: string | null
  /** 'rts': the RTS has the same mechanism and region name. Survivors gives it a new load shape. */
  kind: 'new' | 'rts'
  counter: string
  late?: boolean
  /** structural-churn floor in events per tick (mean over the run) */
  minMean?: number
  /** The storage model that this facet is expected to reward. A label for the report, not a timed claim. */
  favors: 'archetype' | 'sparse' | 'neutral'
  /** One phrase: why the facet favors that model. */
  why: string
}

export const FACETS = [
  { id: 'query',     region: 'query.match',     kind: 'new', counter: 'q.idleSkip',      minMean: 4 , favors: 'archetype', why: 'a cached archetype list makes an empty query one length test' },
  { id: 'gate',      region: 'move.gate',       kind: 'new', counter: 'gate.blocked',    minMean: 20 , favors: 'archetype', why: 'a negated term drops whole archetypes, a sparse set tests each mob' },
  { id: 'status',    region: 'status.expire',   kind: 'new', counter: 'tag.remove',      minMean: 15 , favors: 'sparse', why: 'a tag remove is a set delete, not a row move' },
  { id: 'statusAdd', region: null,              kind: 'new', counter: 'tag.add',         minMean: 30 , favors: 'sparse', why: 'a tag add is a set insert, not a row move' },
  { id: 'interact',  region: 'flag.reads', kind: 'new', counter: 'rule.shatter' , favors: 'neutral', why: 'reads a few tags of one entity per hit' },
  { id: 'traits',    region: null,              kind: 'new', counter: 'proj.traitSets',  late: true, minMean: 3 , favors: 'sparse', why: '12 trait bits split projectiles into 20 to 40 archetypes' },
  { id: 'affix',     region: 'flag.reads',       kind: 'new', counter: 'rule.affix' , favors: 'sparse', why: 'more than 100 small archetypes fragment iteration' },
  { id: 'range',     region: null,              kind: 'new', counter: 'rule.aoe',        late: true , favors: 'neutral', why: 'the grid does the search, not the storage' },
  { id: 'events',    region: 'flag.reads',    kind: 'new', counter: 'evt.route',       minMean: 10 , favors: 'neutral', why: 'plain lists outside the entity storage' },
  { id: 'changed',   region: 'flag.reads', kind: 'new', counter: 'hp.changed',      minMean: 15 , favors: 'neutral', why: 'cost depends on the change-flag design, not the storage' },
  { id: 'loadout',   region: null,              kind: 'new', counter: 'loadout.derive' , favors: 'neutral', why: 'about 45 picks per run' },
  { id: 'evolve',    region: null,              kind: 'new', counter: 'rule.evolve',     late: true , favors: 'sparse', why: 'swaps components on live projectiles' },
  { id: 'enrage',    region: null,              kind: 'new', counter: 'rule.enrage',     late: true , favors: 'sparse', why: 'a tag add on a damaged mob' },
  { id: 'bossphase', region: null,              kind: 'new', counter: 'rule.bossphase',  late: true , favors: 'sparse', why: 'a component swap on the boss' },
  { id: 'charge',    region: null,              kind: 'new', counter: 'rule.chargeCycle' , favors: 'sparse', why: 'three tag swaps per charge cycle' },
  { id: 'player',    region: null,              kind: 'new', counter: 'rule.playerFloor' , favors: 'neutral', why: 'one entity' },
  { id: 'churn',     region: 'churn',           kind: 'rts', counter: 'ttl.expire',      minMean: 20 , favors: 'archetype', why: 'a create writes one row, not one insert per component' },
  { id: 'grid',      region: 'grid.update',     kind: 'rts', counter: 'grid.update' , favors: 'neutral', why: 'the grid is outside the entity storage' },
  { id: 'cascade',   region: null,              kind: 'rts', counter: 'rule.cascade' , favors: 'neutral', why: 'a link walk, not a storage scan' },
  { id: 'render',    region: 'stats.render',    kind: 'rts', counter: 'rule.renderChain' , favors: 'archetype', why: 'dense position columns iterate fast' },
  { id: 'save',      region: 'save',            kind: 'rts', counter: 'save.count' , favors: 'archetype', why: 'whole columns copy in one pass' },
  { id: 'load',      region: 'load',            kind: 'rts', counter: 'load.count' , favors: 'neutral', why: 'both models rebuild every entity' },
] as const satisfies readonly FacetDef[]

/** Derived. The budget iterates this. baseline-js must call begin/end/isNaive with exactly these names. 9 regions. */
export type Region = NonNullable<(typeof FACETS)[number]['region']>
export const REGIONS: readonly Region[] = [...new Set(FACETS.flatMap((f) => (f.region === null ? [] : [f.region])))]

/** Derived. Each gated system also gets a `sys.<id>` run counter row, late when it waits for an upgrade. */
export const LIVENESS: readonly LivenessRow[] = [
  ...FACETS.map((f: FacetDef): LivenessRow => [f.id, f.counter, f.late, f.minMean]),
  ...SYSTEMS.filter((s: SystemDef) => s.gated).map((s: SystemDef): LivenessRow => [`system ${s.id} ran`, `sys.${s.id}`, s.gated === 'upgrade']),
]

/** Each impl wires its systems by this map, so a missing system is a type error. */
export type SystemTable<Ctx> = Record<SystemId, (ctx: Ctx) => () => void>
/**
 * The phases of a Sim: each phase runs its SYSTEMS rows in table order. `wrap` turns one built system into the step its
 * phase calls, for an impl that registers each system with its library.
 */
export const wirePhases = <Ctx>(table: SystemTable<Ctx>, ctx: Ctx, wrap = (_id: SystemId, run: () => void): (() => void) => run): Record<SvPhase, () => void> => {
  const phases = {} as Record<SvPhase, () => void>
  for (const p of PHASES) {
    const run = SYSTEMS.filter((s) => s.phase === p).map((s) => wrap(s.id, table[s.id](ctx)))
    phases[p] = () => { for (let i = 0; i < run.length; i++) run[i]() }
  }
  return phases
}
