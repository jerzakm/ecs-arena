import { createWorld, type Entity, type World } from 'koota'
import { SpatialGrid, type Kernel, type Scenario } from '@ecs-arena/spec'
import { Clock, Metrics, NextId, Score, Unit } from './traits.ts'
import { observeDirty } from './derived-stats.ts'
import { createQueries, type Queries } from './queries.ts'

export interface Ctx {
  k: Kernel
  scenario: Scenario
  world: World // the world traits Clock, NextId, Metrics and Score hold the singletons
  q: Queries
  dirty: Set<Entity> // units whose derived stats may have changed
  grid: SpatialGrid // handle: entity id
  unitAt: Entity[] // grid handle -> unit
  teamAt: number[] // grid handle -> team
  inGrid: boolean[] // grid handle -> the unit is in the grid (a garrisoned unit is not)
  idAt: number[] // grid handle -> gameId
  unitById: Map<number, Entity> // gameId -> unit, for the keys of commander orders (SPEC 6.12)
}

export const createContext = (scenario: Scenario, k: Kernel): Ctx => {
  const world = createWorld(Clock, NextId, Metrics, Score)
  const dirty = new Set<Entity>()
  observeDirty(world, dirty)
  const grid = new SpatialGrid()
  const inGrid: boolean[] = []
  const unitById = new Map<number, Entity>()
  const idAt: number[] = []
  world.onRemove(Unit, (e) => {
    if (inGrid[e.id()]) grid.remove(e.id())
    unitById.delete(idAt[e.id()])
  })
  return { k, scenario, world, q: createQueries(), dirty, grid, unitAt: [], teamAt: [], inGrid, idAt, unitById }
}
