import type { Scenario } from '@ecs-arena/spec'
import type { Speed } from './clock.ts'

export type ToWorker =
  | { type: 'init', run: number, impl: string, scenario: Scenario, speed: Speed }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'restart' }
  | { type: 'speed', speed: Speed }

export type FromWorker =
  | { type: 'snap', run: number, snapshot: Int32Array, tickMs: number }
  | { type: 'done', run: number }
  | { type: 'error', run: number, message: string }
