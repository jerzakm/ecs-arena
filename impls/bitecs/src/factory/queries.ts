import { Not, Or, type QueryTerm } from 'bitecs'
import { Boost, Crate, DEPTH_TAGS, Drone, Machine, Manual, Powered, Working } from './components.ts'

// A bitECS query is a list of terms. The world caches the result list by its terms, so these constants are the queries.
export const Q = {
  machines: [Machine],
  /** The machines that could work: `Powered` or `Manual` (SPEC-factory §3.1). */
  live: [Machine, Or(Powered, Manual)],
  working: [Working],
  /** `work` reads the optional `boost` through two queries, so a loop never tests for the component. */
  workBoost: [Working, Boost],
  workPlain: [Working, Not(Boost)],
  drones: [Drone],
  crates: [Crate],
} satisfies Record<string, QueryTerm[]>

/** The crates of each depth, shallowest first: a parent is done before its children (SPEC-factory §5.8). */
export const CRATE_DEPTHS: QueryTerm[][] = DEPTH_TAGS.map((tag) => [Crate, tag])
