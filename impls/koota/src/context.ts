import { createWorld, type Entity, type QueryParameter, type World } from 'koota'
import type { CreateSim, Scenario } from '@ecs-arena/spec'
import { CELL } from './spatial.ts'
import { Clock, GameId, Metrics, NextId, Score } from './components.ts'
import { observeDirty } from './derived-stats.ts'
import { createQueries, type Queries } from './queries.ts'

export type Kernel = Parameters<CreateSim>[1]

export interface Context {
  // Config
  k: Kernel
  scenario: Scenario
  gridN: number
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
  const { distSq } = k
  const q = createQueries()
  const dirty = new Set<Entity>()
  observeDirty(world, dirty)

  return {
    k,
    scenario,
    world,
    q,
    dirty,
    gridN: Math.ceil(k.ARENA / CELL),
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
    homeX: (team) => (team === 0 ? 0 : k.MAX_COORD),
    isThinkTick: (id, tick) => (id + tick) % k.THINK_INTERVAL === 0,
    inRange: (ax, ay, bx, by, r) => distSq(ax, ay, bx, by) <= r * r,
    aliveCount: (team) => {
      let n = 0
      world.query(q.teamQuery).readEach(([t]) => { if (t.value === team) n++ })
      return n
    },
  }
}
