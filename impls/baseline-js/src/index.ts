// Plain-JS reference implementation of SPEC.md. One function per phase, steps in spec order.
// Relations are gameIds (-1 = none). Units, projectiles and ground items are plain objects in
// arrays that stay sorted by gameId. No ECS library.
import type { CanonicalState, CreateSim, Scenario } from '@ecs-arena/spec'

interface Item { gameId: number; kind: number; quality: number }
interface Unit {
  gameId: number; team: number; kind: number
  x: number; y: number
  hp: number; maxHp: number; attack: number; armor: number; speed: number; cooldown: number
  target: number // Targets
  leader: number // MemberOf, -1 for a leader or a unit with no squad
  offX: number; offY: number // MemberOf data
  parent: number // ChildOf
  items: Item[] // Equips, sorted by gameId
  buffs: [number, number, number] // ticksLeft by buff kind, 0 = absent
  lastSummon: number
  age: number
  // scratch, valid inside one phase
  sx: number; sy: number // start-of-phase position (move)
  dmgIn: number; healIn: number; stunIn: boolean; burnIn: boolean; hasteIn: boolean // combat intents
  destroyed: boolean
}
interface Projectile {
  gameId: number; owner: number; target: number; x: number; y: number; age: number
  ownerTeam: number; ownerKind: number; attack: number; crit: boolean; spent: boolean // fixed at fire time
}
interface GroundItem { gameId: number; kind: number; quality: number; x: number; y: number; age: number }

const CELL = 16 * 1024 // grid cell size, an implementation detail

const createSim: CreateSim = (scenario: Scenario, k) => {
  const { fx, distSq, stepToward, clampToArena, randInt, teamGameId, PURPOSE, KIND, BUFF, UNIT_STATS, ITEMS } = k
  const { seed } = scenario

  let units: Unit[] = []
  let projectiles: Projectile[] = []
  let groundItems: GroundItem[] = []
  const unitById = new Map<number, Unit>()
  let nextId = 1
  let tick = 0
  const world = { tick: -1, alive: [0, 0], kills: [0, 0], damage: [0, 0], winner: -1 }

  // ---- helpers ----

  const isStunned = (u: Unit) => u.buffs[BUFF.STUN] > 0

  // SPEC §4 Derived stats
  const recomputeStats = (u: Unit) => {
    const base = UNIT_STATS[u.kind]
    let attack = base.attack, armor = base.armor, speed = base.speed
    for (const it of u.items) {
      attack += ITEMS[it.kind].attack * it.quality
      armor += ITEMS[it.kind].armor * it.quality
      speed += ITEMS[it.kind].speed * it.quality
    }
    if (u.buffs[BUFF.HASTE] > 0) speed = fx.div(speed * 3, 2)
    u.attack = attack; u.armor = armor; u.speed = speed
  }

  // Creates a unit and, for non-minions, its items (SPEC §5.3), taking gameIds in the §5.4 order.
  const spawnUnit = (team: number, kind: number, x: number, y: number): Unit => {
    const gameId = nextId++
    const items: Item[] = []
    if (kind !== KIND.MINION) {
      const count = randInt(4, seed, tick, gameId, PURPOSE.ITEM_COUNT)
      for (let i = 0; i < count; i++) {
        items.push({
          gameId: nextId++,
          kind: randInt(8, seed, tick, gameId, PURPOSE.ITEM_KIND, i),
          quality: 1 + randInt(3, seed, tick, gameId, PURPOSE.ITEM_QUALITY, i),
        })
      }
    }
    const u: Unit = {
      gameId, team, kind, x: clampToArena(x), y: clampToArena(y),
      hp: UNIT_STATS[kind].maxHp, maxHp: UNIT_STATS[kind].maxHp, attack: 0, armor: 0, speed: 0, cooldown: 0,
      target: -1, leader: -1, offX: 0, offY: 0, parent: -1, items, buffs: [0, 0, 0],
      lastSummon: tick, age: 0, sx: 0, sy: 0, dmgIn: 0, healIn: 0, stunIn: false, burnIn: false, hasteIn: false, destroyed: false,
    }
    recomputeStats(u)
    units.push(u)
    unitById.set(gameId, u)
    return u
  }

  // Implementation-owned spatial index: units bucketed by position, rebuilt when a phase needs it.
  type Grid = Unit[][]
  const GRID_N = Math.ceil(k.ARENA / CELL)
  const cellOf = (v: number) => Math.min(GRID_N - 1, Math.max(0, Math.floor(v / CELL)))
  const buildGrid = (): Grid => {
    const grid: Grid = Array.from({ length: GRID_N * GRID_N }, () => [])
    for (const u of units) grid[cellOf(u.y) * GRID_N + cellOf(u.x)].push(u)
    return grid
  }
  // Calls fn for every unit in the cells that overlap the square of half-size r around (x, y).
  const forNear = (grid: Grid, x: number, y: number, r: number, fn: (u: Unit) => void) => {
    for (let cy = cellOf(y - r); cy <= cellOf(y + r); cy++)
      for (let cx = cellOf(x - r); cx <= cellOf(x + r); cx++)
        for (const u of grid[cy * GRID_N + cx]) fn(u)
  }

  // ---- 6.1 spawn ----

  const spawnSquad = (team: number, squadIndex: number) => {
    const squad = k.SQUADS[randInt(4, seed, tick, teamGameId(team), PURPOSE.SQUAD_KIND, squadIndex)]
    const facing = team === 0 ? 1 : -1
    const lx = k.SPAWN_X[team]
    const ly = k.SPAWN_Y_MIN + randInt(k.SPAWN_Y_RANGE, seed, tick, teamGameId(team), PURPOSE.SPAWN_Y, squadIndex) * k.FX
    const leader = spawnUnit(team, squad.leader, lx, ly)
    squad.members.forEach((kind, i) => {
      const col = (i % 3) - 1
      const row = 1 + Math.floor(i / 3)
      const offX = -facing * row * k.FORMATION_SPACING
      const offY = col * k.FORMATION_SPACING
      const m = spawnUnit(team, kind, lx + offX, ly + offY)
      m.leader = leader.gameId; m.offX = offX; m.offY = offY
    })
  }

  const spawn = () => {
    // Age every entity that has a lifetime. New entities of this tick start at 0.
    for (const u of units) u.age++
    for (const p of projectiles) p.age++
    for (const g of groundItems) g.age++

    // 5.1 Waves
    if (tick % scenario.wavePeriod === 0) {
      for (const team of [0, 1]) {
        let alive = units.filter((u) => u.team === team).length
        for (let squadIndex = 0; squadIndex < scenario.maxSquadsPerWave && alive < scenario.targetPop; squadIndex++) {
          const before = units.length
          spawnSquad(team, squadIndex)
          alive += units.length - before
        }
      }
    }

    // 5.4 step 3 Summons, in gameId order
    const minionCount = new Map<number, number>()
    for (const u of units) if (u.parent !== -1) minionCount.set(u.parent, (minionCount.get(u.parent) ?? 0) + 1)
    for (const s of units.filter((u) => u.kind === KIND.SUMMONER)) {
      if (tick - s.lastSummon < k.SUMMON_PERIOD || (minionCount.get(s.gameId) ?? 0) >= k.MAX_MINIONS) continue
      const m = spawnUnit(s.team, KIND.MINION, s.x, s.y)
      m.parent = s.gameId
      s.lastSummon = tick
      minionCount.set(s.gameId, (minionCount.get(s.gameId) ?? 0) + 1)
    }
  }

  // ---- 6.2 ai/target ----

  const aiTarget = () => {
    const grid = buildGrid()
    for (const u of units) {
      if (isStunned(u) || u.kind === KIND.SUMMONER) continue
      const stats = UNIT_STATS[u.kind]

      if (u.kind === KIND.HEALER) {
        // Lowest hp/maxHp among hurt allies in heal range. Ties go to the lowest gameId.
        let best: Unit | null = null
        forNear(grid, u.x, u.y, stats.range, (v) => {
          if (v.team !== u.team || v === u || v.hp >= v.maxHp) return
          if (distSq(u.x, u.y, v.x, v.y) > stats.range * stats.range) return
          if (!best) { best = v; return }
          const a = v.hp * best.maxHp, b = best.hp * v.maxHp
          if (a < b || (a === b && v.gameId < best.gameId)) best = v
        })
        u.target = best ? (best as Unit).gameId : -1
        continue
      }

      // Keep the current target while it is in sight.
      const cur = u.target === -1 ? undefined : unitById.get(u.target)
      if (cur && distSq(u.x, u.y, cur.x, cur.y) <= stats.sight * stats.sight) continue

      // Otherwise the nearest enemy in sight. Ties go to the lowest gameId.
      let best: Unit | null = null
      let bestD = 0
      forNear(grid, u.x, u.y, stats.sight, (v) => {
        if (v.team === u.team) return
        const d = distSq(u.x, u.y, v.x, v.y)
        if (d > stats.sight * stats.sight) return
        if (!best || d < bestD || (d === bestD && v.gameId < best.gameId)) { best = v; bestD = d }
      })
      u.target = best ? (best as Unit).gameId : -1
    }
  }

  // ---- 6.3 move ----

  const targetInRange = (u: Unit): boolean => {
    const t = u.target === -1 ? undefined : unitById.get(u.target)
    const r = UNIT_STATS[u.kind].range
    return !!t && distSq(u.x, u.y, t.sx, t.sy) <= r * r
  }

  const move = () => {
    for (const u of units) { u.sx = u.x; u.sy = u.y }

    // Hierarchy order, pass 1: leaders and units with no squad. They read start-of-phase positions.
    for (const u of units) {
      if (u.leader !== -1 || isStunned(u) || targetInRange(u)) continue
      const t = u.target === -1 ? undefined : unitById.get(u.target)
      let tx: number, ty: number
      if (t) { tx = t.sx; ty = t.sy }
      else if (u.kind === KIND.MINION) { const s = unitById.get(u.parent)!; tx = s.sx; ty = s.sy }
      else { tx = u.team === 0 ? k.MAX_COORD : 0; ty = u.y }
      ;[u.x, u.y] = stepToward(u.x, u.y, tx, ty, u.speed)
    }

    // Pass 2: members read the new leader position.
    for (const u of units) {
      if (u.leader === -1 || isStunned(u) || targetInRange(u)) continue
      const l = unitById.get(u.leader)!
      ;[u.x, u.y] = stepToward(u.x, u.y, l.x + u.offX, l.y + u.offY, u.speed)
    }

    // Pass 3: projectiles read the final position of their target.
    for (const p of projectiles) {
      const t = unitById.get(p.target)
      if (t) [p.x, p.y] = stepToward(p.x, p.y, t.x, t.y, k.PROJECTILE_SPEED)
    }
  }

  // ---- 6.4 combat ----

  const combat = () => {
    const grid = buildGrid()
    for (const u of units) { u.dmgIn = 0; u.healIn = 0; u.stunIn = false; u.burnIn = false; u.hasteIn = false }

    const addDamage = (victim: Unit, attack: number, crit: boolean, attackerTeam: number) => {
      const d = k.damage(attack, victim.armor, crit)
      victim.dmgIn += d
      world.damage[attackerTeam] += d // step 5
    }

    // 1. Hits
    for (const p of projectiles) {
      const t = unitById.get(p.target)
      if (!t || p.x !== t.x || p.y !== t.y) continue
      p.spent = true
      if (p.ownerKind === KIND.MAGE) {
        forNear(grid, p.x, p.y, k.SPLASH_RADIUS, (v) => {
          if (v.team === p.ownerTeam || distSq(p.x, p.y, v.x, v.y) > k.SPLASH_RADIUS * k.SPLASH_RADIUS) return
          addDamage(v, p.attack, p.crit, p.ownerTeam)
          v.burnIn = true
        })
      } else addDamage(t, p.attack, p.crit, p.ownerTeam)
    }

    // 2. Attacks. `units` is in gameId order, so projectile intents are already sorted by attacker.
    const shots: Unit[] = []
    for (const u of units) {
      if (isStunned(u) || u.cooldown !== 0 || u.kind === KIND.SUMMONER) continue
      const t = u.target === -1 ? undefined : unitById.get(u.target)
      const r = UNIT_STATS[u.kind].range
      if (!t || distSq(u.x, u.y, t.x, t.y) > r * r) continue
      if (u.kind === KIND.WARRIOR || u.kind === KIND.MINION) {
        const crit = k.isCrit(seed, tick, u.gameId)
        addDamage(t, u.attack, crit, u.team)
        if (crit && u.kind === KIND.WARRIOR) t.stunIn = true
      } else if (u.kind === KIND.ARCHER || u.kind === KIND.MAGE) {
        shots.push(u)
      } else { // healer
        t.healIn += u.attack
        t.hasteIn = true
      }
      u.cooldown = UNIT_STATS[u.kind].cooldown
    }
    for (const u of shots) {
      projectiles.push({
        gameId: nextId++, owner: u.gameId, target: u.target, x: u.x, y: u.y, age: 0,
        ownerTeam: u.team, ownerKind: u.kind, attack: u.attack, crit: k.isCrit(seed, tick, u.gameId), spent: false,
      })
    }

    // 3. Cooldowns
    for (const u of units) if (u.cooldown > 0) u.cooldown--

    // 4. Resolve. Buffs from this phase start now, a repeat resets ticksLeft.
    for (const u of units) {
      u.hp = Math.min(u.maxHp, u.hp - u.dmgIn + u.healIn)
      if (u.stunIn) u.buffs[BUFF.STUN] = k.BUFF_DURATION[BUFF.STUN]
      if (u.burnIn) u.buffs[BUFF.BURN] = k.BUFF_DURATION[BUFF.BURN]
      if (u.hasteIn) u.buffs[BUFF.HASTE] = k.BUFF_DURATION[BUFF.HASTE]
    } // Dead means hp <= 0. cleanup reads that.
  }

  // ---- 6.5 effects ----

  const effects = () => {
    for (const u of units) {
      for (let b = 0; b < 3; b++) {
        if (u.buffs[b] === 0) continue
        u.buffs[b]--
        if (b === BUFF.BURN && u.buffs[b] % k.BURN_INTERVAL === 0) u.hp -= k.BURN_DAMAGE
      }
    }
  }

  // ---- 6.6 cleanup ----

  const cleanup = () => {
    const destroy = (u: Unit) => { u.destroyed = true; unitById.delete(u.gameId) }

    // Dead units in gameId order. A minion that a cascade already destroyed is skipped.
    for (const u of units.filter((v) => v.hp <= 0)) {
      if (u.destroyed) continue
      // 1. Kill credit
      if (u.kind !== KIND.MINION) world.kills[1 - u.team]++
      // 2. First item drops, the rest are destroyed
      if (u.items.length > 0) {
        const it = u.items[0]
        groundItems.push({ gameId: it.gameId, kind: it.kind, quality: it.quality, x: u.x, y: u.y, age: 0 })
      }
      // 3. Minions die with the summoner
      for (const m of units) if (m.parent === u.gameId && !m.destroyed) destroy(m)
      // 4. Promote the lowest-gameId member of a leader
      if (u.leader === -1 && u.kind !== KIND.MINION) {
        const members = units.filter((m) => m.leader === u.gameId && !m.destroyed)
        if (members.length > 0) {
          const p = members[0]
          const { offX, offY } = p
          for (const m of members) { m.offX -= offX; m.offY -= offY; m.leader = p.gameId }
          p.leader = -1 // its own offset is now 0 - 0
        }
      }
      // 5. Destroy
      destroy(u)
    }

    // 6. Minions that are 300 ticks old
    for (const u of units) if (u.kind === KIND.MINION && u.age >= k.MINION_LIFETIME && !u.destroyed) destroy(u)

    // Remove every Targets relation to a destroyed unit.
    for (const u of units) if (u.target !== -1 && !unitById.has(u.target)) u.target = -1
    units = units.filter((u) => !u.destroyed)

    // 7. Projectiles that are Spent, have no target, or are 60 ticks old
    projectiles = projectiles.filter((p) => !p.spent && unitById.has(p.target) && p.age < k.PROJECTILE_LIFETIME)

    // 8. Pickup, in gameId order. Items taken here count toward the cap of later items.
    groundItems.sort((a, b) => a.gameId - b.gameId)
    const grid = buildGrid()
    groundItems = groundItems.filter((g) => {
      let best: Unit | null = null
      let bestD = 0
      forNear(grid, g.x, g.y, k.PICKUP_RANGE, (v) => {
        if (v.items.length >= k.MAX_ITEMS) return
        const d = distSq(g.x, g.y, v.x, v.y)
        if (d > k.PICKUP_RANGE * k.PICKUP_RANGE) return
        if (!best || d < bestD || (d === bestD && v.gameId < best.gameId)) { best = v; bestD = d }
      })
      if (!best) return true
      const taker = best as Unit
      taker.items.push({ gameId: g.gameId, kind: g.kind, quality: g.quality })
      taker.items.sort((a, b) => a.gameId - b.gameId)
      return false
    })

    // 9. Ground items that are 300 ticks old
    groundItems = groundItems.filter((g) => g.age < k.GROUND_ITEM_LIFETIME)
  }

  // ---- 6.7 stats ----

  const stats = () => {
    // Recomputing every unit gives the same result as recomputing only changed ones.
    for (const u of units) recomputeStats(u)
    world.alive = [0, 0]
    for (const u of units) world.alive[u.team]++
    if (tick > 0 && world.winner === -1) {
      if (world.alive[0] === 0 && world.alive[1] > 0) world.winner = 1
      else if (world.alive[1] === 0 && world.alive[0] > 0) world.winner = 0
    }
    world.tick = tick
    tick++
  }

  // ---- 8 snapshot ----

  const snapshot = (): CanonicalState => {
    const s: number[] = [
      world.tick, world.alive[0], world.alive[1], world.kills[0], world.kills[1], world.damage[0], world.damage[1], world.winner,
      units.length,
    ]
    for (const u of units) {
      s.push(u.gameId, u.team, u.kind, u.x, u.y, u.hp, u.maxHp, u.attack, u.armor, u.speed, u.cooldown, u.target, u.leader, u.parent)
      const active = [0, 1, 2].filter((b) => u.buffs[b] > 0)
      s.push(active.length)
      for (const b of active) s.push(b, u.buffs[b])
      s.push(u.items.length)
      for (const it of u.items) s.push(it.gameId, it.kind, it.quality)
    }
    s.push(projectiles.length)
    for (const p of projectiles) s.push(p.gameId, p.owner, p.target, p.x, p.y, p.age)
    s.push(groundItems.length)
    for (const g of groundItems) s.push(g.gameId, g.kind, g.quality, g.x, g.y, g.age)
    return s
  }

  return {
    phases: { spawn, 'ai/target': aiTarget, move, combat, effects, cleanup, stats },
    snapshot,
  }
}

export default createSim
