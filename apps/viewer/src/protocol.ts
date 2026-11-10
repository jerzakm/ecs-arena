import type { RTS, SURVIVORS } from '@ecs-arena/spec'
import type { Speed } from './clock.ts'

/** The games that the viewer draws. */
export type ViewerScenario = (typeof RTS | typeof SURVIVORS)['scenarios'][string]

export type ToWorker =
  | { type: 'init', run: number, game: 'rts' | 'survivors', impl: string, scenario: ViewerScenario, speed: Speed, endless: boolean }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'restart' }
  | { type: 'speed', speed: Speed }
  | { type: 'endless', on: boolean }

export type FromWorker =
  | { type: 'snap', run: number, snapshot: Int32Array, tickMs: number }
  | { type: 'done', run: number }
  | { type: 'error', run: number, message: string }
