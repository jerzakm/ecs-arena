import { changed, not, or } from 'iris-ecs'
import { GameId } from '../shared/components.ts'
import { Accel, AnyParent, Boost, Crate, Drone, Machine, Manual, Powered, Transform, Velocity, Working } from './components.ts'

export const workingBoosted = [Working, GameId, Machine, Boost] as const
export const workingPlain = [Working, GameId, Machine, not(Boost)] as const

// The machines whose Machine component changed since `state` last ran, split by what `state` may do with them.
export const mayStop = [changed(Machine), Working] as const
export const mayStart = [changed(Machine), or(Powered, Manual), not(Working)] as const
export const stayIdle = [changed(Machine), not(Working), not(Powered), not(Manual)] as const
/** All machines, for a snapshot and a save. */
export const machines = [GameId, Machine] as const
export const working = [Working] as const

export const fliers = [Drone, Transform, Velocity, Accel] as const
export const droneRows = [Drone, GameId, Transform, Velocity, Accel] as const
export const crates = [Crate, Transform, AnyParent] as const
export const crateRows = [Crate, GameId, Transform, AnyParent] as const
