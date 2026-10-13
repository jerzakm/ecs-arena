// Test helpers: run a scenario through the Sim API and parse the SPEC §8 snapshot.
import { PHASES, SCENARIOS, kernel, type CanonicalState, type Scenario } from '@ecs-arena/spec'
import createSim from './index.ts'

export interface PUnit {
  gameId: number; team: number; kind: number; x: number; y: number
  hp: number; maxHp: number; attack: number; armor: number; speed: number; cooldown: number
  target: number; leader: number; parent: number
  buffs: { kind: number; ticksLeft: number }[]
  items: { gameId: number; kind: number; quality: number }[]
}
export interface PProjectile { gameId: number; owner: number; target: number; x: number; y: number; age: number }
export interface PGround { gameId: number; kind: number; quality: number; x: number; y: number; age: number }
export interface Parsed {
  tick: number; alive: number[]; kills: number[]; damage: number[]; winner: number
  units: PUnit[]; projectiles: PProjectile[]; ground: PGround[]
}

/** Reads the flat array exactly as SPEC §8 lays it out. Throws when the length does not match. */
export const parse = (s: CanonicalState): Parsed => {
  let i = 0
  const next = () => s[i++]
  const tick = next()
  const alive = [next(), next()]
  const kills = [next(), next()]
  const damage = [next(), next()]
  const winner = next()
  const units: PUnit[] = []
  for (let n = next(); n > 0; n--) {
    const u: PUnit = {
      gameId: next(), team: next(), kind: next(), x: next(), y: next(), hp: next(), maxHp: next(), attack: next(), armor: next(),
      speed: next(), cooldown: next(), target: next(), leader: next(), parent: next(), buffs: [], items: [],
    }
    for (let b = next(); b > 0; b--) u.buffs.push({ kind: next(), ticksLeft: next() })
    for (let c = next(); c > 0; c--) u.items.push({ gameId: next(), kind: next(), quality: next() })
    units.push(u)
  }
  const projectiles: PProjectile[] = []
  for (let n = next(); n > 0; n--) projectiles.push({ gameId: next(), owner: next(), target: next(), x: next(), y: next(), age: next() })
  const ground: PGround[] = []
  for (let n = next(); n > 0; n--) ground.push({ gameId: next(), kind: next(), quality: next(), x: next(), y: next(), age: next() })
  if (i !== s.length) throw new Error(`snapshot has ${s.length} values, parser read ${i}`)
  return { tick, alive, kills, damage, winner, units, projectiles, ground }
}

export const scenario = (o: Partial<Scenario> = {}): Scenario => ({
  ...SCENARIOS.skirmish, name: 'test', targetPop: 1, wavePeriod: 1_000_000, maxSquadsPerWave: 1, ticks: 1, ...o,
})

/** Runs `sc.ticks` ticks and returns the parsed snapshot after each one. */
export const run = (sc: Scenario): Parsed[] => {
  const sim = createSim(sc, kernel)
  const out: Parsed[] = []
  for (let t = 0; t < sc.ticks; t++) {
    for (const p of PHASES) sim.phases[p]()
    out.push(parse(sim.snapshot()))
  }
  return out
}
