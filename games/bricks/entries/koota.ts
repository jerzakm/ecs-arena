// Koota entry for bricks. Each field group is a trait, each system is a function that uses a query.
import { createQuery, createWorld, trait } from 'koota'
import { CELL, DT, W, H, type BricksScenario, type SystemName, startRows, respawnRows } from '../shared.ts'

const GameId = trait({ id: 0 })
const Position = trait({ x: 0, y: 0 })
const Velocity = trait({ vx: 0, vy: 0 })
const Cell = trait({ cx: 0, cy: 0 })
const Hp = trait({ hp: 0 })
const Score = trait({ n: 0 }) // a world trait: one value for the whole world

const bounce = (p: number, v: number, size: number): [number, number] => {
  p += v * DT
  if (p < 0) return [-p, -v]
  if (p > size - 1) return [2 * (size - 1) - p, -v]
  return [p, v]
}

const balls = createQuery(GameId, Position, Velocity)
const blocks = createQuery(GameId, Cell, Hp)

const createSim = (scenario: BricksScenario) => {
  const world = createWorld()
  world.add(Score)

  const start = startRows(scenario.seed)
  for (const [id, x, y, vx, vy] of start.balls) world.spawn(GameId({ id }), Position({ x, y }), Velocity({ vx, vy }))
  for (const [id, cx, cy, hp] of start.blocks) world.spawn(GameId({ id }), Cell({ cx, cy }), Hp({ hp }))

  const moveBalls = () => {
    world.query(balls).updateEach(([, p, v]) => {
      ;[p.x, v.vx] = bounce(p.x, v.vx, W)
      ;[p.y, v.vy] = bounce(p.y, v.vy, H)
    }, { changeDetection: 'never' })
  }

  // A hit takes 1 hp and gives 1 point. A block with hp <= 0 still counts here, because it dies in destroyBroken.
  // useStores (the koota way for hot loops) gives plain arrays, so the block scan can stop at the first match like find.
  const hitBlocks = () => {
    let hits = 0
    world.query(balls).useStores(([, p, v], ballEnts) => {
      world.query(blocks).useStores(([, c, h], blockEnts) => {
        for (let i = 0; i < ballEnts.length; i++) {
          const b = ballEnts[i].id()
          const bx = Math.floor(p.x[b] / CELL), by = Math.floor(p.y[b] / CELL)
          for (let j = 0; j < blockEnts.length; j++) {
            const k = blockEnts[j].id()
            if (c.cx[k] !== bx || c.cy[k] !== by) continue
            h.hp[k] -= 1
            hits += 1
            if (Math.floor((p.y[b] - v.vy[b] * DT) / CELL) !== by) v.vy[b] = -v.vy[b]
            else v.vx[b] = -v.vx[b]
            break
          }
        }
      })
    })
    if (hits) world.set(Score, (s) => ({ n: s.n + hits }))
  }

  const destroyBroken = () => {
    world.query(blocks).readEach(([, , h], e) => {
      if (h.hp <= 0) e.destroy()
    })
  }

  const respawnBlocks = (tick: number) => {
    for (const [id, cx, cy, hp] of respawnRows(scenario.seed, tick)) {
      let taken = false
      // readEach cannot stop early, so scan the cell store with a plain loop.
      world.query(blocks).useStores(([, c], ents) => {
        for (let j = 0; j < ents.length && !taken; j++) {
          const k = ents[j].id()
          taken = c.cx[k] === cx && c.cy[k] === cy
        }
      })
      if (!taken) world.spawn(GameId({ id }), Cell({ cx, cy }), Hp({ hp }))
    }
  }

  const systems: Record<SystemName, (tick: number) => void> = { moveBalls, hitBlocks, destroyBroken, respawnBlocks }
  return {
    systems,
    snapshot: () => {
      const ballRows: number[][] = [], blockRows: number[][] = []
      world.query(balls).readEach(([g, p, v]) => void ballRows.push([g.id, p.x, p.y, v.vx, v.vy]))
      world.query(blocks).readEach(([g, c, h]) => void blockRows.push([g.id, c.cx, c.cy, h.hp]))
      return { score: world.get(Score)!.n, balls: ballRows, blocks: blockRows }
    },
    dispose: () => world.destroy(),
  }
}
export default createSim
