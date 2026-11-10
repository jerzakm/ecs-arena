// SoA components for the factory game. A component is an object of typed arrays indexed by the native entity id. A tag is an empty object.
// bitECS recycles ids and never clears a store, so every spawn writes every field of every component it adds.
export const CAP = 1 << 18
const ints = () => new Int32Array(CAP)

/** A machine. `p*` hold the values at the end of the last tick, for the changed list of SPEC-factory §8. */
export const Machine = {
  kind: ints(), district: ints(), x: ints(), y: ints(), input: ints(), output: ints(), progress: ints(),
  dirtyAt: ints(), seenAt: ints(), pInput: ints(), pOutput: ints(), pProgress: ints(), pFlags: ints(),
}
/** Optional: only a machine that has a boost carries it. */
export const Boost = { value: ints() }
export const Working = {}
export const Powered = {}
export const Manual = {}

/** The world transform that a crate reads from its parent, a drone or a crate. */
export const Transform = { x: ints(), y: ints(), c: ints(), s: ints() }
export const Motion = { vx: ints(), vy: ints(), ax: ints(), ay: ints() }
/** `source`, `sink` are machine entities. `top` is the top crate or -1. */
export const Drone = { born: ints(), goal: ints(), cargo: ints(), item: ints(), source: ints(), sink: ints(), top: ints() }
/** `parent` is the drone or the crate below. */
export const Crate = { item: ints(), parent: ints() }

/** The depth of a crate in its chain, set at spawn: depth 1 has the drone as its parent. `transform` visits one depth at a time. */
export const Depth1 = {}
export const Depth2 = {}
export const Depth3 = {}
export const DEPTH_TAGS = [Depth1, Depth2, Depth3] as const
