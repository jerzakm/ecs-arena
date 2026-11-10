// ONE table of facets. The budget regions and the liveness rows come from it.
/** Same shape as the runner liveness row: rule, counter, late, minMean. */
export type LivenessRow = readonly [rule: string, counter: string, late?: boolean, minMean?: number]

export const PHASES = ['build', 'power', 'shift', 'steer', 'move', 'dock', 'work', 'state', 'transform'] as const
export type FPhase = (typeof PHASES)[number]

export interface FacetDef {
  id: string
  /** baseline-js region name for the budget. null = liveness only (the cost sits in another region, or the facet has no naive way). */
  region: string | null
  counter: string
  late?: boolean
  /** Floor for the mean of the counter per tick over the whole run. */
  minMean?: number
  /** The storage model that this facet is expected to reward. A label for the report, not a timed claim. */
  favors: 'archetype' | 'sparse' | 'neutral'
  /** One phrase: why the facet favors that model. */
  why: string
  /** The scenarios (without the `-smoke` suffix) whose budget region and liveness row this facet applies to. Absent means all of them. */
  scenarios?: readonly string[]
}

export const FACETS = [
  {
    id: 'query', region: 'work.query', counter: 'work.machine', minMean: 100, favors: 'neutral', scenarios: ['works'],
    why: 'archetype and sparse set both keep the working set, a scan does not',
  },
  {
    id: 'step', region: 'work.step', counter: 'work.machine', minMean: 1000, favors: 'archetype', scenarios: ['mill'],
    why: 'the working set is most of the world, so the cost is dense iteration over its columns',
  },
  {
    id: 'tag', region: 'work.tag', counter: 'work.flip', minMean: 5, favors: 'sparse', scenarios: ['mill'],
    why: 'hundreds of machines gain or lose Working in one tick: a set insert against a row move',
  },
  {
    id: 'changed', region: 'state.changed', counter: 'state.recheck', minMean: 20, favors: 'neutral',
    why: 'cost depends on the design of the change tracker',
  },
  {
    id: 'toggle', region: 'power.toggle', counter: 'power.toggle', favors: 'sparse', scenarios: ['works'],
    why: 'a tag change is a set insert, not a row move',
  },
  {
    id: 'outage', region: null, counter: 'power.down', favors: 'sparse',
    why: 'about 700 tag removes in one tick',
  },
  {
    id: 'restore', region: null, counter: 'power.up', favors: 'sparse',
    why: 'about 700 tag adds in one tick',
  },
  {
    id: 'move', region: 'drone.move', counter: 'drone.move', minMean: 500, favors: 'archetype',
    why: 'eight dense numeric columns iterate fast',
  },
  {
    id: 'transform', region: 'transform', counter: 'transform.crate', favors: 'neutral',
    why: 'the cost is in the parent read',
  },
  {
    id: 'depth', region: null, counter: 'transform.depth3', favors: 'neutral',
    why: 'a chain of depth 3 reads a parent that the same pass wrote',
  },
  {
    id: 'churn', region: 'churn', counter: 'churn.create', minMean: 3, favors: 'archetype',
    why: 'a create writes one row, a bulk shift is one batch',
  },
  {
    id: 'destroy', region: null, counter: 'churn.destroy', favors: 'archetype',
    why: 'a retired drone takes its crates with it',
  },
  {
    id: 'retire', region: null, counter: 'shift.retire', favors: 'archetype',
    why: 'hundreds of drones leave in one tick',
  },
  {
    id: 'spawn', region: null, counter: 'shift.spawn', favors: 'archetype',
    why: 'hundreds of drones arrive in one tick',
  },
  {
    id: 'build', region: null, counter: 'build.machine', favors: 'archetype',
    why: 'a create writes one row',
  },
  {
    id: 'or', region: null, counter: 'work.manualOnly', favors: 'neutral',
    why: 'Powered or Manual, and no kind test can replace it',
  },
  {
    id: 'optional', region: null, counter: 'work.boost', favors: 'neutral',
    why: 'an optional component that some machines lack',
  },
  {
    id: 'score', region: null, counter: 'sink.score', favors: 'neutral',
    why: 'a sink turns gears into score',
  },
  {
    id: 'ore', region: null, counter: 'deliver.ore', favors: 'neutral',
    why: 'a smelter gets ore',
  },
  {
    id: 'plate', region: null, counter: 'deliver.plate', favors: 'neutral',
    why: 'an assembler gets plates',
  },
  {
    id: 'gear', region: null, counter: 'deliver.gear', favors: 'neutral',
    why: 'a sink gets gears',
  },
  {
    id: 'save', region: 'save', counter: 'save.count', favors: 'archetype',
    why: 'whole columns copy in one pass',
  },
  {
    id: 'load', region: 'load', counter: 'load.count', favors: 'neutral',
    why: 'both models rebuild every entity',
  },
] as const satisfies readonly FacetDef[]

/** Derived. The budget iterates this. baseline-js must call begin/end/isNaive with exactly these names. */
export type Region = NonNullable<(typeof FACETS)[number]['region']>
export const REGIONS: readonly Region[] = [...new Set(FACETS.flatMap((f) => (f.region === null ? [] : [f.region])))]

/** Derived. */
export const LIVENESS: readonly LivenessRow[] = FACETS.map((f: FacetDef): LivenessRow => [f.id, f.counter, f.late, f.minMean])

/** True when the facet applies to the scenario `name`, with or without `-smoke`. */
export const appliesTo = (f: FacetDef, name: string): boolean => f.scenarios === undefined || f.scenarios.includes(name.replace(/-smoke$/, ''))

/** The budget regions that scenario `name` claims. */
export const regionsFor = (name: string): readonly Region[] => [...new Set(FACETS.flatMap((f: FacetDef) => (f.region !== null && appliesTo(f, name) ? [f.region as Region] : [])))]

/** The liveness rows that scenario `name` checks. */
export const livenessFor = (name: string): readonly LivenessRow[] =>
  FACETS.filter((f: FacetDef) => appliesTo(f, name)).map((f: FacetDef): LivenessRow => [f.id, f.counter, f.late, f.minMean])
