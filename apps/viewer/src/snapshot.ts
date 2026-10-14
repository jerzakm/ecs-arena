export interface World {
  tick: number
  alive0: number
  alive1: number
  kills0: number
  kills1: number
  damage0: number
  damage1: number
  winner: number
  shrines0: number
  shrines1: number
}
export interface Shrine { gameId: number; owner: number; progress: number }
export interface Buff { kind: number; ticksLeft: number }
export interface Unit {
  gameId: number
  team: number
  kind: number
  x: number
  y: number
  hp: number
  maxHp: number
  cooldown: number
  flags: number
  buffs: Buff[]
}
export interface Projectile { gameId: number; x: number; y: number; volley: number }
export interface GroundItem { x: number; y: number }
export interface Snapshot {
  world: World
  shrines: Shrine[]
  units: Unit[]
  projectiles: Projectile[]
  groundItems: GroundItem[]
}

/** Parses the SPEC §8 int32 snapshot. Reads only what the renderer needs, skipping the rest. */
export const parseSnapshot = (s: ArrayLike<number>): Snapshot => {
  let i = 0
  const [tick, alive0, alive1, kills0, kills1, damage0, damage1, winner, shrines0, shrines1] = Array.from({ length: 10 }, () => s[i++])
  const world = { tick, alive0, alive1, kills0, kills1, damage0, damage1, winner, shrines0, shrines1 }
  i += 2 // orders0, orders1

  const shrines: Shrine[] = []
  for (let n = s[i++]; n > 0; n--, i += 4 + s[i + 3]) shrines.push({ gameId: s[i], owner: s[i + 1], progress: s[i + 2] }) // then the garrison list

  const units: Unit[] = []
  for (let n = s[i++]; n > 0; n--) {
    const [gameId, team, kind, x, y, hp, maxHp] = [s[i], s[i + 1], s[i + 2], s[i + 3], s[i + 4], s[i + 5], s[i + 6]]
    const cooldown = s[i + 10]
    i += 14
    const buffs: Buff[] = []
    for (let b = s[i++]; b > 0; b--, i += 2) buffs.push({ kind: s[i], ticksLeft: s[i + 1] })
    i += s[i] * 3 + 1 // items
    const flags = s[i]
    i += 5 // flags, killCount, lastHitBy, moraleSize0, moraleLost
    i += s[i] * 2 + 1 // threats
    i += s[i] + 1 // chronicle
    units.push({ gameId, team, kind, x, y, hp, maxHp, cooldown, flags, buffs })
  }

  const projectiles: Projectile[] = []
  for (let n = s[i++]; n > 0; n--, i += 8) projectiles.push({ gameId: s[i], x: s[i + 3], y: s[i + 4], volley: s[i + 7] })

  const groundItems: GroundItem[] = []
  for (let n = s[i++]; n > 0; n--, i += 6) groundItems.push({ x: s[i + 3], y: s[i + 4] })

  return { world, shrines, units, projectiles, groundItems }
}
