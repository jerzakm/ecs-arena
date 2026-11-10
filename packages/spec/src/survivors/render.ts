// Events, the snapshot layout and the render helpers.
import { fx } from '../kernel.ts'
import { CAMERA_HALF } from './core.ts'

export const EVENT = { HIT: 0, KILL: 1, STATUS: 2, PICKUP: 3, LEVELUP: 4 } as const
export const EVENT_COUNT = Object.keys(EVENT).length
export const SNAPSHOT = {
  WORLD: ['tick', 'nextId', 'alive', 'kills', 'dmgOut', 'dmgTaken', 'level', 'xp', 'picks', 'evt0', 'evt1', 'evt2', 'evt3', 'evt4', 'renderChain'],
  PLAYER: ['x', 'y', 'hp', 'flags', 'iframesUntil', 'heldCount', '(id level cd)*'],
  MOB: ['gameId', 'kind', 'x', 'y', 'vx', 'vy', 'hp', 'shield', 'flags', 'affix', 'aux', 'nTimed', '(statusId until stacks)*', 'summoner'],
  PROJECTILE: ['gameId', 'weapon', 'owner', 'traits', 'x', 'y', 'vx', 'vy', 'ttl', 'pierceLeft', 'bounceLeft', 'hitMask', 'target'],
  PICKUP: ['gameId', 'kind', 'x', 'y', 'value', 'ttl', 'attracted'],
  PARTICLE: ['gameId', 'kind', 'x', 'y', 'vx', 'vy', 'ttl'],
} as const
export const RENDER_STRIDE = 6
export const RENDER_KIND = { PLAYER: 100, PROJECTILE: 32, PICKUP: 64, PARTICLE: 80 } as const
/** Render hp byte. */
export const hpByte = (hp: number, maxHpValue: number): number => fx.div(hp * 255, maxHpValue)
export const inCamera = (px: number, py: number, x: number, y: number): boolean =>
  Math.abs(x - px) <= CAMERA_HALF && Math.abs(y - py) <= CAMERA_HALF
