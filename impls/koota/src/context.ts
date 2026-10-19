import { createWorld, type Entity, type QueryParameter, type World } from 'koota'
import { SpatialGrid, type Kernel, type Scenario } from '@ecs-arena/spec'
import { Clock, GameId, Metrics, NextId, Score, Unit } from './components.ts'
import { observeDirty } from './derived-stats.ts'
import { createQueries, type Queries } from './queries.ts'

export interface Context {
  // Config
  k: Kernel
  scenario: Scenario
  grid: SpatialGrid // handle: entity id
  unitAt: Entity[] // grid handle -> unit
  teamAt: number[] // grid handle -> team
  inGrid: boolean[] // grid handle -> the unit is in the grid (a garrisoned unit is not)
  unitById: Map<number, Entity> // gameId -> unit, for the keys of commander orders (SPEC 6.12)
  idAt: number[] // grid handle -> gameId
  // State
  world: World
  q: Queries
  dirty: Set<Entity>
  nextId: () => number
  tickNow: () => number // the Clock advances in the first phase (spawn system)
  // Helpers
  gid: (e: Entity) => number
  sortedByGameId: (...params: QueryParameter[]) => { id: number; e: Entity }[]
  homeX: (team: number) => number
  isThinkTick: (id: number, tick: number) => boolean
  inRange: (ax: number, ay: number, bx: number, by: number, r: number) => boolean
  aliveCount: (team: number) => number
}

export const byGameId = (a: { id: number }, b: { id: number }) => a.id - b.id

export const createContext = (scenario: Scenario, k: Kernel): Context => {
  const world: World = createWorld(Clock, NextId, Metrics, Score)
  const q = createQueries()
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

  return {
    k,
    scenario,
    world,
    q,
    dirty,
    grid,
    unitAt: [],
    teamAt: [],
    inGrid,
    unitById,
    idAt,
    tickNow: () => world.get(Clock)!.tick,
    nextId: () => {
      const id = world.get(NextId)!.value
      world.set(NextId, { value: id + 1 })
      return id
    },
    gid: (e) => e.get(GameId)!.id,
    sortedByGameId: (...params) => {
      const out: { id: number; e: Entity }[] = []
      world.query(GameId, ...params).readEach(([g], e) => out.push({ id: g.id, e }))
      return out.sort(byGameId)
    },
    homeX: k.homeX,
    isThinkTick: k.isThinkTick,
    inRange: k.inRange,
    aliveCount: (team) => {
      let n = 0
      world.query(q.teamQuery).readEach(([t]) => { if (t.value === team) n++ })
      return n
    },
  }
}
