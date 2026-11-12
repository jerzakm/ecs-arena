import type { AnyCreateSim } from '@ecs-arena/spec'
import type { BricksScenario } from '../../../games/bricks/shared.ts'

export const registry: Record<string, () => Promise<{ default: AnyCreateSim }>> = {
  'baseline-js': () => import('@ecs-arena/impl-baseline-js'),
  bitecs: () => import('../../../impls/bitecs/src/rts/index.ts'),
  koota: () => import('@ecs-arena/impl-koota'),
  iris: () => import('../../../impls/iris/src/rts/index.ts'),
}

/** The impls that have a survivors entry. */
export const svRegistry: Record<string, () => Promise<{ default: AnyCreateSim }>> = {
  'baseline-js': () => import('../../../impls/baseline-js/src/survivors/index.ts'),
  bitecs: () => import('../../../impls/bitecs/src/survivors/index.ts'),
  koota: () => import('../../../impls/koota/src/survivors/index.ts'),
  iris: () => import('../../../impls/iris/src/survivors/index.ts'),
}

/** The entries of bricks. They live in games/bricks and play the game with systems: `systems` and `snapshot`. */
export type BricksSim = { systems: Record<string, (tick: number) => void>, snapshot(): { score: number, balls: number[][], blocks: number[][] }, dispose?: () => void }
export const brRegistry: Record<string, () => Promise<{ default: (scenario: BricksScenario) => BricksSim }>> = {
  vanilla: () => import('../../../games/bricks/entries/vanilla.ts'),
  koota: () => import('../../../games/bricks/entries/koota.ts'),
  bitecs: () => import('../../../games/bricks/entries/bitecs.ts'),
  iris: () => import('../../../games/bricks/entries/iris.ts'),
}

/** The impls that have a factory entry. */
export const faRegistry: Record<string, () => Promise<{ default: AnyCreateSim }>> = {
  'baseline-js': () => import('../../../impls/baseline-js/src/factory/index.ts'),
  bitecs: () => import('../../../impls/bitecs/src/factory/index.ts'),
  koota: () => import('../../../impls/koota/src/factory/index.ts'),
  iris: () => import('../../../impls/iris/src/factory/index.ts'),
}
