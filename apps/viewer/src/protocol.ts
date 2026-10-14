import type { Scenario } from '@ecs-arena/spec'
import type { Speed } from './clock.ts'

export type ToWorker =
  | { type: 'init', impl: string, scenario: Scenario, speed: Speed }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'restart' }
  | { type: 'speed', speed: Speed }

export type FromWorker =
  | { type: 'snap', snapshot: Int32Array, tickMs: number }
  | { type: 'done' }
  | { type: 'error', message: string }
