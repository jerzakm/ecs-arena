// Idiomatic koota implementation of SPEC.md. One system function per phase, steps in spec order.
// Everything is a koota entity: units, projectiles and items. gameId is a trait, never the entity id.
import {
  Not, Or, createAdded, createChanged, createQuery, createRemoved, createWorld, relation, trait,
  type Entity, type World,
} from 'koota'
import type { CanonicalState, CreateSim, Scenario } from '@ecs-arena/spec'

// ---- traits ----

const GameId = trait({ id: 0 })
const Position = trait({ x: 0, y: 0 })
const Start = trait({ x: 0, y: 0 }) // start-of-phase position, written at the top of `move`
const Team = trait({ value: 0 })
const Kind = trait({ value: 0 })
const Health = trait({ hp: 0, maxHp: 0 })
const Stats = trait({ attack: 0, armor: 0, speed: 0 }) // derived stats
const Cooldown = trait({ value: 0 })
const Age = trait({ value: 0 })

const Unit = trait()
const Minion = trait()
const Summoner = trait({ lastSummon: 0 })
const Item = trait()
const ItemKind = trait({ value: 0 })
const Ground = trait({ quality: 0 }) // a ground item. Quality rides along until it is picked up
const Projectile = trait({ owner: 0, ownerTeam: 0, ownerKind: 0, attack: 0, crit: 0 })

// Combat intents. Added in `combat`, resolved and removed in the same phase.
const Incoming = trait({ damage: 0, heal: 0, stun: 0, burn: 0, haste: 0 })
const Dead = trait()
const Spent = trait()

// Buffs are timed traits.
const Stun = trait({ ticksLeft: 0 })
const Burn = trait({ ticksLeft: 0 })
const Haste = trait({ ticksLeft: 0 })

// World traits
const Clock = trait({ tick: -1 })
const NextId = trait({ value: 1 })
const Metrics = trait({ alive0: 0, alive1: 0, kills0: 0, kills1: 0, damage0: 0, damage1: 0, winner: -1 })

// ---- relations ----

const Targets = relation({ exclusive: true })
const ChildOf = relation({ autoDestroy: 'orphan' })
const MemberOf = relation({ exclusive: true, store: { offsetX: 0, offsetY: 0 } })
const Equips = relation({ store: { quality: 1 } })

const CELL = 16 * 1024 // spatial grid cell size, an implementation detail

interface Cell {
  e: Entity; id: number; team: number; x: number; y: number; hp: number; maxHp: number
}

const createSim: CreateSim = (scenario: Scenario, k) => {
  const { fx, distSq, stepToward, clampToArena, randInt, teamGameId, PURPOSE, KIND, BUFF, UNIT_STATS, ITEMS } = k
  const { seed } = scenario

  const world: World = createWorld(Clock, NextId, Metrics)

  const Added = createAdded()
  const Removed = createRemoved()
  const Changed = createChanged()

  const unitsQuery = createQuery(Unit, GameId, Team, Position, Health)
  // One query per tracker. Or() over tracking modifiers misses traits added after spawn in koota 0.6.6.
  const dirtyStatsQueries = [Added(Equips), Removed(Equips), Changed(Equips), Added(Haste), Removed(Haste)].map(
    (modifier) => createQuery(Unit, modifier)
  )

  // ---- helpers ----

  const tickNow = () => world.get(Clock)!.tick
  const nextId = () => {
    const id = world.get(NextId)!.value
    world.set(NextId, { value: id + 1 })
    return id
  }
  const gid = (e: Entity) => e.get(GameId)!.id
  const byGameId = (a: { id: number }, b: { id: number }) => a.id - b.id

  // SPEC §4 Derived stats
  const recomputeStats = (e: Entity) => {
    const base = UNIT_STATS[e.get(Kind)!.value]
    let attack = base.attack, armor = base.armor, speed = base.speed
    for (const item of e.targetsFor(Equips)) {
      const def = ITEMS[item.get(ItemKind)!.value]
      const q = e.get(Equips(item))!.quality
      attack += def.attack * q
      armor += def.armor * q
      speed += def.speed * q
    }
    if (e.has(Haste)) speed = fx.div(speed * 3, 2)
    e.set(Stats, { attack, armor, speed })
  }

  // Creates a unit and, for non-minions, its items (SPEC §5.3), taking gameIds in the §5.4 order.
  const spawnUnit = (team: number, kind: number, x: number, y: number, tick: number): Entity => {
    const id = nextId()
    const maxHp = UNIT_STATS[kind].maxHp
    const px = clampToArena(x), py = clampToArena(y)
    const e = world.spawn(
      Unit, GameId({ id }), Team({ value: team }), Kind({ value: kind }),
      Position({ x: px, y: py }), Start({ x: px, y: py }),
      Health({ hp: maxHp, maxHp }), Stats, Cooldown
    )
    if (kind === KIND.SUMMONER) e.add(Summoner({ lastSummon: tick }))
    if (kind === KIND.MINION) e.add(Minion, Age)
    else {
      const count = randInt(4, seed, tick, id, PURPOSE.ITEM_COUNT)
      for (let i = 0; i < count; i++) {
        const item = world.spawn(Item, GameId({ id: nextId() }), ItemKind({
          value: randInt(8, seed, tick, id, PURPOSE.ITEM_KIND, i),
        }))
        e.add(Equips(item, { quality: 1 + randInt(3, seed, tick, id, PURPOSE.ITEM_QUALITY, i) }))
      }
    }
    recomputeStats(e)
    return e
  }

  // Implementation-owned spatial index: unit records bucketed by position, rebuilt when a phase needs it.
  const GRID_N = Math.ceil(k.ARENA / CELL)
  const cellOf = (v: number) => Math.min(GRID_N - 1, Math.max(0, Math.floor(v / CELL)))
  const buildGrid = (): Cell[][] => {
    const grid: Cell[][] = Array.from({ length: GRID_N * GRID_N }, () => [])
    world.query(unitsQuery).readEach(([g, t, p, h], e) => {
      grid[cellOf(p.y) * GRID_N + cellOf(p.x)].push({ e, id: g.id, team: t.value, x: p.x, y: p.y, hp: h.hp, maxHp: h.maxHp })
    })
    return grid
  }
  const forNear = (grid: Cell[][], x: number, y: number, r: number, fn: (c: Cell) => void) => {
    for (let cy = cellOf(y - r); cy <= cellOf(y + r); cy++)
      for (let cx = cellOf(x - r); cx <= cellOf(x + r); cx++)
        for (const c of grid[cy * GRID_N + cx]) fn(c)
  }

  const setBuff = (e: Entity, buff: typeof Stun | typeof Burn | typeof Haste, ticksLeft: number) => {
    if (e.has(buff)) e.set(buff, { ticksLeft })
    else e.add(buff({ ticksLeft }))
  }

  // ---- 6.1 spawn ----

  const spawnSquad = (team: number, squadIndex: number, tick: number) => {
    const squad = k.SQUADS[randInt(4, seed, tick, teamGameId(team), PURPOSE.SQUAD_KIND, squadIndex)]
    const facing = team === 0 ? 1 : -1
    const lx = k.SPAWN_X[team]
    const ly = k.SPAWN_Y_MIN + randInt(k.SPAWN_Y_RANGE, seed, tick, teamGameId(team), PURPOSE.SPAWN_Y, squadIndex) * k.FX
    const leader = spawnUnit(team, squad.leader, lx, ly, tick)
    squad.members.forEach((kind, i) => {
      const col = (i % 3) - 1
      const row = 1 + Math.floor(i / 3)
      const offsetX = -facing * row * k.FORMATION_SPACING
      const offsetY = col * k.FORMATION_SPACING
      const m = spawnUnit(team, kind, lx + offsetX, ly + offsetY, tick)
      m.add(MemberOf(leader, { offsetX, offsetY }))
    })
    return 1 + squad.members.length
  }

  const spawn = () => {
    world.set(Clock, (c) => ({ tick: c.tick + 1 }))
    const tick = tickNow()
    world.query(Age).updateEach(([age]) => { age.value++ })

    // 5.1 Waves
    if (tick % scenario.wavePeriod === 0) {
      for (const team of [0, 1]) {
        let alive = 0
        world.query(Unit, Team).readEach(([t]) => { if (t.value === team) alive++ })
        for (let squadIndex = 0; squadIndex < scenario.maxSquadsPerWave && alive < scenario.targetPop; squadIndex++) {
          alive += spawnSquad(team, squadIndex, tick)
        }
      }
    }

    // 5.4 step 3 Summons, in gameId order
    const summoners: { e: Entity; id: number; last: number }[] = []
    world.query(Summoner, GameId).readEach(([s, g], e) => summoners.push({ e, id: g.id, last: s.lastSummon }))
    summoners.sort(byGameId)
    for (const s of summoners) {
      if (tick - s.last < k.SUMMON_PERIOD || world.query(ChildOf(s.e)).length >= k.MAX_MINIONS) continue
      const pos = s.e.get(Position)!
      const m = spawnUnit(s.e.get(Team)!.value, KIND.MINION, pos.x, pos.y, tick)
      m.add(ChildOf(s.e))
      s.e.set(Summoner, { lastSummon: tick })
    }
  }

  // ---- 6.2 ai/target ----

  const aiTarget = () => {
    const grid = buildGrid()
    const retarget: [Entity, Entity | undefined][] = []

    world.query(Unit, Kind, Position, Team, Not(Stun)).readEach(([kindT, p, teamT], e) => {
      const kind = kindT.value
      if (kind === KIND.SUMMONER) return
      const stats = UNIT_STATS[kind]
      const cur = e.targetFor(Targets)
      let best: Cell | undefined

      if (kind === KIND.HEALER) {
        // Lowest hp/maxHp among hurt allies in heal range. Ties go to the lowest gameId.
        forNear(grid, p.x, p.y, stats.range, (v) => {
          if (v.team !== teamT.value || v.e === e || v.hp >= v.maxHp) return
          if (distSq(p.x, p.y, v.x, v.y) > stats.range * stats.range) return
          if (!best) { best = v; return }
          const a = v.hp * best.maxHp, b = best.hp * v.maxHp
          if (a < b || (a === b && v.id < best.id)) best = v
        })
      } else {
        // Keep the current target while it is in sight.
        if (cur) {
          const cp = cur.get(Position)!
          if (distSq(p.x, p.y, cp.x, cp.y) <= stats.sight * stats.sight) return
        }
        // Otherwise the nearest enemy in sight. Ties go to the lowest gameId.
        let bestD = 0
        forNear(grid, p.x, p.y, stats.sight, (v) => {
          if (v.team === teamT.value) return
          const d = distSq(p.x, p.y, v.x, v.y)
          if (d > stats.sight * stats.sight) return
          if (!best || d < bestD || (d === bestD && v.id < best.id)) { best = v; bestD = d }
        })
      }
      if (best?.e !== cur) retarget.push([e, best?.e])
    })

    for (const [e, t] of retarget) {
      if (t) e.add(Targets(t))
      else e.remove(Targets('*'))
    }
  }

  // ---- 6.3 move ----

  const move = () => {
    world.query(Unit, Position, Start).updateEach(([p, s]) => { s.x = p.x; s.y = p.y })

    const inRange = (kind: number, p: { x: number; y: number }, target: Entity | undefined) => {
      if (!target) return false
      const t = target.get(Start)!
      const r = UNIT_STATS[kind].range
      return distSq(p.x, p.y, t.x, t.y) <= r * r
    }

    // Hierarchy order, pass 1: leaders and units with no squad. They read start-of-phase positions.
    world.query(Unit, Position, Stats, Kind, Team, Not(Stun)).updateEach(([p, s, kindT, teamT], e) => {
      if (e.targetFor(MemberOf)) return
      const t = e.targetFor(Targets)
      if (inRange(kindT.value, p, t)) return
      let tx: number, ty: number
      if (t) { const ts = t.get(Start)!; tx = ts.x; ty = ts.y }
      else if (kindT.value === KIND.MINION) { const ss = e.targetFor(ChildOf)!.get(Start)!; tx = ss.x; ty = ss.y }
      else { tx = teamT.value === 0 ? k.MAX_COORD : 0; ty = p.y }
      ;[p.x, p.y] = stepToward(p.x, p.y, tx, ty, s.speed)
    })

    // Pass 2: members read the new leader position.
    // select keeps MemberOf's own store out of the tuple
    world.query(MemberOf('*'), Position, Stats, Kind, Not(Stun)).select(Position, Stats, Kind).updateEach(([p, s, kindT], e) => {
      if (inRange(kindT.value, p, e.targetFor(Targets))) return
      const leader = e.targetFor(MemberOf)!
      const lp = leader.get(Position)!
      const off = e.get(MemberOf(leader))!
      ;[p.x, p.y] = stepToward(p.x, p.y, lp.x + off.offsetX, lp.y + off.offsetY, s.speed)
    })

    // Pass 3: projectiles read the final position of their target.
    world.query(Projectile, Position).updateEach(([, p], e) => {
      const t = e.targetFor(Targets)
      if (t) { const tp = t.get(Position)!; [p.x, p.y] = stepToward(p.x, p.y, tp.x, tp.y, k.PROJECTILE_SPEED) }
    })
  }

  // ---- 6.4 combat ----

  const combat = () => {
    const tick = tickNow()
    const grid = buildGrid()
    const damageDealt = [0, 0]

    // Intents are traits. Nothing is visible to the attack step until the resolve step.
    const intend = (e: Entity, add: Partial<{ damage: number; heal: number; stun: number; burn: number; haste: number }>) => {
      if (e.has(Incoming)) {
        e.set(Incoming, (p) => ({
          damage: p.damage + (add.damage ?? 0), heal: p.heal + (add.heal ?? 0),
          stun: p.stun | (add.stun ?? 0), burn: p.burn | (add.burn ?? 0), haste: p.haste | (add.haste ?? 0),
        }))
      } else e.add(Incoming(add))
    }
    const hurt = (victim: Entity, attack: number, crit: boolean, attackerTeam: number, extra: { stun?: number; burn?: number } = {}) => {
      const d = k.damage(attack, victim.get(Stats)!.armor, crit)
      intend(victim, { damage: d, ...extra })
      damageDealt[attackerTeam] += d // step 5
    }

    // 1. Hits
    world.query(Projectile, Position).readEach(([pr, p], e) => {
      const t = e.targetFor(Targets)
      if (!t) return
      const tp = t.get(Position)!
      if (p.x !== tp.x || p.y !== tp.y) return
      e.add(Spent)
      const crit = pr.crit === 1
      if (pr.ownerKind === KIND.MAGE) {
        forNear(grid, p.x, p.y, k.SPLASH_RADIUS, (v) => {
          if (v.team === pr.ownerTeam || distSq(p.x, p.y, v.x, v.y) > k.SPLASH_RADIUS * k.SPLASH_RADIUS) return
          hurt(v.e, pr.attack, crit, pr.ownerTeam, { burn: 1 })
        })
      } else hurt(t, pr.attack, crit, pr.ownerTeam)
    })

    // 2. Attacks
    const shots: { id: number; e: Entity }[] = []
    world.query(Unit, GameId, Kind, Team, Position, Stats, Cooldown, Not(Stun)).updateEach(([g, kindT, teamT, p, s, cd], e) => {
      if (cd.value !== 0 || kindT.value === KIND.SUMMONER) return
      const t = e.targetFor(Targets)
      if (!t) return
      const tp = t.get(Position)!
      const r = UNIT_STATS[kindT.value].range
      if (distSq(p.x, p.y, tp.x, tp.y) > r * r) return
      const kind = kindT.value
      if (kind === KIND.WARRIOR || kind === KIND.MINION) {
        const crit = k.isCrit(seed, tick, g.id)
        hurt(t, s.attack, crit, teamT.value, crit && kind === KIND.WARRIOR ? { stun: 1 } : {})
      } else if (kind === KIND.ARCHER || kind === KIND.MAGE) {
        shots.push({ id: g.id, e })
      } else intend(t, { heal: s.attack, haste: 1 }) // healer
      cd.value = UNIT_STATS[kind].cooldown
    })
    shots.sort(byGameId)
    for (const { id, e } of shots) {
      const kind = e.get(Kind)!.value
      const pos = e.get(Position)!
      world.spawn(
        GameId({ id: nextId() }), Position({ x: pos.x, y: pos.y }), Age,
        Projectile({ owner: id, ownerTeam: e.get(Team)!.value, ownerKind: kind, attack: e.get(Stats)!.attack, crit: k.isCrit(seed, tick, id) ? 1 : 0 }),
        Targets(e.targetFor(Targets)!)
      )
    }

    // 3. Cooldowns
    world.query(Unit, Cooldown).updateEach(([cd]) => { if (cd.value > 0) cd.value-- })

    // 4. Resolve. Buffs from this phase start now, a repeat resets ticksLeft.
    const resolved = [...world.query(Incoming)]
    for (const e of resolved) {
      const inc = e.get(Incoming)!
      const h = e.get(Health)!
      const hp = Math.min(h.maxHp, h.hp - inc.damage + inc.heal)
      e.set(Health, { hp })
      if (hp <= 0) e.add(Dead)
      if (inc.stun) setBuff(e, Stun, k.BUFF_DURATION[BUFF.STUN])
      if (inc.burn) setBuff(e, Burn, k.BUFF_DURATION[BUFF.BURN])
      if (inc.haste) setBuff(e, Haste, k.BUFF_DURATION[BUFF.HASTE])
      e.remove(Incoming)
    }

    world.set(Metrics, (m) => ({ damage0: m.damage0 + damageDealt[0], damage1: m.damage1 + damageDealt[1] }))
  }

  // ---- 6.5 effects ----

  const effects = () => {
    for (const e of [...world.query(Or(Stun, Burn, Haste))]) {
      for (const buff of [Stun, Burn, Haste]) {
        if (!e.has(buff)) continue
        const ticksLeft = e.get(buff)!.ticksLeft - 1
        if (buff === Burn && ticksLeft % k.BURN_INTERVAL === 0) {
          const hp = e.get(Health)!.hp - k.BURN_DAMAGE
          e.set(Health, { hp })
          if (hp <= 0 && !e.has(Dead)) e.add(Dead)
        }
        if (ticksLeft === 0) e.remove(buff)
        else e.set(buff, { ticksLeft })
      }
    }
  }

  // ---- 6.6 cleanup ----

  const cleanup = () => {
    const kills = [0, 0]

    // Dead units in gameId order. A minion that a cascade already destroyed is skipped.
    const dead: { id: number; e: Entity }[] = []
    world.query(Dead, GameId).readEach(([g], e) => dead.push({ id: g.id, e }))
    dead.sort(byGameId)

    for (const { e } of dead) {
      if (!e.isAlive()) continue
      const kind = e.get(Kind)!.value
      // 1. Kill credit
      if (kind !== KIND.MINION) kills[1 - e.get(Team)!.value]++
      // 2. The first item drops, the rest are destroyed
      const items = e.targetsFor(Equips).map((item) => ({ id: gid(item), e: item })).sort(byGameId)
      if (items.length > 0) {
        const pos = e.get(Position)!
        const first = items[0].e
        const quality = e.get(Equips(first))!.quality
        e.remove(Equips(first))
        first.add(Ground({ quality }), Position({ x: pos.x, y: pos.y }), Age)
        for (let i = 1; i < items.length; i++) items[i].e.destroy()
      }
      // 3. Minions die with the summoner: ChildOf is autoDestroy 'orphan'.
      // 4. Promote the lowest-gameId member of a leader
      const members = [...world.query(MemberOf(e))].map((m) => ({ id: gid(m), e: m })).sort(byGameId)
      if (members.length > 0) {
        const promoted = members[0].e
        const off = promoted.get(MemberOf(e))!
        for (const { e: m } of members.slice(1)) {
          const mo = m.get(MemberOf(e))!
          m.add(MemberOf(promoted, { offsetX: mo.offsetX - off.offsetX, offsetY: mo.offsetY - off.offsetY }))
        }
        promoted.remove(MemberOf('*'))
      }
      // 5. Destroy. Every Targets relation to it goes with it.
      e.destroy()
    }

    // 6. Minions that are 300 ticks old
    for (const e of [...world.query(Minion, Age)]) if (e.get(Age)!.value >= k.MINION_LIFETIME) e.destroy()

    // 7. Projectiles that are Spent, have no target, or are 60 ticks old
    for (const e of [...world.query(Projectile, Age)]) {
      if (e.has(Spent) || !e.targetFor(Targets) || e.get(Age)!.value >= k.PROJECTILE_LIFETIME) e.destroy()
    }

    // 8. Pickup, in gameId order. Items taken here count toward the cap of later items.
    const ground: { id: number; e: Entity }[] = []
    world.query(Ground, GameId).readEach((_, e) => ground.push({ id: gid(e), e }))
    if (ground.length > 0) {
      ground.sort(byGameId)
      const grid = buildGrid()
      for (const g of ground) {
        const gp = g.e.get(Position)!
        let best: Cell | undefined
        let bestD = 0
        forNear(grid, gp.x, gp.y, k.PICKUP_RANGE, (v) => {
          const d = distSq(gp.x, gp.y, v.x, v.y)
          if (d > k.PICKUP_RANGE * k.PICKUP_RANGE) return
          if (best && !(d < bestD || (d === bestD && v.id < best.id))) return
          if (v.e.targetsFor(Equips).length >= k.MAX_ITEMS) return
          best = v; bestD = d
        })
        if (!best) continue
        const quality = g.e.get(Ground)!.quality
        best.e.add(Equips(g.e, { quality }))
        // Added(Equips) fires for the first pair only. The set flags Changed(Equips) for this pair.
        best.e.set(Equips(g.e), { quality })
        g.e.remove(Ground, Position, Age)
      }
    }

    // 9. Ground items that are 300 ticks old
    for (const e of [...world.query(Ground, Age)]) if (e.get(Age)!.value >= k.GROUND_ITEM_LIFETIME) e.destroy()

    world.set(Metrics, (m) => ({ kills0: m.kills0 + kills[0], kills1: m.kills1 + kills[1] }))
  }

  // ---- 6.7 stats ----

  const stats = () => {
    // Only units whose equipment or haste changed.
    const dirty = new Set<Entity>()
    for (const q of dirtyStatsQueries) for (const e of world.query(q)) dirty.add(e)
    for (const e of dirty) if (e.isAlive()) recomputeStats(e)

    const alive = [0, 0]
    world.query(Unit, Team).readEach(([t]) => { alive[t.value]++ })
    const tick = tickNow()
    world.set(Metrics, (m) => {
      let winner = m.winner
      if (tick > 0 && winner === -1) {
        if (alive[0] === 0 && alive[1] > 0) winner = 1
        else if (alive[1] === 0 && alive[0] > 0) winner = 0
      }
      return { alive0: alive[0], alive1: alive[1], winner }
    })
  }

  // ---- 8 snapshot ----

  const snapshot = (): CanonicalState => {
    const m = world.get(Metrics)!
    const s: number[] = [tickNow(), m.alive0, m.alive1, m.kills0, m.kills1, m.damage0, m.damage1, m.winner]

    const units: { id: number; e: Entity }[] = []
    world.query(Unit, GameId).readEach(([g], e) => units.push({ id: g.id, e }))
    units.sort(byGameId)
    s.push(units.length)
    for (const { id, e } of units) {
      const p = e.get(Position)!, h = e.get(Health)!, st = e.get(Stats)!
      const target = e.targetFor(Targets), leader = e.targetFor(MemberOf), parent = e.targetFor(ChildOf)
      s.push(
        id, e.get(Team)!.value, e.get(Kind)!.value, p.x, p.y, h.hp, h.maxHp, st.attack, st.armor, st.speed, e.get(Cooldown)!.value,
        target ? gid(target) : -1, leader ? gid(leader) : -1, parent ? gid(parent) : -1
      )
      const buffs: [number, number][] = []
      if (e.has(Stun)) buffs.push([BUFF.STUN, e.get(Stun)!.ticksLeft])
      if (e.has(Burn)) buffs.push([BUFF.BURN, e.get(Burn)!.ticksLeft])
      if (e.has(Haste)) buffs.push([BUFF.HASTE, e.get(Haste)!.ticksLeft])
      s.push(buffs.length)
      for (const [b, t] of buffs) s.push(b, t)
      const items = e.targetsFor(Equips).map((item) => ({ id: gid(item), e: item })).sort(byGameId)
      s.push(items.length)
      for (const it of items) s.push(it.id, it.e.get(ItemKind)!.value, e.get(Equips(it.e))!.quality)
    }

    const projectiles: { id: number; e: Entity }[] = []
    world.query(Projectile, GameId).readEach(([, g], e) => projectiles.push({ id: g.id, e }))
    projectiles.sort(byGameId)
    s.push(projectiles.length)
    for (const { id, e } of projectiles) {
      const p = e.get(Position)!, t = e.targetFor(Targets)
      s.push(id, e.get(Projectile)!.owner, t ? gid(t) : -1, p.x, p.y, e.get(Age)!.value)
    }

    const ground: { id: number; e: Entity }[] = []
    world.query(Ground, GameId).readEach(([, g], e) => ground.push({ id: g.id, e }))
    ground.sort(byGameId)
    s.push(ground.length)
    for (const { id, e } of ground) {
      const p = e.get(Position)!
      s.push(id, e.get(ItemKind)!.value, e.get(Ground)!.quality, p.x, p.y, e.get(Age)!.value)
    }
    return s
  }

  return {
    phases: { spawn, 'ai/target': aiTarget, move, combat, effects, cleanup, stats },
    snapshot,
  }
}

export default createSim
