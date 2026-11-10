export interface Machine {
  gameId: number; kind: number; district: number; x: number; y: number
  input: number; output: number; progress: number; boost: number
  manual: boolean; powered: boolean; working: boolean
  workIdx: number // index in ctx.work while `working`, else -1
  dirtyAt: number // tick on which the machine joined ctx.dirty
  seenAt: number // tick on which the changed list looked at the machine
  // the values at the end of the last tick, for the changed list of SPEC-factory §8
  pInput: number; pOutput: number; pProgress: number; pFlags: number
}

/** The world transform that a crate reads from its parent. */
export interface Node { gameId: number; x: number; y: number; c: number; s: number }

export interface Drone extends Node {
  vx: number; vy: number; ax: number; ay: number
  born: number; goal: number; cargo: number; item: number
  source: Machine; sink: Machine
  top: Crate | null
  dead: boolean
}

export interface Crate extends Node {
  drone: Drone
  below: Crate | null // the parent when it is a crate, null when the drone is the parent
  item: number
  dead: boolean
}
