// Iris entry for bricks. Each field group is a component, each system is a function that reads the columns of the matching archetypes.
import {
  addResource, collectEntities, createEntity, createWorld, defineComponent, destroyEntity, type EntityId,
  EXPERIMENTAL_queryColumns as queryColumns, getComponentValue as get, getResourceValue, setResourceValue, Type,
} from 'iris-ecs'
import { CELL, DT, W, H, type BricksScenario, type SystemName, startRows, respawnRows } from '../shared.ts'

const GameId = defineComponent('BricksGameId', { schema: { id: Type.i32() } })
const Position = defineComponent('BricksPosition', { schema: { x: Type.f64(), y: Type.f64() } })
const Velocity = defineComponent('BricksVelocity', { schema: { vx: Type.f64(), vy: Type.f64() } })
const Cell = defineComponent('BricksCell', { schema: { cx: Type.i32(), cy: Type.i32() } })
const Hp = defineComponent('BricksHp', { schema: { hp: Type.i32() } })
const Score = defineComponent('BricksScore', { schema: { n: Type.i32() } }) // a resource: one value for the whole world

const bounce = (p: number, v: number, size: number): [number, number] => {
  p += v * DT
  if (p < 0) return [-p, -v]
  if (p > size - 1) return [2 * (size - 1) - p, -v]
  return [p, v]
}

const balls = [GameId, Position, Velocity] as const
const blocks = [GameId, Cell, Hp] as const

const createSim = (scenario: BricksScenario) => {
  const world = createWorld()
  addResource(world, Score, { n: 0 })

  const start = startRows(scenario.seed)
  for (const [id, x, y, vx, vy] of start.balls) createEntity(world, [[GameId, { id }], [Position, { x, y }], [Velocity, { vx, vy }]])
  for (const [id, cx, cy, hp] of start.blocks) createEntity(world, [[GameId, { id }], [Cell, { cx, cy }], [Hp, { hp }]])

  // queryColumns is EXPERIMENTAL in iris-ecs. This repo uses it for all hot loops: it gives plain typed arrays and a callback that can stop.
  const moveBalls = () => {
    queryColumns(world, balls, (entities, [, pos, vel]) => {
      for (let i = 0; i < entities.length; i++) {
        const [x, vx] = bounce(pos.x[i], vel.vx[i], W)
        const [y, vy] = bounce(pos.y[i], vel.vy[i], H)
        pos.x[i] = x; vel.vx[i] = vx; pos.y[i] = y; vel.vy[i] = vy
      }
    })
  }

  // A hit takes 1 hp and gives 1 point. A block with hp <= 0 still counts here, because it dies in destroyBroken.
  // The callback returns false at the first block in the cell, like find in vanilla.ts.
  // A column can be longer than the archetype, so each loop stops at entities.length.
  const hitBlocks = () => {
    queryColumns(world, balls, (entities, [, pos, vel]) => {
      for (let i = 0; i < entities.length; i++) {
        const y = pos.y[i], vy = vel.vy[i]
        const bx = Math.floor(pos.x[i] / CELL), by = Math.floor(y / CELL)
        let hit = false
        queryColumns(world, blocks, (entities, [, cell, hp]) => {
          for (let j = 0; j < entities.length; j++) {
            if (cell.cx[j] !== bx || cell.cy[j] !== by) continue
            hp.hp[j] -= 1
            hit = true
            return false
          }
        })
        if (!hit) continue
        setResourceValue(world, Score, 'n', getResourceValue(world, Score, 'n') + 1)
        if (Math.floor((y - vy * DT) / CELL) !== by) vel.vy[i] = -vy
        else vel.vx[i] = -vel.vx[i]
      }
    })
  }

  // Iris does not allow a destroy while a query runs, so collect the entities first.
  const destroyBroken = () => {
    const broken: EntityId[] = []
    queryColumns(world, blocks, (entities, [, , hp]) => {
      for (let i = 0; i < entities.length; i++) if (hp.hp[i] <= 0) broken.push(entities[i])
    })
    for (const block of broken) destroyEntity(world, block)
  }

  const respawnBlocks = (tick: number) => {
    for (const [id, cx, cy, hp] of respawnRows(scenario.seed, tick)) {
      let taken = false
      queryColumns(world, blocks, (entities, [, cell]) => {
        for (let j = 0; j < entities.length; j++) {
          if (cell.cx[j] === cx && cell.cy[j] === cy) { taken = true; return false }
        }
      })
      if (!taken) createEntity(world, [[GameId, { id }], [Cell, { cx, cy }], [Hp, { hp }]])
    }
  }

  const systems: Record<SystemName, (tick: number) => void> = { moveBalls, hitBlocks, destroyBroken, respawnBlocks }
  return {
    systems,
    snapshot: () => ({
      score: getResourceValue(world, Score, 'n'),
      balls: collectEntities(world, balls).map((e) => [
        get(world, e, GameId, 'id'), get(world, e, Position, 'x'), get(world, e, Position, 'y'),
        get(world, e, Velocity, 'vx'), get(world, e, Velocity, 'vy'),
      ]),
      blocks: collectEntities(world, blocks).map((e) => [
        get(world, e, GameId, 'id'), get(world, e, Cell, 'cx'), get(world, e, Cell, 'cy'), get(world, e, Hp, 'hp'),
      ]),
    }),
  }
}
export default createSim
