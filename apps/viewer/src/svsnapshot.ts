import type { Unit } from './snapshot.ts'
import { PLAYER_KIND } from './svlook.ts'

export interface SvWorld { tick: number; alive: number; kills: number; level: number; xp: number; picks: number; hp: number }
export interface Held { id: number; level: number }
export interface SvProjectile { gameId: number; weapon: number; traits: number; x: number; y: number; vx: number; vy: number }
export interface SvPoint { kind: number; x: number; y: number }
export interface SvSnapshot {
  world: SvWorld
  held: Held[]
  /** The player first (team 0, kind 100), then the mobs (team 1). A mob `cooldown` is its `aux`, so a stage change plays the Attack strip. */
  units: Unit[]
  projectiles: SvProjectile[]
  pickups: SvPoint[]
  particles: SvPoint[]
}

/** Parses the SPEC-survivors §8 int32 snapshot. */
export const parseSvSnapshot = (s: ArrayLike<number>): SvSnapshot => {
  const [tick, alive, kills, level, xp, picks] = [s[0], s[2], s[3], s[6], s[7], s[8]]
  let i = 15
  const [px, py, php, pflags] = [s[i], s[i + 1], s[i + 2], s[i + 3]]
  i += 5
  const held: Held[] = []
  for (let n = s[i++]; n > 0; n--, i += 3) held.push({ id: s[i], level: s[i + 1] })

  const units: Unit[] = [{ gameId: 1, team: 0, kind: PLAYER_KIND, x: px, y: py, hp: php, maxHp: php, cooldown: 0, flags: pflags, buffs: [] }]
  for (let n = s[i++]; n > 0; n--) {
    const [gameId, kind, x, y, hp, flags, aux] = [s[i], s[i + 1], s[i + 2], s[i + 3], s[i + 6], s[i + 8], s[i + 10]]
    i += 11
    i += s[i] * 3 + 2 // nTimed, the tags, summoner
    units.push({ gameId, team: 1, kind, x, y, hp, maxHp: hp, cooldown: aux, flags, buffs: [] })
  }

  const projectiles: SvProjectile[] = []
  for (let n = s[i++]; n > 0; n--, i += 13) projectiles.push({ gameId: s[i], weapon: s[i + 1], traits: s[i + 3], x: s[i + 4], y: s[i + 5], vx: s[i + 6], vy: s[i + 7] })
  const pickups: SvPoint[] = []
  for (let n = s[i++]; n > 0; n--, i += 7) pickups.push({ kind: s[i + 1], x: s[i + 2], y: s[i + 3] })
  const particles: SvPoint[] = []
  for (let n = s[i++]; n > 0; n--, i += 7) particles.push({ kind: s[i + 1], x: s[i + 2], y: s[i + 3] })

  return { world: { tick, alive, kills, level, xp, picks, hp: php }, held, units, projectiles, pickups, particles }
}
