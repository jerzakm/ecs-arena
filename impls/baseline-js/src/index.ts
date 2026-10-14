// Plain-JS reference implementation of SPEC.md. One function per phase, in spec order.
// Relations are gameIds (-1 = none). Units, projectiles and ground items are plain objects in
// arrays that stay sorted by gameId. No ECS library.
import type { CanonicalState, CreateSim, Scenario } from '@ecs-arena/spec'

interface Item { gameId: number; kind: number; quality: number }
interface Edge { attacker: number; amount: number }
interface Morale { size0: number; lost: number }
interface Unit {
  gameId: number; team: number; kind: number
  x: number; y: number
  hp: number; maxHp: number; attack: number; armor: number; speed: number; cooldown: number
  target: number
  memberOf: number
  offX: number; offY: number
  childOf: number
  items: Item[]
  buffs: [number, number, number] // ticksLeft by buff kind, 0 = absent
  threat: Edge[] // victim side of Threat, ascending attacker gameId
  morale: Morale | null
  fleeing: boolean; routed: boolean; veteran: boolean
  killCount: number
  lastHitBy: number
  chronicle: number[]
  lastSummon: number
  age: number
  // scratch, valid inside one phase or between two adjacent phases
  sx: number; sy: number
  dmgIn: number; healIn: number; stunIn: boolean; burnIn: boolean; hasteIn: boolean
  dead: boolean; destroyed: boolean
}
interface Projectile {
  gameId: number; owner: number; target: number; x: number; y: number; age: number; speed: number; volley: boolean
  ownerTeam: number; ownerKind: number; attack: number; crit: boolean; spent: boolean // fixed at fire time
}
interface GroundItem { gameId: number; kind: number; quality: number; x: number; y: number; age: number }
interface Shrine { gameId: number; y: number; owner: number; progress: number }
interface DamageIntent { victim: Unit; attacker: number; team: number; value: number }

/** Optional work-count hooks (runner/src/profile.ts). `add` accumulates, `set` records a per-tick gauge. Never read back. */
export interface Counters {
  add(name: string, n?: number): void
  set(name: string, v: number): void
}

const CELL = 16 * 1024 // grid cell size, an implementation detail

const byGameId = (a: { gameId: number }, b: { gameId: number }) => a.gameId - b.gameId

const createSim = (scenario: Scenario, k: Parameters<CreateSim>[1], counters?: Counters): ReturnType<CreateSim> => {
  const { fx, distSq, stepToward, clampToArena, randInt, teamGameId, PURPOSE, KIND, BUFF, UNIT_STATS, ITEMS } = k
  const { seed } = scenario

  let units: Unit[] = []
  let projectiles: Projectile[] = []
  let groundItems: GroundItem[] = []
  const shrines: Shrine[] = []
  const unitById = new Map<number, Unit>()
  let nextId = 1
  let tick = 0
  const world = { tick: -1, alive: [0, 0], kills: [0, 0], damage: [0, 0], winner: -1, score: [0, 0] }

  const dirty: Set<number> | null = counters ? new Set<number>() : null // units whose derived-stat inputs changed this tick, only filled when counting
  const add = (name: string, n = 1) => counters?.add(name, n)
  const kindName = (kind: number) => (kind === KIND.MINION ? 'minion' : kind === KIND.WARLORD ? 'warlord' : 'unit')

  const isStunned = (u: Unit) => u.buffs[BUFF.STUN] > 0
  const isThinkTick = (u: Unit) => (u.gameId + tick) % k.THINK_INTERVAL === 0
  const homeX = (team: number) => (team === 0 ? 0 : k.MAX_COORD)
  const farX = (team: number) => (team === 0 ? k.MAX_COORD : 0)
  const inRange = (ax: number, ay: number, bx: number, by: number, r: number) => distSq(ax, ay, bx, by) <= r * r
  const targetOf = (u: Unit) => (u.target === -1 ? undefined : unitById.get(u.target))
  const parentOf = (u: Unit) => unitById.get(u.memberOf !== -1 ? u.memberOf : u.childOf)
  const depthOf = (u: Unit) => {
    let d = 0
    for (let p = parentOf(u); p; p = parentOf(p)) d++
    return d
  }

  const sampleEntities = () => {
    if (!counters) return
    let equipped = 0, minions = 0, warlords = 0
    for (const u of units) {
      equipped += u.items.length
      if (u.kind === KIND.MINION) minions++
      else if (u.kind === KIND.WARLORD) warlords++
    }
    counters.set('alive.unit', units.length - minions - warlords)
    counters.set('alive.warlord', warlords)
    counters.set('alive.minion', minions)
    counters.set('alive.projectile', projectiles.length)
    counters.set('alive.groundItem', groundItems.length)
    counters.set('alive.equippedItem', equipped)
    counters.set('alive.shrine', shrines.length)
    counters.set('alive.total', units.length + projectiles.length + groundItems.length + equipped + shrines.length)
  }

  const recomputeStats = (u: Unit) => {
    const base = UNIT_STATS[u.kind]
    let attack = base.attack, armor = base.armor, speed = base.speed
    for (const it of u.items) {
      attack += ITEMS[it.kind].attack * it.quality
      armor += ITEMS[it.kind].armor * it.quality
      speed += ITEMS[it.kind].speed * it.quality
    }
    if (u.veteran) attack += k.VETERAN_ATTACK_STEP * Math.min(k.VETERAN_MAX_STEPS, fx.div(u.killCount, k.VETERAN_KILLS))
    if (u.buffs[BUFF.HASTE] > 0) speed = fx.div(speed * 3, 2)
    u.attack = attack; u.armor = armor; u.speed = speed
  }

  const spawnUnit = (team: number, kind: number, x: number, y: number): Unit => {
    const gameId = nextId++
    const items: Item[] = []
    if (kind !== KIND.MINION) {
      const count = randInt(4, seed, tick, gameId, PURPOSE.ITEM_COUNT)
      for (let i = 0; i < count; i++) {
        add('create.equippedItem'); add('rel.Equips.add')
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
      target: -1, memberOf: -1, offX: 0, offY: 0, childOf: -1, items, buffs: [0, 0, 0], threat: [],
      morale: null, fleeing: false, routed: false, veteran: false, killCount: 0, lastHitBy: -1, chronicle: [],
      lastSummon: tick, age: 0, sx: 0, sy: 0, dmgIn: 0, healIn: 0, stunIn: false, burnIn: false, hasteIn: false,
      dead: false, destroyed: false,
    }
    recomputeStats(u)
    add(`create.${kindName(kind)}`)
    dirty?.add(gameId)
    units.push(u)
    unitById.set(gameId, u)
    return u
  }

  const memberIndex = (): Map<number, Unit[]> => {
    const index = new Map<number, Unit[]>()
    for (const u of units) if (u.memberOf !== -1) {
      const list = index.get(u.memberOf)
      if (list) list.push(u)
      else index.set(u.memberOf, [u])
    }
    return index
  }

  // Implementation-owned spatial index: units bucketed by position, rebuilt when a phase needs it.
  type Grid = Unit[][]
  const GRID_N = Math.ceil(k.ARENA / CELL)
  const cellOf = (v: number) => Math.min(GRID_N - 1, Math.max(0, Math.floor(v / CELL)))
  const buildGrid = (): Grid => {
    add('grid.build'); add('grid.inserted', units.length)
    const grid: Grid = Array.from({ length: GRID_N * GRID_N }, () => [])
    for (const u of units) grid[cellOf(u.y) * GRID_N + cellOf(u.x)].push(u)
    return grid
  }
  // Calls fn for every unit in the cells that overlap the square of half-size r around (x, y).
  const forNear = (grid: Grid, x: number, y: number, r: number, fn: (u: Unit) => void, q: string) => {
    let scanned = 0
    for (let cy = cellOf(y - r); cy <= cellOf(y + r); cy++)
      for (let cx = cellOf(x - r); cx <= cellOf(x + r); cx++)
        for (const u of grid[cy * GRID_N + cx]) { scanned++; fn(u) }
    if (counters) { add(`query.${q}`); add(`query.${q}.scanned`, scanned) }
  }

  const spawnWarlord = (team: number, warband: number, yPurpose: number): Unit => {
    const facing = team === 0 ? 1 : -1
    const y = k.SPAWN_Y_MIN + randInt(k.SPAWN_Y_RANGE, seed, tick, teamGameId(team), yPurpose, warband) * k.FX
    return spawnUnit(team, KIND.WARLORD, k.SPAWN_X[team] + facing * k.WARLORD_SPAWN_GAP, y)
  }

  const spawnSquad = (team: number, squadIndex: number, place: number, warlord: Unit, kindPurpose: number) => {
    const squad = k.SQUADS[randInt(4, seed, tick, teamGameId(team), kindPurpose, squadIndex)]
    const facing = team === 0 ? 1 : -1
    const lOffX = -facing * k.LEADER_SLOT_SPACING
    const lOffY = (2 * place - 3) * k.LEADER_SLOT_SPACING
    const leader = spawnUnit(team, squad.leader, warlord.x + lOffX, warlord.y + lOffY)
    leader.memberOf = warlord.gameId; leader.offX = lOffX; leader.offY = lOffY
    leader.morale = { size0: 1 + squad.members.length, lost: 0 }
    add('rel.MemberOf.add')
    squad.members.forEach((kind, i) => {
      const offX = -facing * (1 + fx.div(i, 3)) * k.FORMATION_SPACING
      const offY = ((i % 3) - 1) * k.FORMATION_SPACING
      const m = spawnUnit(team, kind, leader.x + offX, leader.y + offY)
      m.memberOf = leader.gameId; m.offX = offX; m.offY = offY
      add('rel.MemberOf.add')
    })
  }

  const spawnSquads = (team: number, maxSquads: number, popCap: number, kindPurpose: number, yPurpose: number) => {
    let alive = units.filter((u) => u.team === team).length
    let warlord: Unit | undefined
    for (let s = 0; s < maxSquads && alive < popCap; s++) {
      const before = units.length
      const place = s % k.SQUADS_PER_WARBAND
      if (place === 0) warlord = spawnWarlord(team, fx.div(s, k.SQUADS_PER_WARBAND), yPurpose)
      spawnSquad(team, s, place, warlord!, kindPurpose)
      alive += units.length - before
    }
  }

  const spawnShrines = () => {
    for (let i = 0; i < k.SHRINE_COUNT; i++) {
      shrines.push({ gameId: nextId++, y: k.shrineY(i), owner: -1, progress: 0 })
      add('create.shrine')
    }
  }

  const spawn = () => {
    for (const u of units) if (u.kind === KIND.MINION) u.age++
    for (const p of projectiles) p.age++
    for (const g of groundItems) g.age++

    if (tick === 0) spawnShrines()

    if (tick % scenario.wavePeriod === 0) {
      for (const team of [0, 1]) spawnSquads(team, scenario.maxSquadsPerWave, scenario.targetPop, PURPOSE.SQUAD_KIND, PURPOSE.SPAWN_Y)
    }

    if (tick > 0 && tick % scenario.surgePeriod === 0) {
      for (const team of [0, 1]) {
        const lead = world.score[team] - world.score[1 - team]
        if (lead <= 0) continue
        const before = units.length
        spawnSquads(team, scenario.surgeBase * lead, scenario.surgeCap, PURPOSE.SURGE_KIND, PURPOSE.SURGE_Y)
        add('surge.unit', units.length - before)
      }
    }

    const minionCount = new Map<number, number>()
    for (const u of units) if (u.childOf !== -1) minionCount.set(u.childOf, (minionCount.get(u.childOf) ?? 0) + 1)
    const summoners = units.filter((u) => u.kind === KIND.SUMMONER)
    add('q.spawn.summoners', summoners.length)
    for (const s of summoners) {
      if (tick - s.lastSummon < k.SUMMON_PERIOD || (minionCount.get(s.gameId) ?? 0) >= k.MAX_MINIONS) continue
      const m = spawnUnit(s.team, KIND.MINION, s.x, s.y)
      m.childOf = s.gameId
      add('rel.ChildOf.add')
      s.lastSummon = tick
      minionCount.set(s.gameId, (minionCount.get(s.gameId) ?? 0) + 1)
    }
    sampleEntities()
  }

  const aiTarget = () => {
    const grid = buildGrid()
    const setTarget = (u: Unit, t: number) => {
      if (u.target !== t) {
        add(u.target === -1 ? 'rel.Targets.add' : t === -1 ? 'rel.Targets.remove' : 'rel.Targets.retarget')
        u.target = t
      }
    }
    const validTarget = (u: Unit, v: Unit) =>
      v.team !== u.team && !v.fleeing && inRange(u.x, u.y, v.x, v.y, UNIT_STATS[u.kind].sight)

    const healTarget = (u: Unit): number => {
      const range = UNIT_STATS[u.kind].range
      const cur = targetOf(u)
      if (cur && cur.hp < cur.maxHp && inRange(u.x, u.y, cur.x, cur.y, range)) return cur.gameId
      if (!isThinkTick(u)) return -1
      let best: Unit | null = null
      forNear(grid, u.x, u.y, range, (v) => {
        if (v.team !== u.team || v === u || v.hp >= v.maxHp || !inRange(u.x, u.y, v.x, v.y, range)) return
        if (!best) { best = v; return }
        const a = v.hp * best.maxHp, b = best.hp * v.maxHp
        if (a < b || (a === b && v.gameId < best.gameId)) best = v
      }, 'heal')
      return best ? (best as Unit).gameId : -1
    }

    const retaliationTarget = (u: Unit): number => {
      let best = -1, bestAmount = 0
      for (const e of u.threat) {
        if (e.amount < k.THREAT_RETALIATE) continue
        const a = unitById.get(e.attacker)
        if (!a || !validTarget(u, a)) continue
        if (best === -1 || e.amount > bestAmount || (e.amount === bestAmount && a.gameId < best)) { best = a.gameId; bestAmount = e.amount }
      }
      return best
    }

    const enemyTarget = (u: Unit): number => {
      const retaliate = retaliationTarget(u)
      if (retaliate !== -1) { add('q.ai.retaliate'); return retaliate }
      const cur = targetOf(u)
      if (cur && validTarget(u, cur)) { add('q.ai.kept'); return cur.gameId }
      if (!isThinkTick(u)) { add('q.ai.thinkSkipped'); return -1 }
      let best: Unit | null = null
      let bestD = 0
      forNear(grid, u.x, u.y, UNIT_STATS[u.kind].sight, (v) => {
        if (!validTarget(u, v)) return
        const d = distSq(u.x, u.y, v.x, v.y)
        if (!best || d < bestD || (d === bestD && v.gameId < best.gameId)) { best = v; bestD = d }
      }, 'target')
      return best ? (best as Unit).gameId : -1
    }

    for (const u of units) {
      if (isStunned(u)) continue
      add('q.ai.evaluated')
      if (u.fleeing || u.kind === KIND.SUMMONER) setTarget(u, -1)
      else if (u.kind === KIND.HEALER) setTarget(u, healTarget(u))
      else setTarget(u, enemyTarget(u))
    }
  }

  // Where the unit steps this tick, or null when it stays. Targets are read at their start-of-phase position.
  const moveGoal = (u: Unit): [number, number] | null => {
    if (isStunned(u)) return null
    if (u.fleeing) return [homeX(u.team), u.y]
    const t = targetOf(u)
    if (t && inRange(u.x, u.y, t.sx, t.sy, UNIT_STATS[u.kind].range)) return null
    if (u.memberOf !== -1) { const p = unitById.get(u.memberOf)!; return [p.x + u.offX, p.y + u.offY] }
    if (t) return [t.sx, t.sy]
    if (u.kind === KIND.MINION) { const s = unitById.get(u.childOf)!; return [s.x, s.y] }
    return [farX(u.team), u.y]
  }

  const move = () => {
    const byDepth: Unit[][] = []
    for (const u of units) {
      u.sx = u.x; u.sy = u.y
      const d = depthOf(u)
      ;(byDepth[d] ??= []).push(u)
    }
    // Hierarchy order: a parent moves before its children, so children read the new parent position.
    for (const level of byDepth) for (const u of level) {
      const goal = moveGoal(u)
      if (!goal) continue
      add('q.move.units')
      ;[u.x, u.y] = stepToward(u.x, u.y, goal[0], goal[1], u.speed)
    }
    add('q.move.projectiles', projectiles.length)
    for (const p of projectiles) {
      const t = unitById.get(p.target)!
      ;[p.x, p.y] = stepToward(p.x, p.y, t.x, t.y, p.speed)
    }
  }

  const BUFF_NAME = ['stun', 'burn', 'haste']
  const applyBuff = (u: Unit, b: number) => {
    if (counters) {
      if (u.buffs[b] > 0) add(`buff.refresh.${BUFF_NAME[b]}`)
      else { add(`buff.add.${BUFF_NAME[b]}`); dirty?.add(u.gameId) }
    }
    u.buffs[b] = k.BUFF_DURATION[b]
  }

  const addThreat = (victim: Unit, attacker: number, amount: number) => {
    const i = victim.threat.findIndex((e) => e.attacker >= attacker)
    if (i !== -1 && victim.threat[i].attacker === attacker) {
      victim.threat[i].amount = Math.min(k.THREAT_CLAMP, victim.threat[i].amount + amount)
      add('rel.Threat.accumulate')
    } else {
      victim.threat.splice(i === -1 ? victim.threat.length : i, 0, { attacker, amount: Math.min(k.THREAT_CLAMP, amount) })
      add('rel.Threat.add')
    }
  }

  const evictThreat = (victim: Unit) => {
    while (victim.threat.length > k.THREAT_MAX_EDGES) {
      let worst = 0
      victim.threat.forEach((e, i) => {
        const w = victim.threat[worst]
        if (e.amount < w.amount || (e.amount === w.amount && e.attacker > w.attacker)) worst = i
      })
      victim.threat.splice(worst, 1)
      add('rel.Threat.evict')
    }
  }

  const combat = () => {
    const grid = buildGrid()
    const intents: DamageIntent[] = []
    for (const u of units) { u.dmgIn = 0; u.healIn = 0; u.stunIn = false; u.burnIn = false; u.hasteIn = false }

    const addDamage = (victim: Unit, attacker: number, team: number, value: number) => {
      victim.dmgIn += value
      intents.push({ victim, attacker, team, value })
    }

    add('q.combat.projectiles', projectiles.length)
    for (const p of projectiles) {
      const t = unitById.get(p.target)
      if (!t || p.x !== t.x || p.y !== t.y) continue
      p.spent = true
      add('q.combat.hits')
      if (p.ownerKind === KIND.MAGE) {
        forNear(grid, p.x, p.y, k.SPLASH_RADIUS, (v) => {
          if (v.team === p.ownerTeam || !inRange(p.x, p.y, v.x, v.y, k.SPLASH_RADIUS)) return
          addDamage(v, p.owner, p.ownerTeam, k.damage(p.attack, v.armor, p.crit))
          v.burnIn = true
        }, 'splash')
      } else if (p.volley) addDamage(t, p.owner, p.ownerTeam, k.volleyDamage(p.attack, t.armor, p.crit))
      else addDamage(t, p.owner, p.ownerTeam, k.damage(p.attack, t.armor, p.crit))
    }

    const fire = (u: Unit, speed: number, crit: boolean, volley: boolean) => {
      add('create.projectile')
      projectiles.push({
        gameId: nextId++, owner: u.gameId, target: u.target, x: u.x, y: u.y, age: 0, speed, volley,
        ownerTeam: u.team, ownerKind: u.kind, attack: u.attack, crit, spent: false,
      })
    }
    for (const u of units) {
      if (isStunned(u) || u.fleeing || u.cooldown !== 0 || u.kind === KIND.SUMMONER) continue
      const t = targetOf(u)
      if (!t || !inRange(u.x, u.y, t.x, t.y, UNIT_STATS[u.kind].range)) continue
      const crit = k.isCrit(seed, tick, u.gameId)
      if (u.kind === KIND.WARRIOR || u.kind === KIND.MINION || u.kind === KIND.WARLORD) {
        addDamage(t, u.gameId, u.team, k.damage(u.attack, t.armor, crit))
        if (crit && u.kind !== KIND.MINION) t.stunIn = true
      } else if (u.kind === KIND.MAGE) {
        fire(u, k.PROJECTILE_SPEED, crit, false)
      } else if (u.kind === KIND.ARCHER) {
        for (let j = 0; j < k.VOLLEY_SIZE; j++) fire(u, k.PROJECTILE_SPEED - k.VOLLEY_SPEED_STEP * j, crit, true)
      } else {
        t.healIn += u.attack
        t.hasteIn = true
      }
      u.cooldown = UNIT_STATS[u.kind].cooldown
      add('q.combat.attackers')
    }

    for (const u of units) if (u.cooldown > 0) u.cooldown--

    // Resolve. Buffs from this phase start now, a repeat resets ticksLeft.
    for (const u of units) {
      u.hp = Math.min(u.maxHp, u.hp - u.dmgIn + u.healIn)
      if (u.hp <= 0) u.dead = true
      if (u.stunIn) applyBuff(u, BUFF.STUN)
      if (u.burnIn) applyBuff(u, BUFF.BURN)
      if (u.hasteIn) applyBuff(u, BUFF.HASTE)
    }

    intents.sort((a, b) => a.victim.gameId - b.victim.gameId || a.attacker - b.attacker)
    for (let i = 0; i < intents.length;) {
      const victim = intents[i].victim
      const sums: Edge[] = []
      for (; i < intents.length && intents[i].victim === victim; i++) {
        const { attacker, value } = intents[i]
        if (!unitById.has(attacker)) continue
        const last = sums[sums.length - 1]
        if (last && last.attacker === attacker) last.amount += value
        else sums.push({ attacker, amount: value })
      }
      let best: Edge | undefined
      for (const s of sums) if (!best || s.amount > best.amount) best = s
      if (best) victim.lastHitBy = best.attacker
      if (victim.fleeing) continue
      for (const s of sums) addThreat(victim, s.attacker, s.amount)
      evictThreat(victim)
    }

    for (const d of intents) world.damage[d.team] = (world.damage[d.team] + d.value) | 0
    sampleEntities()
  }

  const effects = () => {
    for (const u of units) {
      if (counters && (u.buffs[0] > 0 || u.buffs[1] > 0 || u.buffs[2] > 0)) add('q.effects.buffed')
      for (let b = 0; b < 3; b++) {
        if (u.buffs[b] === 0) continue
        u.buffs[b]--
        if (u.buffs[b] === 0) { add(`buff.remove.${BUFF_NAME[b]}`); dirty?.add(u.gameId) }
        if (b === BUFF.BURN && u.buffs[b] % k.BURN_INTERVAL === 0) u.hp -= k.BURN_DAMAGE
      }
      if (u.hp <= 0) u.dead = true
    }
    if (tick % k.THREAT_DECAY_PERIOD === 0) {
      for (const u of units) {
        if (u.threat.length === 0) continue
        for (const e of u.threat) e.amount -= Math.max(1, fx.div(e.amount, 4))
        add('rel.Threat.decay', u.threat.length)
        const kept = u.threat.filter((e) => e.amount > 0)
        add('rel.Threat.decayRemove', u.threat.length - kept.length)
        u.threat = kept
      }
    }
  }

  const morale = () => {
    const members = memberIndex()
    const dead = units.filter((u) => u.dead)
    for (const d of dead) {
      if (d.morale) d.morale.lost += 1
      else {
        const parent = d.memberOf === -1 ? undefined : unitById.get(d.memberOf)
        if (parent?.morale) parent.morale.lost += 1
      }
      for (const m of members.get(d.gameId) ?? []) if (m.morale) m.morale.lost += k.WARLORD_LOSS
    }

    const [num, den] = k.ROUT_LOST_PER_SIZE
    const newlyRouted = units.filter((u) => u.morale && !u.routed && u.morale.lost * den >= u.morale.size0 * num)
    const newlyFleeing: Unit[] = []
    const flee = (u: Unit) => {
      if (u.dead || u.fleeing) return
      u.fleeing = true
      newlyFleeing.push(u)
      add('tag.add.fleeing')
    }
    for (const leader of newlyRouted) {
      leader.routed = true
      add('tag.add.routed')
      flee(leader)
      for (const m of members.get(leader.gameId) ?? []) if (!m.morale) flee(m)
    }

    for (const u of newlyFleeing) {
      if (u.target !== -1) { u.target = -1; add('rel.Targets.remove') }
      add('rel.Threat.dropOnFlee', u.threat.length)
      u.threat = []
      if (u.morale && u.memberOf !== -1) { u.memberOf = -1; u.offX = 0; u.offY = 0; add('rel.MemberOf.remove') }
    }
  }

  const cleanup = () => {
    const destroy = (u: Unit) => {
      if (counters) {
        add(`destroy.${kindName(u.kind)}`)
        if (u.target !== -1) add('rel.Targets.destroyDrop')
        if (u.memberOf !== -1) add('rel.MemberOf.destroyDrop')
        if (u.childOf !== -1) add('rel.ChildOf.destroyDrop')
        if (u.threat.length) add('rel.Threat.destroyDrop', u.threat.length)
        const rest = u.dead ? Math.max(0, u.items.length - 1) : u.items.length
        if (rest > 0) { add('destroy.equippedItem', rest); add('rel.Equips.destroyDrop', rest) }
      }
      u.destroyed = true
    }

    const members = memberIndex()
    const minions = new Map<number, Unit[]>()
    for (const u of units) if (u.childOf !== -1) minions.set(u.childOf, [...(minions.get(u.childOf) ?? []), u])

    const promote = (old: Unit) => {
      const live = (members.get(old.gameId) ?? []).filter((m) => !m.destroyed)
      members.delete(old.gameId)
      if (live.length === 0) return
      const [head, ...rest] = live
      const { offX, offY } = head
      const siblings = (members.get(old.memberOf) ?? []).filter((m) => m !== old)
      if (old.memberOf !== -1 && !head.fleeing) {
        members.set(old.memberOf, siblings.concat(head).sort(byGameId))
        head.memberOf = old.memberOf; head.offX = old.offX; head.offY = old.offY
      } else {
        if (old.memberOf !== -1) members.set(old.memberOf, siblings)
        head.memberOf = -1; head.offX = 0; head.offY = 0
      }
      if (!head.morale && old.morale) { head.morale = { ...old.morale }; head.routed = old.routed }
      for (const m of rest) { m.memberOf = head.gameId; m.offX -= offX; m.offY -= offY }
      members.set(head.gameId, [...(members.get(head.gameId) ?? []), ...rest].sort(byGameId))
      add('promote'); add('rel.MemberOf.remove'); add('rel.MemberOf.retarget', rest.length)
    }

    // A leaving unit is fleeing, alive, and on its home edge.
    const departing = units.filter((u) => u.dead || (u.fleeing && u.x === homeX(u.team)))
    add('q.cleanup.dead', departing.length)
    for (const u of departing) {
      if (u.destroyed) continue
      if (u.dead) {
        if (u.kind !== KIND.MINION) world.kills[1 - u.team]++
        const killer = unitById.get(u.lastHitBy)
        if (killer) {
          killer.killCount++
          dirty?.add(killer.gameId)
          if (killer.veteran) {
            killer.chronicle.push(u.kind)
            if (killer.chronicle.length > k.CHRONICLE_MAX) killer.chronicle.shift()
          }
        }
        if (u.items.length > 0) {
          const it = u.items[0]
          groundItems.push({ gameId: it.gameId, kind: it.kind, quality: it.quality, x: u.x, y: u.y, age: 0 })
          add('item.drop'); add('rel.Equips.remove')
        }
      } else add('leave')
      for (const m of minions.get(u.gameId) ?? []) if (!m.destroyed) destroy(m)
      promote(u)
      destroy(u)
    }

    for (const u of units) if (u.kind === KIND.MINION && u.age >= k.MINION_LIFETIME && !u.destroyed) destroy(u)

    for (const u of units) if (u.destroyed) unitById.delete(u.gameId)
    units = units.filter((u) => !u.destroyed)
    for (const u of units) {
      if (u.target !== -1 && !unitById.has(u.target)) { u.target = -1; add('rel.Targets.remove') }
      if (u.threat.length > 0) {
        const kept = u.threat.filter((e) => unitById.has(e.attacker))
        add('rel.Threat.remove', u.threat.length - kept.length)
        u.threat = kept
      }
    }

    const projBefore = projectiles.length
    projectiles = projectiles.filter((p) => !p.spent && unitById.has(p.target) && p.age < k.PROJECTILE_LIFETIME)
    add('destroy.projectile', projBefore - projectiles.length)

    // Pickup, in gameId order. Items taken here count toward the cap of later items.
    add('q.cleanup.groundItems', groundItems.length)
    if (groundItems.length > 0) {
      groundItems.sort(byGameId)
      const grid = buildGrid()
      groundItems = groundItems.filter((g) => {
        let best: Unit | null = null
        let bestD = 0
        forNear(grid, g.x, g.y, k.PICKUP_RANGE, (v) => {
          if (v.items.length >= k.MAX_ITEMS || !inRange(g.x, g.y, v.x, v.y, k.PICKUP_RANGE)) return
          const d = distSq(g.x, g.y, v.x, v.y)
          if (!best || d < bestD || (d === bestD && v.gameId < best.gameId)) { best = v; bestD = d }
        }, 'pickup')
        if (!best) return true
        const taker = best as Unit
        add('item.pickup'); add('rel.Equips.add'); dirty?.add(taker.gameId)
        taker.items.push({ gameId: g.gameId, kind: g.kind, quality: g.quality })
        taker.items.sort(byGameId)
        return false
      })
    }

    const gBefore = groundItems.length
    groundItems = groundItems.filter((g) => g.age < k.GROUND_ITEM_LIFETIME)
    add('destroy.groundItem', gBefore - groundItems.length)
  }

  const objectives = () => {
    const grid = buildGrid()
    for (const s of shrines) {
      const count = [0, 0]
      forNear(grid, k.SHRINE_X, s.y, k.SHRINE_RADIUS, (u) => {
        if (!u.fleeing && inRange(k.SHRINE_X, s.y, u.x, u.y, k.SHRINE_RADIUS)) count[u.team]++
      }, 'shrine')
      const step = Math.max(-k.SHRINE_STEP_MAX, Math.min(k.SHRINE_STEP_MAX, count[0] - count[1]))
      s.progress = Math.max(-k.SHRINE_PROGRESS_MAX, Math.min(k.SHRINE_PROGRESS_MAX, s.progress + step))
      const was = s.owner
      if (s.progress === k.SHRINE_PROGRESS_MAX) s.owner = 0
      else if (s.progress === -k.SHRINE_PROGRESS_MAX) s.owner = 1
      if (s.owner !== was) add('shrine.capture')
    }
    world.score = [shrines.filter((s) => s.owner === 0).length, shrines.filter((s) => s.owner === 1).length]
  }

  const stats = () => {
    for (const u of units) {
      if (u.killCount >= k.VETERAN_KILLS && !u.veteran) {
        u.veteran = true
        u.chronicle = [k.PROMOTION_MARK]
        dirty?.add(u.gameId)
        add('tag.add.veteran')
      }
      recomputeStats(u)
    }
    if (counters && dirty) {
      let needed = 0
      for (const id of dirty) if (unitById.has(id)) needed++
      dirty.clear()
      add('stats.needed', needed)
      add('stats.full', units.length)
      sampleEntities()
      let maxDepth = 0
      const children = new Map<number, number>()
      for (const u of units) {
        const p = parentOf(u)
        if (p) children.set(p.gameId, (children.get(p.gameId) ?? 0) + 1)
        maxDepth = Math.max(maxDepth, depthOf(u))
      }
      counters.set('hier.depth', maxDepth)
      counters.set('hier.maxChildren', Math.max(0, ...children.values()))
    }
    world.alive = [0, 0]
    for (const u of units) world.alive[u.team]++
    if (tick > 0 && world.winner === -1) {
      if (world.alive[0] === 0 && world.alive[1] > 0) world.winner = 1
      else if (world.alive[1] === 0 && world.alive[0] > 0) world.winner = 0
    }
    world.tick = tick
    tick++
  }

  const snapshot = (): CanonicalState => {
    const s: number[] = [
      world.tick, world.alive[0], world.alive[1], world.kills[0], world.kills[1], world.damage[0], world.damage[1], world.winner,
      world.score[0], world.score[1], shrines.length,
    ]
    for (const sh of shrines) s.push(sh.gameId, sh.owner, sh.progress)
    s.push(units.length)
    for (const u of units) {
      s.push(u.gameId, u.team, u.kind, u.x, u.y, u.hp, u.maxHp, u.attack, u.armor, u.speed, u.cooldown, u.target, u.memberOf, u.childOf)
      const active = [0, 1, 2].filter((b) => u.buffs[b] > 0)
      s.push(active.length)
      for (const b of active) s.push(b, u.buffs[b])
      s.push(u.items.length)
      for (const it of u.items) s.push(it.gameId, it.kind, it.quality)
      s.push((u.fleeing ? 1 : 0) | (u.veteran ? 2 : 0) | (u.routed ? 4 : 0), u.killCount, unitById.has(u.lastHitBy) ? u.lastHitBy : -1)
      s.push(u.morale ? u.morale.size0 : -1, u.morale ? u.morale.lost : -1)
      s.push(u.threat.length)
      for (const e of u.threat) s.push(e.attacker, e.amount)
      s.push(u.chronicle.length, ...u.chronicle)
    }
    s.push(projectiles.length)
    for (const p of projectiles) s.push(p.gameId, p.owner, p.target, p.x, p.y, p.age, p.speed, p.volley ? 1 : 0)
    s.push(groundItems.length)
    for (const g of [...groundItems].sort(byGameId)) s.push(g.gameId, g.kind, g.quality, g.x, g.y, g.age)
    return s
  }

  return {
    phases: { spawn, 'ai/target': aiTarget, move, combat, effects, morale, cleanup, objectives, stats },
    snapshot,
  }
}

export default createSim
