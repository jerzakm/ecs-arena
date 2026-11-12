// Vanilla entry for bricks. It uses plain objects and plain loops, with no library.
// The goldens come from this file. Read it first: each system is one short function.
import { CELL, DT, W, H, startRows, respawnRows, type BricksScenario, type SystemName } from '../shared.ts'

interface Ball { gameId: number; x: number; y: number; vx: number; vy: number }
interface Block { gameId: number; cx: number; cy: number; hp: number }

// Move one axis by its speed for one tick. A ball that leaves the box bounces back by the overshoot and reverses speed.
const bounce = (p: number, v: number, size: number): [number, number] => {
  p += v * DT
  if (p < 0) return [-p, -v]
  if (p > size - 1) return [2 * (size - 1) - p, -v]
  return [p, v]
}

const createSim = (scenario: BricksScenario) => {
  const start = startRows(scenario.seed)
  const balls: Ball[] = start.balls.map(([gameId, x, y, vx, vy]) => ({ gameId, x, y, vx, vy }))
  let blocks: Block[] = start.blocks.map(([gameId, cx, cy, hp]) => ({ gameId, cx, cy, hp }))
  let score = 0

  const moveBalls = () => {
    for (const ball of balls) {
      const [x, vx] = bounce(ball.x, ball.vx, W)
      const [y, vy] = bounce(ball.y, ball.vy, H)
      ball.x = x; ball.vx = vx; ball.y = y; ball.vy = vy
    }
  }

  // A hit takes 1 hp and gives 1 point. The ball bounces back on the axis that it used to enter the cell.
  // A block with hp <= 0 still counts here, because it dies in destroyBroken. So two balls that hit one block on one tick give 2 points.
  const hitBlocks = () => {
    for (const ball of balls) {
      const cx = Math.floor(ball.x / CELL), cy = Math.floor(ball.y / CELL)
      const block = blocks.find((candidate) => candidate.cx === cx && candidate.cy === cy)
      if (!block) continue
      block.hp -= 1
      score += 1
      if (Math.floor((ball.y - ball.vy * DT) / CELL) !== cy) ball.vy = -ball.vy
      else ball.vx = -ball.vx
    }
  }

  const destroyBroken = () => {
    blocks = blocks.filter((block) => block.hp > 0)
  }

  const respawnBlocks = (tick: number) => {
    for (const [gameId, cx, cy, hp] of respawnRows(scenario.seed, tick)) {
      if (!blocks.some((block) => block.cx === cx && block.cy === cy)) blocks.push({ gameId, cx, cy, hp })
    }
  }

  const systems: Record<SystemName, (tick: number) => void> = { moveBalls, hitBlocks, destroyBroken, respawnBlocks }
  return {
    systems,
    // Any order: the runner sorts the rows by gameId.
    snapshot: () => ({
      score,
      balls: balls.map((ball) => [ball.gameId, ball.x, ball.y, ball.vx, ball.vy]),
      blocks: blocks.map((block) => [block.gameId, block.cx, block.cy, block.hp]),
    }),
  }
}
export default createSim
