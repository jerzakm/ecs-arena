import type { AnyCreateSim } from '@ecs-arena/spec'

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

/** The impls that have a factory entry. */
export const faRegistry: Record<string, () => Promise<{ default: AnyCreateSim }>> = {
  'baseline-js': () => import('../../../impls/baseline-js/src/factory/index.ts'),
  bitecs: () => import('../../../impls/bitecs/src/factory/index.ts'),
  koota: () => import('../../../impls/koota/src/factory/index.ts'),
  iris: () => import('../../../impls/iris/src/factory/index.ts'),
}
