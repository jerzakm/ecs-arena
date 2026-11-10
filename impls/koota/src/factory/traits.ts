// The traits, tags and relations of factory (SPEC-factory.md). Machines, drones and crates are koota entities. Working, Powered and Manual
// are tags. Boost is a trait that only some machines have. A crate is a child of a drone or of the crate below it. gameId is a trait.
import { relation, trait } from 'koota'
import { factory } from '@ecs-arena/spec'

export const GameId = trait({ id: 0 })

// Machines.
export const Machine = trait()
export const Kind = trait({ value: 0 })
export const Slot = trait({ x: 0, y: 0 })
export const Io = trait({ input: 0, output: 0, progress: 0 })
/** Present on 1 machine in 8. A machine without it reads a boost of 0. */
export const Boost = trait({ value: 0 })
/** The values at the end of the last tick, for the changed list of SPEC-factory §8. -1 never equals a real value. */
export const Prev = trait({ input: -1, output: -1, progress: -1, flags: -1 })
export const Working = trait()
export const Powered = trait()
export const Manual = trait()

// Drones and crates.
export const Drone = trait()
export const Crate = trait()
/** A drone, or the world transform of a crate. */
export const Pose = trait({ x: 0, y: 0, c: 0, s: 0 })
export const Motion = trait({ vx: 0, vy: 0, ax: 0, ay: 0 })
export const Mission = trait({ born: 0, goal: 0, cargo: 0, item: 0 })
export const Cargo = trait({ item: 0 })

// Districts. A district with Lit has power.
export const District = trait({ index: 0 })
export const Lit = trait()

export const InDistrict = relation({ exclusive: true })
export const Source = relation({ exclusive: true })
export const Sink = relation({ exclusive: true })
/** The last crate of a drone's chain. */
export const Top = relation({ exclusive: true })
/** The parent of a crate: a drone, or the crate below it. Destroying a parent destroys the crates above it. */
export const ChildOf = relation({ exclusive: true, autoDestroy: 'orphan' })

// World trait: the totals of SPEC-factory §6, updated in place. `tick` is the last finished tick.
export const Totals = trait(() => factory.kernel.newTotals())
