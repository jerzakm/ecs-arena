// Implementation-agnostic helpers: parse the SPEC §8 snapshot and build test scenarios.
import { SCENARIOS, type CanonicalState, type Scenario } from '@ecs-arena/spec'

export const FLEEING = 1
export const VETERAN = 2
export const ROUTED = 4

export interface PUnit {
  gameId: number; team: number; kind: number; x: number; y: number
  hp: number; maxHp: number; attack: number; armor: number; speed: number; cooldown: number
  target: number; leader: number; parent: number
  buffs: { kind: number; ticksLeft: number }[]
  items: { gameId: number; kind: number; quality: number }[]
  flags: number; killCount: number; lastHitBy: number
  moraleSize0: number; moraleLost: number
  threat: { attacker: number; amount: number }[]
  chronicle: number[]
}
export interface PShrine { gameId: number; owner: number; progress: number }
export interface PProjectile { gameId: number; owner: number; target: number; x: number; y: number; age: number; speed: number; volley: number }
export interface PGround { gameId: number; kind: number; quality: number; x: number; y: number; age: number }
export interface Parsed {
  tick: number; alive: number[]; kills: number[]; damage: number[]; winner: number; score: number[]
  shrines: PShrine[]; units: PUnit[]; projectiles: PProjectile[]; ground: PGround[]
}

/** Reads the flat array exactly as SPEC §8 lays it out. Throws on a non-int32 value or when the length does not match. */
export const parse = (s: CanonicalState): Parsed => {
  for (const v of s) if (!Number.isInteger(v) || v < -(2 ** 31) || v >= 2 ** 31) throw new Error(`snapshot value ${v} is not an int32 integer`)
  let i = 0
  const next = () => s[i++]
  const tick = next()
  const alive = [next(), next()]
  const kills = [next(), next()]
  const damage = [next(), next()]
  const winner = next()
  const score = [next(), next()]
  const shrines: PShrine[] = []
  for (let n = next(); n > 0; n--) shrines.push({ gameId: next(), owner: next(), progress: next() })
  const units: PUnit[] = []
  for (let n = next(); n > 0; n--) {
    const u: PUnit = {
      gameId: next(), team: next(), kind: next(), x: next(), y: next(), hp: next(), maxHp: next(), attack: next(), armor: next(),
      speed: next(), cooldown: next(), target: next(), leader: next(), parent: next(), buffs: [], items: [],
      flags: 0, killCount: 0, lastHitBy: -1, moraleSize0: -1, moraleLost: -1, threat: [], chronicle: [],
    }
    for (let b = next(); b > 0; b--) u.buffs.push({ kind: next(), ticksLeft: next() })
    for (let c = next(); c > 0; c--) u.items.push({ gameId: next(), kind: next(), quality: next() })
    u.flags = next(); u.killCount = next(); u.lastHitBy = next()
    u.moraleSize0 = next(); u.moraleLost = next()
    for (let c = next(); c > 0; c--) u.threat.push({ attacker: next(), amount: next() })
    for (let c = next(); c > 0; c--) u.chronicle.push(next())
    units.push(u)
  }
  const projectiles: PProjectile[] = []
  for (let n = next(); n > 0; n--) projectiles.push({ gameId: next(), owner: next(), target: next(), x: next(), y: next(), age: next(), speed: next(), volley: next() })
  const ground: PGround[] = []
  for (let n = next(); n > 0; n--) ground.push({ gameId: next(), kind: next(), quality: next(), x: next(), y: next(), age: next() })
  if (i !== s.length) throw new Error(`snapshot has ${s.length} values, parser read ${i}`)
  return { tick, alive, kills, damage, winner, score, shrines, units, projectiles, ground }
}

/** One squad of one warband per team, no repeat waves, no surge. Override what a test needs. */
export const scenario = (o: Partial<Scenario> = {}): Scenario => ({
  ...SCENARIOS.skirmish, name: 'test', targetPop: 1, wavePeriod: 1_000_000, maxSquadsPerWave: 1,
  surgePeriod: 1_000_000, surgeBase: 1, surgeCap: 1, ticks: 1, ...o,
})
