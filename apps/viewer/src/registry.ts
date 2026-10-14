import type { CreateSim } from '@ecs-arena/spec'

export const registry: Record<string, () => Promise<{ default: CreateSim }>> = {
  'baseline-js': () => import('@ecs-arena/impl-baseline-js'),
}
