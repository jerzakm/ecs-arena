import { SpatialGrid, survivors, type SvKernel } from '@ecs-arena/spec'
import type { Counters, Regions } from '../shared/instrumentation.ts'
import { createChurn, createResendGrid, type Churn } from './entities.ts'
import { createEvents, type Events } from './events.ts'
import { createGates, type Gates } from './gates.ts'
import { createTags, type Tags } from './tags.ts'
import type { Ent, EntityLists, Mob, Pending, Player } from './types.ts'

/** The context before the functions that the naive switches select are added to it. The factories of those functions take this type. */
export interface CtxData {
  k: SvKernel
  scenario: survivors.SurvivorsScenario
  counters: Counters | undefined
  grid: SpatialGrid
  tick: number // advances in the last phase (stats.render)
  px: number; py: number // the player position of this tick, set by player.path
  lists: EntityLists // each in ascending gameId order, indexed by ENT
  slots: Mob[] // grid handle -> mob
  freeSlots: number[]
  mobById: Map<number, Mob>
  kids: Map<number, Mob[]> // summoner gameId -> its live children
  gone: number[] // gameIds of destroyed mobs that had children, for cleanup.cascade
  kindCount: number[]
  hostile: number // live hostile projectiles
  player: Player
  held: survivors.kernel.Held[]
  wstat: (survivors.kernel.WeaponStats | undefined)[] // by upgrade id
  pstat: survivors.kernel.Stats
  hasOrbit: boolean; hasAura: boolean; hasExplode: boolean
  totals: survivors.kernel.Totals
  ev: number[][] // typed event lists, flat
  evAll: number[] // the naive flag.reads code keeps one list: type, then the fields
  changed: Mob[] // mobs whose hp changed in resolve.damage, in gameId order
  wheel: Map<number, Mob[]> // until -> mobs that may have a tag that expires then
  ttlWheel: Map<number, Ent[]> // ttl -> entities
  dirty: number // bit t is set when the list of type t holds dead entities
  picked: boolean
  evolved: [number, number][]
  pending: Pending[]
  // Instrumentation. Without a runner the hooks do nothing and no region is naive.
  nv: Record<survivors.Region, boolean>
  add(name: string, n?: number): void
  begin(region: string): void
  end(region: string): void
}

/** `CtxData` and the functions that need `nv`. Each is the normal or the naive function of its region, picked once in `createContext`. */
export interface Ctx extends CtxData {
  tags: Tags
  events: Events
  churn: Churn
  gates: Gates
  resendGrid(): void
}

export const createContext = (scenario: survivors.SurvivorsScenario, k: SvKernel, counters?: Counters, regions?: Regions): Ctx => {
  const isNaive = (region: survivors.Region) => regions?.naive.has(region) ?? false
  const nv = Object.fromEntries(survivors.REGIONS.map((region) => [region, isNaive(region)])) as Record<survivors.Region, boolean>
  const data: CtxData = {
    k, scenario, counters, grid: new SpatialGrid(counters), tick: 0, px: 0, py: 0,
    lists: [[], [], [], []], slots: [], freeSlots: [], mobById: new Map(), kids: new Map(), gone: [],
    kindCount: k.MOBS.map(() => 0), hostile: 0,
    player: { x: 0, y: 0, hp: k.PLAYER_HP, iframes: 0 },
    held: k.START_HELD.map((id) => ({ id, level: 1, cd: 0 })),
    wstat: [], pstat: { might: 0, haste: 0, reach: 0, velocity: 0, magnet: 0, amount: 0, vigor: 0, greed: 0 },
    hasOrbit: false, hasAura: false, hasExplode: false,
    totals: survivors.kernel.newTotals(),
    ev: [[], [], [], [], []], evAll: [], changed: [], wheel: new Map(), ttlWheel: new Map(), dirty: 0,
    picked: false, evolved: [], pending: [],
    nv,
    add: (name, n = 1) => counters?.add(name, n),
    begin: regions ? regions.begin : () => {},
    end: regions ? regions.end : () => {},
  }
  return Object.assign(data, {
    tags: createTags(data), events: createEvents(data), churn: createChurn(data), gates: createGates(data),
    resendGrid: createResendGrid(data),
  })
}
