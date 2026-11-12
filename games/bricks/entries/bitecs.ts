// bitecs entry for bricks. A component is an object of arrays that the author makes. Entity ids index the arrays.
import { addComponent, addEntity, createWorld, query, removeEntity } from 'bitecs'
import { CELL, DT, W, H, startRows, respawnRows, type BricksScenario, type SystemName } from '../shared.ts'

const SIZE = 4096 // entity ids stay below this, because bitecs reuses ids
// Float64Array holds the ball floats at 64 bits. Float32Array would fail verify.
const f64 = () => new Float64Array(SIZE)
const i32 = () => new Int32Array(SIZE)

const bounce = (p: number, v: number, size: number): [number, number] => {
  p += v * DT
  if (p < 0) return [-p, -v]
  if (p > size - 1) return [2 * (size - 1) - p, -v]
  return [p, v]
}

const createSim = (scenario: BricksScenario) => {
  const world = createWorld({
    components: {
      GameId: i32(),
      Position: { x: f64(), y: f64() },
      Velocity: { x: f64(), y: f64() },
      Cell: { x: i32(), y: i32() },
      Hp: i32(),
    },
    score: 0,
  })
  const { GameId, Position, Velocity, Cell, Hp } = world.components

  const spawnBall = ([id, x, y, vx, vy]: number[]) => {
    const eid = addEntity(world)
    addComponent(world, eid, GameId)
    addComponent(world, eid, Position)
    addComponent(world, eid, Velocity)
    GameId[eid] = id
    Position.x[eid] = x; Position.y[eid] = y
    Velocity.x[eid] = vx; Velocity.y[eid] = vy
  }
  const spawnBlock = ([id, cx, cy, hp]: number[]) => {
    const eid = addEntity(world)
    addComponent(world, eid, GameId)
    addComponent(world, eid, Cell)
    addComponent(world, eid, Hp)
    GameId[eid] = id
    Cell.x[eid] = cx; Cell.y[eid] = cy
    Hp[eid] = hp
  }

  const start = startRows(scenario.seed)
  start.balls.forEach(spawnBall)
  start.blocks.forEach(spawnBlock)

  const moveBalls = () => {
    for (const eid of query(world, [Position, Velocity])) {
      ;[Position.x[eid], Velocity.x[eid]] = bounce(Position.x[eid], Velocity.x[eid], W)
      ;[Position.y[eid], Velocity.y[eid]] = bounce(Position.y[eid], Velocity.y[eid], H)
    }
  }

  // A block with hp <= 0 still counts here, because it dies in destroyBroken.
  const hitBlocks = () => {
    for (const ball of query(world, [Position, Velocity])) {
      const bx = Math.floor(Position.x[ball] / CELL), by = Math.floor(Position.y[ball] / CELL)
      for (const block of query(world, [Cell, Hp])) {
        if (Cell.x[block] !== bx || Cell.y[block] !== by) continue
        Hp[block] -= 1
        world.score += 1
        if (Math.floor((Position.y[ball] - Velocity.y[ball] * DT) / CELL) !== by) Velocity.y[ball] = -Velocity.y[ball]
        else Velocity.x[ball] = -Velocity.x[ball]
        break // a cell holds one block
      }
    }
  }

  const destroyBroken = () => {
    for (const eid of query(world, [Hp])) {
      if (Hp[eid] <= 0) removeEntity(world, eid)
    }
  }

  const respawnBlocks = (tick: number) => {
    for (const row of respawnRows(scenario.seed, tick)) {
      const [, cx, cy] = row
      let taken = false
      for (const eid of query(world, [Cell, Hp])) {
        if (Cell.x[eid] === cx && Cell.y[eid] === cy) { taken = true; break }
      }
      if (!taken) spawnBlock(row)
    }
  }

  const systems: Record<SystemName, (tick: number) => void> = { moveBalls, hitBlocks, destroyBroken, respawnBlocks }
  return {
    systems,
    snapshot: () => ({
      score: world.score,
      balls: [...query(world, [Position, Velocity])].map((e) => [GameId[e], Position.x[e], Position.y[e], Velocity.x[e], Velocity.y[e]]),
      blocks: [...query(world, [Cell, Hp])].map((e) => [GameId[e], Cell.x[e], Cell.y[e], Hp[e]]),
    }),
  }
}
export default createSim
