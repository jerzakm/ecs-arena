import { createWorld, type Entity, type World } from 'koota'
import { SpatialGrid, survivors, type SvKernel } from '@ecs-arena/spec'
import { createEvents, type Events } from './events.ts'
import { refreshLoadout } from './loadout.ts'
import { createQueries, type Queries } from './queries.ts'
import { Clock, GameId, Held, Hp, Loadout, Mob, Player, Position, Totals } from './traits.ts'

export interface Ctx {
  k: SvKernel
  scenario: survivors.SurvivorsScenario
  world: World // the world traits Clock, Totals and Loadout hold the singletons
  q: Queries
  events: Events
  grid: SpatialGrid // handle: entity id
  mobAt: Entity[] // grid handle -> mob
  kindAt: number[] // grid handle -> mob kind
  player: Entity
}

/** The world at the start of a run: the player and the starting upgrades (SPEC-survivors §3.2). */
export const createContext = (scenario: survivors.SurvivorsScenario, k: SvKernel): Ctx => {
  const world = createWorld(Clock, Totals, Loadout)
  const grid = new SpatialGrid()
  world.onRemove(Mob, (e) => grid.remove(e.id()))
  const [x, y] = k.playerPos(0)
  const player = world.spawn(GameId({ id: k.PLAYER_ID }), Player, Position({ x, y }), Hp({ hp: k.PLAYER_HP }))
  for (const id of k.START_HELD) world.spawn(Held({ id, level: 1, cd: 0 }))
  const ctx: Ctx = { k, scenario, world, q: createQueries(), events: createEvents(), grid, mobAt: [], kindAt: [], player }
  refreshLoadout(ctx)
  return ctx
}
