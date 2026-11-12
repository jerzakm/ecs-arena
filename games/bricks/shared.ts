// The shared code of bricks: constants, start data, respawn data and scenarios. Every entry imports it.
import { rand } from '../../packages/spec/src/kernel.ts'
import type { BaseScenario } from '../../packages/spec/src/contract.ts'

export const COLS = 64
export const ROWS = 48
export const CELL = 16
export const W = COLS * CELL
export const H = ROWS * CELL
export const BALLS = 32
export const BLOCKS = 1500
export const RESPAWN_PER_TICK = 6
export const DT = 1 / 60 // seconds in one tick

/** The systems of one tick, in the order that an entry runs them. */
export const SYSTEMS = ['moveBalls', 'hitBlocks', 'destroyBroken', 'respawnBlocks'] as const
export type SystemName = (typeof SYSTEMS)[number]

// One draw for each random choice: the `purpose` argument of `rand`.
const X = 1, Y = 2, VX = 3, VY = 4, HP = 5, CELL_OF = 6, SIGN_X = 7, SIGN_Y = 8

export type BallRow = [gameId: number, x: number, y: number, vx: number, vy: number]
export type BlockRow = [gameId: number, cx: number, cy: number, hp: number]

// A random float in [0, 1).
const u = (seed: number, id: number, purpose: number) => rand(seed, 0, id, purpose) / 2 ** 32

// A speed is 180 to 540 pixels for each second, with a random sign. It is 3 to 9 pixels for each tick, and it is never 0.
const speed = (seed: number, id: number, purpose: number, signPurpose: number) =>
  (180 + 360 * u(seed, id, purpose)) * (rand(seed, 0, id, signPurpose) % 2 ? 1 : -1)

/** Block rows for `ids`. Each row takes a random cell that no earlier row of the call took: a taken cell moves on to the next free one. */
const blockRows = (seed: number, tick: number, ids: number[]): BlockRow[] => {
  const taken = new Set<number>()
  return ids.map((id) => {
    let cell = rand(seed, tick, id, CELL_OF) % (COLS * ROWS)
    while (taken.has(cell)) cell = (cell + 1) % (COLS * ROWS)
    taken.add(cell)
    return [id, cell % COLS, Math.floor(cell / COLS), 1 + (rand(seed, tick, id, HP) % 3)]
  })
}

/** The balls and blocks at tick 0. GameIds 1 to BALLS are balls, the next BLOCKS are blocks. */
export const startRows = (seed: number): { balls: BallRow[]; blocks: BlockRow[] } => ({
  balls: Array.from({ length: BALLS }, (_, i): BallRow => {
    const id = i + 1
    return [id, u(seed, id, X) * W, u(seed, id, Y) * H, speed(seed, id, VX, SIGN_X), speed(seed, id, VY, SIGN_Y)]
  }),
  blocks: blockRows(seed, 0, Array.from({ length: BLOCKS }, (_, i) => BALLS + i + 1)),
})

/** The candidate blocks of `tick`. The shared code assigns the gameIds, and the runner gives the tick. The respawnBlocks system skips a row whose cell holds a block. */
export const respawnRows = (seed: number, tick: number): BlockRow[] =>
  blockRows(seed, tick + 1, Array.from({ length: RESPAWN_PER_TICK }, (_, i) => (tick + 1) * RESPAWN_PER_TICK + i + BALLS + BLOCKS + 1))

export type BricksScenario = BaseScenario

/** The registry helper adds the seed and the board list. */
export const SCENARIOS: Readonly<Record<string, { name: string; ticks: number }>> = {
  bricks: { name: 'bricks', ticks: 1000 },
  'bricks-smoke': { name: 'bricks-smoke', ticks: 200 },
}
