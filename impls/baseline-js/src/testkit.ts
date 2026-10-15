// Implementation-agnostic helpers: parse the SPEC §8 snapshot and build test scenarios.
import { SCENARIOS, type CanonicalState, type Scenario } from '@ecs-arena/spec'

export const FLEEING = 1
export const VETERAN = 2
export const ROUTED = 4
export const OVERWHELMED = 8
export const BANNERED = 16
export const GARRISONED = 32

export interface PUnit {
  gameId: number; team: number; kind: number; x: number; y: number
  hp: number; maxHp: number; attack: number; armor: number; speed: number; cooldown: number
  target: number; leader: number; parent: number
  buffs: { kind: number; ticksLeft: number }[]
  items: { gameId: number; kind: number; quality: number }[]
  flags: number; killCount: number; lastHitBy: number
  moraleSize0: number; moraleLost: number
  threat: { attacker: number; amount: number }[]
  /** The last CHRONICLE_TAIL entries. A veteran holds up to hundreds, and a whole fight of them does not fit in memory. */
  chronicle: number[]
  chronicleCount: number
}
export const CHRONICLE_TAIL = 8
export interface PShrine { gameId: number; owner: number; progress: number; garrison: number[] }
export interface PProjectile { gameId: number; owner: number; target: number; x: number; y: number; age: number; speed: number; volley: number }
export interface PGround { gameId: number; kind: number; quality: number; x: number; y: number; age: number }
export interface Parsed {
  tick: number; alive: number[]; kills: number[]; damage: number[]; winner: number; score: number[]; orders: number[]; renderChain: number
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
  const orders = [next(), next()]
  const renderChain = next()
  const shrines: PShrine[] = []
  for (let n = next(); n > 0; n--) {
    const sh: PShrine = { gameId: next(), owner: next(), progress: next(), garrison: [] }
    for (let c = next(); c > 0; c--) sh.garrison.push(next())
    shrines.push(sh)
  }
  const units: PUnit[] = []
  for (let n = next(); n > 0; n--) {
    const u: PUnit = {
      gameId: next(), team: next(), kind: next(), x: next(), y: next(), hp: next(), maxHp: next(), attack: next(), armor: next(),
      speed: next(), cooldown: next(), target: next(), leader: next(), parent: next(), buffs: [], items: [],
      flags: 0, killCount: 0, lastHitBy: -1, moraleSize0: -1, moraleLost: -1, threat: [], chronicle: [], chronicleCount: 0,
    }
    for (let b = next(); b > 0; b--) u.buffs.push({ kind: next(), ticksLeft: next() })
    for (let c = next(); c > 0; c--) u.items.push({ gameId: next(), kind: next(), quality: next() })
    u.flags = next(); u.killCount = next(); u.lastHitBy = next()
    u.moraleSize0 = next(); u.moraleLost = next()
    for (let c = next(); c > 0; c--) u.threat.push({ attacker: next(), amount: next() })
    u.chronicleCount = next()
    for (let c = 0; c < u.chronicleCount; c++) { const v = next(); if (c >= u.chronicleCount - CHRONICLE_TAIL) u.chronicle.push(v) }
    units.push(u)
  }
  const projectiles: PProjectile[] = []
  for (let n = next(); n > 0; n--) projectiles.push({ gameId: next(), owner: next(), target: next(), x: next(), y: next(), age: next(), speed: next(), volley: next() })
  const ground: PGround[] = []
  for (let n = next(); n > 0; n--) ground.push({ gameId: next(), kind: next(), quality: next(), x: next(), y: next(), age: next() })
  if (i !== s.length) throw new Error(`snapshot has ${s.length} values, parser read ${i}`)
  return { tick, alive, kills, damage, winner, score, orders, renderChain, shrines, units, projectiles, ground }
}

/** The skirmish of the first v3 sizing. The behaviour tests run it, so they stay fast and do not move when the load budget retunes `SCENARIOS`. */
export const SMALL: Scenario = { ...SCENARIOS.skirmish, targetPop: 170, maxSquadsPerWave: 15, surgeBase: 3, surgeCap: 260, garrisonCap: 8, ordersPerTeam: 8 }

/** One squad of one warband per team, no repeat waves, no surge. Override what a test needs. */
export const scenario = (o: Partial<Scenario> = {}): Scenario => ({
  ...SMALL, name: 'test', targetPop: 1, wavePeriod: 1_000_000, maxSquadsPerWave: 1,
  surgePeriod: 1_000_000, surgeBase: 1, surgeCap: 1, garrisonCap: 0, ordersPerTeam: 0, ticks: 1, ...o,
})
