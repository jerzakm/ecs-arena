import {
  addResource, collectEntities, getComponentValue, getRelationTargets, getResourceValue, hasComponent,
  registerObserverCallback, setComponentValue, setResourceValue,
  type Component, type EntityId, type InferSchema, type QueryTerm, type SchemaRecord, type World,
} from 'iris-ecs'
import { type Kernel, type Scenario } from '@ecs-arena/spec'
import { Clock, Equips, GameId, Metrics, NextId, Score, Team, Threat, Unit, type Link, type Targets, type LastHitBy } from './components.ts'
import { observeDirty } from './derived-stats.ts'
import { ChildOf } from './relations.ts'
import { UnitGrid } from './unit-grid.ts'

export interface Context {
  // Config
  k: Kernel
  scenario: Scenario
  units: UnitGrid
  entityOf: Map<number, EntityId> // gameId -> live entity: every link field and list holds a gameId and resolves here
  // State
  world: World
  dirty: Set<EntityId>
  nextId: () => number
  res: <S extends SchemaRecord, K extends keyof S>(r: Component<S>, field: K) => InferSchema<S[K]>
  setRes: <S extends SchemaRecord, K extends keyof S>(r: Component<S>, field: K, value: InferSchema<S[K]>) => void
  tickNow: () => number // the Clock advances in the first phase (spawn system)
  // Helpers
  get: <S extends SchemaRecord, K extends keyof S>(e: EntityId, c: Component<S>, field: K) => InferSchema<S[K]>
  set: <S extends SchemaRecord, K extends keyof S>(e: EntityId, c: Component<S>, field: K, value: InferSchema<S[K]>) => void
  gid: (e: EntityId) => number
  /** The gameId lookup of a commander order (SPEC 6.12). A destroyed unit leaves the map. */
  unitByKey: (key: number) => EntityId | undefined
  /** Entities of a query with their gameId, in gameId order. */
  sortedByGameId: (...terms: QueryTerm[]) => { id: number; e: EntityId }[]
  /** The entity a link names. A link to a destroyed entity reads as no link, as a relation pair would. */
  targetOf: (e: EntityId, link: Link) => EntityId | undefined
  /** The summoner of a minion: the one target of its `ChildOf` pair. */
  summonerOf: (e: EntityId) => EntityId | undefined
  /** Sets or clears a link that every unit carries. The field stores the gameId, which iris never reuses (an entity id repeats after 256 reuses of its slot). */
  setLink: (e: EntityId, link: typeof Targets | typeof LastHitBy, to: EntityId | undefined) => void
  /** The threat edges of a unit, flat as attacker gameId and amount. An edge can name a destroyed attacker: resolve it with `entityOf`. */
  threatOf: (e: EntityId) => number[]
  /** The held items of a unit, flat as item gameId and quality. */
  equipsOf: (e: EntityId) => number[]
  homeX: (team: number) => number
  isThinkTick: (id: number, tick: number) => boolean
  inRange: (ax: number, ay: number, bx: number, by: number, r: number) => boolean
  aliveCount: (team: number) => number
}

export const byGameId = (a: { id: number }, b: { id: number }) => a.id - b.id

export const createContext = (world: World, scenario: Scenario, k: Kernel): Context => {
  addResource(world, Clock, { tick: -1 })
  addResource(world, NextId, { value: 1 })
  addResource(world, Metrics, { alive0: 0, alive1: 0, kills0: 0, kills1: 0, damage0: 0, damage1: 0, orders0: 0, orders1: 0, renderChain: 0x811c9dc5 | 0, winner: -1 })
  addResource(world, Score, { shrines0: 0, shrines1: 0 })

  const dirty = new Set<EntityId>()
  observeDirty(world, dirty)
  const units = new UnitGrid()
  const entityOf = new Map<number, EntityId>()
  // Observers keep the gameId map and the kernel grid current: they also see the minions that `ChildOf` destroys with their summoner.
  registerObserverCallback(world, 'componentAdded', (c, e) => { if (c === GameId) entityOf.set(getComponentValue(world, e, GameId, 'id') as number, e) })
  registerObserverCallback(world, 'entityDestroying', (e) => {
    if (hasComponent(world, e, GameId)) entityOf.delete(getComponentValue(world, e, GameId, 'id') as number)
    units.untrack(e)
  })

  const get: Context['get'] = (e, c, field) => getComponentValue(world, e, c, field) as never
  const set: Context['set'] = (e, c, field, value) => setComponentValue(world, e, c, field, value)
  const targetOf: Context['targetOf'] = (e, link) => {
    if (!hasComponent(world, e, link)) return undefined
    const g = getComponentValue(world, e, link, 'to') as number
    return g === 0 ? undefined : entityOf.get(g)
  }
  const res: Context['res'] = (r, field) => getResourceValue(world, r, field) as never
  const setRes: Context['setRes'] = (r, field, value) => setResourceValue(world, r, field, value)
  const gid = (e: EntityId) => get(e, GameId, 'id')

  return {
    k,
    scenario,
    world,
    dirty,
    units,
    entityOf,
    get,
    set,
    gid,
    res,
    setRes,
    tickNow: () => res(Clock, 'tick'),
    nextId: () => {
      const id = res(NextId, 'value')
      setRes(NextId, 'value', id + 1)
      return id
    },
    unitByKey: (key) => {
      const e = entityOf.get(key)
      return e !== undefined && hasComponent(world, e, Unit) ? e : undefined
    },
    sortedByGameId: (...terms) => {
      const out = (collectEntities(world, [GameId, ...terms]) as EntityId[]).map((e) => ({ id: gid(e), e }))
      return out.sort(byGameId)
    },
    targetOf,
    summonerOf: (e) => getRelationTargets(world, e, ChildOf)[0],
    setLink: (e, link, to) => setComponentValue(world, e, link, 'to', (to === undefined ? 0 : gid(to)) as never),
    threatOf: (e) => getComponentValue(world, e, Threat, 'edges') as number[],
    equipsOf: (e) => getComponentValue(world, e, Equips, 'items') as number[],
    homeX: k.homeX,
    isThinkTick: k.isThinkTick,
    inRange: k.inRange,
    aliveCount: (team) => {
      let n = 0
      for (const e of collectEntities(world, [Unit, Team])) if (get(e, Team, 'value') === team) n++
      return n
    },
  }
}
