import type { factory } from '@ecs-arena/spec'
import type { Speed } from '../clock.ts'

/** SPEC-factory §8: 10 world values, then the changed count. */
export const CHANGED_AT = 10
export const CHANGED_FIELDS = 6
export const DRONE_FIELDS = 14
export const CRATE_FIELDS = 7

export type FaToWorker =
  | { type: 'init', run: number, impl: string, scenario: factory.FactoryScenario, speed: Speed, endless: boolean }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'restart' }
  | { type: 'speed', speed: Speed }
  | { type: 'endless', on: boolean }

/** `changes` holds the changed-machine records of every tick since the last message, oldest first. */
export type FaFromWorker =
  | { type: 'snap', run: number, snapshot: Int32Array, changes: Int32Array, tickMs: number }
  | { type: 'done', run: number }
  | { type: 'error', run: number, message: string }
