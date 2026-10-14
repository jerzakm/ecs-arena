// Idiomatic koota implementation of SPEC.md (v2). One system function per phase, in spec order.
// Units, projectiles, items and shrines are koota entities. gameId is a trait, never the entity id.
import {
  Not, createAdded, createChanged, createQuery, createWorld, relation, trait,
  type Entity, type QueryParameter, type World,
} from 'koota'
import type { CanonicalState, CreateSim, Scenario } from '@ecs-arena/spec'

const GameId = trait({ id: 0 })
const Position = trait({ x: 0, y: 0 })
const Start = trait({ x: 0, y: 0 })
const Team = trait({ value: 0 })
const Kind = trait({ value: 0 })
const Health = trait({ hp: 0, maxHp: 0 })
const Stats = trait({ attack: 0, armor: 0, speed: 0 })
const Cooldown = trait({ value: 0 })
const Age = trait({ value: 0 })
const KillCount = trait({ value: 0 })
const Morale = trait({ size0: 0, lost: 0 })
const Chronicle = trait({ kinds: () => [] as number[] })
const Shrine = trait({ owner: -1, progress: 0 })
const Summoner = trait({ lastSummon: 0 })
const ItemKind = trait({ value: 0 })
const Ground = trait({ quality: 0 })
const Projectile = trait({ owner: 0, ownerTeam: 0, ownerKind: 0, attack: 0, crit: 0, speed: 0, volley: 0 })

const Unit = trait()
const Minion = trait()
const Item = trait()
const Dead = trait()
const Spent = trait()
const Fleeing = trait()
const Routed = trait()
const Veteran = trait()

const Stun = trait({ ticksLeft: 0 })
const Burn = trait({ ticksLeft: 0 })
const Haste = trait({ ticksLeft: 0 })

const Clock = trait({ tick: -1 })
const NextId = trait({ value: 1 })
const Metrics = trait({ alive0: 0, alive1: 0, kills0: 0, kills1: 0, damage0: 0, damage1: 0, winner: -1 })
const Score = trait({ shrines0: 0, shrines1: 0 })

const Targets = relation({ exclusive: true })
const ChildOf = relation({ autoDestroy: 'orphan' })
const MemberOf = relation({ exclusive: true, store: { offsetX: 0, offsetY: 0 } })
const Equips = relation({ autoDestroy: 'target', store: { quality: 1 } })
const Threat = relation({ store: { amount: 0 } })
const LastHitBy = relation({ exclusive: true })
const FiredBy = relation({ exclusive: true })

const CELL = 16 * 1024

interface Cell { e: Entity; id: number; team: number; x: number; y: number; hp: number; maxHp: number; fleeing: boolean }
interface Damage { victim: Entity; victimId: number; attacker: Entity | undefined; attackerId: number; team: number; value: number }
interface Incoming { damage: number; heal: number; stun: boolean; burn: boolean; haste: boolean }
interface Shot { id: number; j: number; shooter: Entity; target: Entity; x: number; y: number; team: number; kind: number; attack: number; crit: boolean }

const createSim: CreateSim = (scenario: Scenario, k) => {
  const { fx, distSq, stepToward, clampToArena, randInt, teamGameId, PURPOSE, KIND, BUFF, UNIT_STATS, ITEMS } = k
  const { seed } = scenario

  const world: World = createWorld(Clock, NextId, Metrics, Score)

  const Added = createAdded()
  const Changed = createChanged()
  // A query that holds only a tracker reports every new entity in koota 0.6.6, so each tracker is paired with Unit.
  const newlyRouted = createQuery(Unit, Added(Routed))
  const newlyFleeing = createQuery(Unit, Added(Fleeing))
  const newlyVeteran = createQuery(Unit, Added(Veteran))
  const killsChanged = createQuery(Unit, Changed(KillCount), Not(Veteran))
  const unitsQuery = createQuery(Unit, GameId, Team, Position, Health)
  const teamQuery = createQuery(Unit, Team)
  const thinkers = createQuery(Unit, GameId, Kind, Position, Team, Not(Stun), Not(Fleeing))
  const movers = createQuery(Unit, Kind, Team, Stats, Not(Stun))
  const projectiles = createQuery(Projectile, Position)
  const attackers = createQuery(Unit, GameId, Kind, Team, Position, Stats, Cooldown, Not(Stun), Not(Fleeing))
  const cooldowns = createQuery(Unit, Cooldown)
  const starts = createQuery(Position, Start)

  // Units whose derived stats may have changed. Added(Equips) reports only the first pair of an entity in koota 0.6.6, so observers.
  const dirty = new Set<Entity>()
  const markDirty = (e: Entity) => void dirty.add(e)
  for (const t of [Equips, Haste]) {
    world.onAdd(t, markDirty)
    world.onRemove(t, markDirty)
  }
  world.onAdd(Veteran, markDirty)
  world.onChange(KillCount, markDirty)

  const tickNow = () => world.get(Clock)!.tick
  const nextId = () => {
    const id = world.get(NextId)!.value
    world.set(NextId, { value: id + 1 })
    return id
  }
  const gid = (e: Entity) => e.get(GameId)!.id
  const byId = (a: { id: number }, b: { id: number }) => a.id - b.id
  const sortedByGameId = (...params: QueryParameter[]) => {
    const out: { id: number; e: Entity }[] = []
    world.query(GameId, ...params).readEach(([g], e) => out.push({ id: g.id, e }))
    return out.sort(byId)
  }
  const homeX = (team: number) => (team === 0 ? 0 : k.MAX_COORD)
  const isThinkTick = (id: number, tick: number) => (id + tick) % k.THINK_INTERVAL === 0
  const inRange = (ax: number, ay: number, bx: number, by: number, r: number) => distSq(ax, ay, bx, by) <= r * r
  const aliveCount = (team: number) => {
    let n = 0
    world.query(teamQuery).readEach(([t]) => { if (t.value === team) n++ })
    return n
  }

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
    if (e.has(Veteran)) attack += k.VETERAN_ATTACK_STEP * Math.min(k.VETERAN_MAX_STEPS, fx.div(e.get(KillCount)!.value, k.VETERAN_KILLS))
    if (e.has(Haste)) speed = fx.div(speed * 3, 2)
    e.set(Stats, { attack, armor, speed })
  }

  const spawnUnit = (team: number, kind: number, x: number, y: number, tick: number): Entity => {
    const id = nextId()
    const maxHp = UNIT_STATS[kind].maxHp
    const px = clampToArena(x), py = clampToArena(y)
    const e = world.spawn(
      Unit, GameId({ id }), Team({ value: team }), Kind({ value: kind }),
      Position({ x: px, y: py }), Start({ x: px, y: py }), Health({ hp: maxHp, maxHp }), Stats, Cooldown, KillCount
    )
    if (kind === KIND.SUMMONER) e.add(Summoner({ lastSummon: tick }))
    if (kind === KIND.MINION) e.add(Minion, Age)
    else {
      const count = randInt(4, seed, tick, id, PURPOSE.ITEM_COUNT)
      for (let i = 0; i < count; i++) {
        const item = world.spawn(Item, GameId({ id: nextId() }), ItemKind({ value: randInt(8, seed, tick, id, PURPOSE.ITEM_KIND, i) }))
        e.add(Equips(item, { quality: 1 + randInt(3, seed, tick, id, PURPOSE.ITEM_QUALITY, i) }))
      }
    }
    recomputeStats(e)
    return e
  }

  const GRID_N = Math.ceil(k.ARENA / CELL)
  const cellOf = (v: number) => Math.min(GRID_N - 1, Math.max(0, Math.floor(v / CELL)))
  const buildGrid = (): Cell[][] => {
    const grid: Cell[][] = Array.from({ length: GRID_N * GRID_N }, () => [])
    world.query(unitsQuery).readEach(([g, t, p, h], e) => {
      grid[cellOf(p.y) * GRID_N + cellOf(p.x)].push({ e, id: g.id, team: t.value, x: p.x, y: p.y, hp: h.hp, maxHp: h.maxHp, fleeing: e.has(Fleeing) })
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

  const spawnWarlord = (team: number, warband: number, yPurpose: number, tick: number) => {
    const facing = team === 0 ? 1 : -1
    const y = k.SPAWN_Y_MIN + randInt(k.SPAWN_Y_RANGE, seed, tick, teamGameId(team), yPurpose, warband) * k.FX
    return spawnUnit(team, KIND.WARLORD, k.SPAWN_X[team] + facing * k.WARLORD_SPAWN_GAP, y, tick)
  }

  const spawnSquad = (team: number, squadIndex: number, place: number, warlord: Entity, kindPurpose: number, tick: number) => {
    const squad = k.SQUADS[randInt(4, seed, tick, teamGameId(team), kindPurpose, squadIndex)]
    const facing = team === 0 ? 1 : -1
    const wp = warlord.get(Position)!
    const leaderOffsetX = -facing * k.LEADER_SLOT_SPACING
    const leaderOffsetY = (2 * place - 3) * k.LEADER_SLOT_SPACING
    const leader = spawnUnit(team, squad.leader, wp.x + leaderOffsetX, wp.y + leaderOffsetY, tick)
    leader.add(MemberOf(warlord, { offsetX: leaderOffsetX, offsetY: leaderOffsetY }), Morale({ size0: 1 + squad.members.length, lost: 0 }))
    const lp = leader.get(Position)!
    squad.members.forEach((kind, i) => {
      const offsetX = -facing * (1 + fx.div(i, 3)) * k.FORMATION_SPACING
      const offsetY = ((i % 3) - 1) * k.FORMATION_SPACING
      spawnUnit(team, kind, lp.x + offsetX, lp.y + offsetY, tick).add(MemberOf(leader, { offsetX, offsetY }))
    })
    return 1 + squad.members.length
  }

  const spawnSquads = (team: number, maxSquads: number, popCap: number, kindPurpose: number, yPurpose: number, tick: number) => {
    let alive = aliveCount(team)
    let warlord: Entity | undefined
    for (let s = 0; s < maxSquads && alive < popCap; s++) {
      const place = s % k.SQUADS_PER_WARBAND
      if (place === 0) {
        warlord = spawnWarlord(team, fx.div(s, k.SQUADS_PER_WARBAND), yPurpose, tick)
        alive++
      }
      alive += spawnSquad(team, s, place, warlord!, kindPurpose, tick)
    }
  }

  const spawn = () => {
    world.set(Clock, (c) => ({ tick: c.tick + 1 }))
    const tick = tickNow()
    world.query(Age).updateEach(([age]) => { age.value++ })

    if (tick === 0) {
      for (let i = 0; i < k.SHRINE_COUNT; i++) world.spawn(Shrine, GameId({ id: nextId() }), Position({ x: k.SHRINE_X, y: k.shrineY(i) }))
    }

    if (tick % scenario.wavePeriod === 0) {
      for (const team of [0, 1]) spawnSquads(team, scenario.maxSquadsPerWave, scenario.targetPop, PURPOSE.SQUAD_KIND, PURPOSE.SPAWN_Y, tick)
    }

    if (tick > 0 && tick % scenario.surgePeriod === 0) {
      const score = world.get(Score)!
      const held = [score.shrines0, score.shrines1]
      for (const team of [0, 1]) {
        const lead = held[team] - held[1 - team]
        if (lead > 0) spawnSquads(team, scenario.surgeBase * lead, scenario.surgeCap, PURPOSE.SURGE_KIND, PURPOSE.SURGE_Y, tick)
      }
    }

    const summoners: { e: Entity; id: number; last: number }[] = []
    world.query(Summoner, GameId).readEach(([s, g], e) => summoners.push({ e, id: g.id, last: s.lastSummon }))
    summoners.sort(byId)
    for (const s of summoners) {
      if (tick - s.last < k.SUMMON_PERIOD || world.query(ChildOf(s.e)).length >= k.MAX_MINIONS) continue
      const pos = s.e.get(Position)!
      spawnUnit(s.e.get(Team)!.value, KIND.MINION, pos.x, pos.y, tick).add(ChildOf(s.e))
      s.e.set(Summoner, { lastSummon: tick })
    }
  }

  const aiTarget = () => {
    const tick = tickNow()
    const grid = buildGrid()
    const retarget: [Entity, Entity | undefined][] = []

    const validTarget = (team: number, x: number, y: number, sight: number, t: Entity) => {
      const tp = t.get(Position)!
      return t.get(Team)!.value !== team && !t.has(Fleeing) && inRange(x, y, tp.x, tp.y, sight)
    }

    const retaliation = (e: Entity, team: number, x: number, y: number, sight: number) => {
      let best: Entity | undefined
      let bestAmount = 0, bestId = 0
      for (const attacker of e.targetsFor(Threat)) {
        const amount = e.get(Threat(attacker))!.amount
        if (amount < k.THREAT_RETALIATE || !validTarget(team, x, y, sight, attacker)) continue
        const id = gid(attacker)
        if (!best || amount > bestAmount || (amount === bestAmount && id < bestId)) { best = attacker; bestAmount = amount; bestId = id }
      }
      return best
    }

    world.query(thinkers).readEach(([g, kindT, p, teamT], e) => {
      const kind = kindT.value
      if (kind === KIND.SUMMONER) return
      const stats = UNIT_STATS[kind]
      const cur = e.targetFor(Targets)
      let best: Entity | undefined

      if (kind === KIND.HEALER) {
        const curHurt = cur && cur.get(Health)!.hp < cur.get(Health)!.maxHp
        const cp = cur?.get(Position)
        if (cur && curHurt && cp && inRange(p.x, p.y, cp.x, cp.y, stats.range)) return
        if (isThinkTick(g.id, tick)) {
          let bestCell: Cell | undefined
          forNear(grid, p.x, p.y, stats.range, (v) => {
            if (v.team !== teamT.value || v.e === e || v.hp >= v.maxHp || !inRange(p.x, p.y, v.x, v.y, stats.range)) return
            if (!bestCell) { bestCell = v; return }
            const a = v.hp * bestCell.maxHp, b = bestCell.hp * v.maxHp
            if (a < b || (a === b && v.id < bestCell.id)) bestCell = v
          })
          best = bestCell?.e
        }
      } else {
        best = retaliation(e, teamT.value, p.x, p.y, stats.sight)
        if (!best && cur && validTarget(teamT.value, p.x, p.y, stats.sight, cur)) best = cur
        if (!best && isThinkTick(g.id, tick)) {
          let bestCell: Cell | undefined
          let bestD = 0
          const team = teamT.value, x = p.x, y = p.y, sightSq = stats.sight * stats.sight
          forNear(grid, x, y, stats.sight, (v) => {
            if (v.team === team || v.fleeing) return
            const d = distSq(x, y, v.x, v.y)
            if (d > sightSq) return
            if (!bestCell || d < bestD || (d === bestD && v.id < bestCell.id)) { bestCell = v; bestD = d }
          })
          best = bestCell?.e
        }
      }
      if (best !== cur) retarget.push([e, best])
    })

    for (const [e, t] of retarget) {
      if (t) e.add(Targets(t))
      else e.remove(Targets('*'))
    }
  }

  const move = () => {
    world.query(starts).updateEach(([p, s]) => { s.x = p.x; s.y = p.y })

    // Depth is memoized for the phase, since siblings share their parent chain.
    const depth = new Map<Entity, number>()
    const depthOf = (e: Entity): number => {
      let d = depth.get(e)
      if (d === undefined) {
        const p = e.targetFor(MemberOf) ?? e.targetFor(ChildOf)
        depth.set(e, d = p ? depthOf(p) + 1 : 0)
      }
      return d
    }
    const levels: { e: Entity; kind: number; team: number; speed: number }[][] = []
    world.query(movers).readEach(([kindT, teamT, s], e) => {
      (levels[depthOf(e)] ??= []).push({ e, kind: kindT.value, team: teamT.value, speed: s.speed })
    })

    // Hierarchy order: a parent moves before its children, and children read the new parent position.
    for (const level of levels) {
      if (!level) continue
      for (const { e, kind, team, speed } of level) {
        const p = e.get(Position)!
        let tx: number, ty: number
        if (e.has(Fleeing)) { tx = homeX(team); ty = p.y }
        else {
          const target = e.targetFor(Targets)
          const ts = target?.get(Start)
          if (ts && inRange(p.x, p.y, ts.x, ts.y, UNIT_STATS[kind].range)) continue
          const parent = e.targetFor(MemberOf)
          if (parent) {
            const pp = parent.get(Position)!
            const off = e.get(MemberOf(parent))!
            tx = pp.x + off.offsetX; ty = pp.y + off.offsetY
          } else if (ts) { tx = ts.x; ty = ts.y }
          else if (kind === KIND.MINION) { const sp = e.targetFor(ChildOf)!.get(Position)!; tx = sp.x; ty = sp.y }
          else { tx = team === 0 ? k.MAX_COORD : 0; ty = p.y }
        }
        const [x, y] = stepToward(p.x, p.y, tx, ty, speed)
        e.set(Position, { x, y })
      }
    }

    world.query(projectiles).updateEach(([pr, p], e) => {
      const t = e.targetFor(Targets)
      if (t) { const tp = t.get(Position)!; [p.x, p.y] = stepToward(p.x, p.y, tp.x, tp.y, pr.speed) }
    })
  }

  const combat = () => {
    const tick = tickNow()
    const grid = buildGrid()
    const damages: Damage[] = []
    const incoming = new Map<Entity, Incoming>()
    const incomingOf = (e: Entity) => {
      let i = incoming.get(e)
      if (!i) incoming.set(e, i = { damage: 0, heal: 0, stun: false, burn: false, haste: false })
      return i
    }
    const hurt = (victim: Entity, attacker: Entity | undefined, attackerId: number, team: number, value: number) => {
      incomingOf(victim).damage += value
      damages.push({ victim, victimId: gid(victim), attacker, attackerId, team, value })
    }

    const spent: Entity[] = []
    world.query(projectiles).readEach(([pr, p], e) => {
      const t = e.targetFor(Targets)
      if (!t) return
      const tp = t.get(Position)!
      if (p.x !== tp.x || p.y !== tp.y) return
      spent.push(e)
      const crit = pr.crit === 1
      const shooter = e.targetFor(FiredBy)
      if (pr.ownerKind === KIND.MAGE) {
        forNear(grid, p.x, p.y, k.SPLASH_RADIUS, (v) => {
          if (v.team === pr.ownerTeam || !inRange(p.x, p.y, v.x, v.y, k.SPLASH_RADIUS)) return
          hurt(v.e, shooter, pr.owner, pr.ownerTeam, k.damage(pr.attack, v.e.get(Stats)!.armor, crit))
          incomingOf(v.e).burn = true
        })
      } else {
        const armor = t.get(Stats)!.armor
        hurt(t, shooter, pr.owner, pr.ownerTeam, pr.volley ? k.volleyDamage(pr.attack, armor, crit) : k.damage(pr.attack, armor, crit))
      }
    })
    for (const e of spent) e.add(Spent)

    const shots: Shot[] = []
    world.query(attackers).updateEach(([g, kindT, teamT, p, s, cd], e) => {
      const kind = kindT.value
      if (cd.value !== 0 || kind === KIND.SUMMONER) return
      const t = e.targetFor(Targets)
      if (!t) return
      const tp = t.get(Position)!
      if (!inRange(p.x, p.y, tp.x, tp.y, UNIT_STATS[kind].range)) return
      const crit = k.isCrit(seed, tick, g.id)
      if (kind === KIND.WARRIOR || kind === KIND.MINION || kind === KIND.WARLORD) {
        hurt(t, e, g.id, teamT.value, k.damage(s.attack, t.get(Stats)!.armor, crit))
        if (crit && kind !== KIND.MINION) incomingOf(t).stun = true
      } else if (kind === KIND.MAGE || kind === KIND.ARCHER) {
        const volley = kind === KIND.ARCHER ? k.VOLLEY_SIZE : 1
        for (let j = 0; j < volley; j++) {
          shots.push({ id: g.id, j, shooter: e, target: t, x: p.x, y: p.y, team: teamT.value, kind, attack: s.attack, crit })
        }
      } else {
        const i = incomingOf(t)
        i.heal += s.attack
        i.haste = true
      }
      cd.value = UNIT_STATS[kind].cooldown
    })
    shots.sort((a, b) => a.id - b.id || a.j - b.j)
    for (const s of shots) {
      const volley = s.kind === KIND.ARCHER
      world.spawn(
        GameId({ id: nextId() }), Position({ x: s.x, y: s.y }), Age,
        Projectile({
          owner: s.id, ownerTeam: s.team, ownerKind: s.kind, attack: s.attack, crit: s.crit ? 1 : 0,
          speed: k.PROJECTILE_SPEED - (volley ? k.VOLLEY_SPEED_STEP * s.j : 0), volley: volley ? 1 : 0,
        }),
        Targets(s.target), FiredBy(s.shooter)
      )
    }

    world.query(cooldowns).updateEach(([cd]) => { if (cd.value > 0) cd.value-- })

    for (const [e, inc] of incoming) {
      const h = e.get(Health)!
      const hp = Math.min(h.maxHp, h.hp - inc.damage + inc.heal)
      e.set(Health, { hp })
      if (hp <= 0) e.add(Dead)
      if (inc.stun) setBuff(e, Stun, k.BUFF_DURATION[BUFF.STUN])
      if (inc.burn) setBuff(e, Burn, k.BUFF_DURATION[BUFF.BURN])
      if (inc.haste) setBuff(e, Haste, k.BUFF_DURATION[BUFF.HASTE])
    }

    damages.sort((a, b) => a.victimId - b.victimId || a.attackerId - b.attackerId)
    for (let i = 0; i < damages.length;) {
      const victim = damages[i].victim
      const sums: { attacker: Entity; id: number; amount: number }[] = []
      for (; i < damages.length && damages[i].victim === victim; i++) {
        const { attacker, attackerId, value } = damages[i]
        if (!attacker) continue
        const last = sums[sums.length - 1]
        if (last && last.id === attackerId) last.amount += value
        else sums.push({ attacker, id: attackerId, amount: value })
      }
      let top: (typeof sums)[number] | undefined
      for (const s of sums) if (!top || s.amount > top.amount) top = s
      if (top) victim.add(LastHitBy(top.attacker))
      if (victim.has(Fleeing)) continue
      for (const s of sums) {
        // set with an updater function is ignored on a relation pair in koota 0.6.6, so the amount is read first.
        const amount = Math.min(k.THREAT_CLAMP, (victim.get(Threat(s.attacker))?.amount ?? 0) + s.amount)
        if (victim.has(Threat(s.attacker))) victim.set(Threat(s.attacker), { amount })
        else victim.add(Threat(s.attacker, { amount }))
      }
      const edges = victim.targetsFor(Threat).map((a) => ({ a, id: gid(a), amount: victim.get(Threat(a))!.amount }))
      while (edges.length > k.THREAT_MAX_EDGES) {
        let worst = 0
        edges.forEach((e, n) => {
          const w = edges[worst]
          if (e.amount < w.amount || (e.amount === w.amount && e.id > w.id)) worst = n
        })
        victim.remove(Threat(edges[worst].a))
        edges.splice(worst, 1)
      }
    }

    const dealt = [0, 0]
    for (const d of damages) dealt[d.team] += d.value
    world.set(Metrics, (m) => ({ damage0: (m.damage0 + dealt[0]) | 0, damage1: (m.damage1 + dealt[1]) | 0 }))
  }

  const effects = () => {
    const expired: [Entity, typeof Stun | typeof Haste][] = []
    const dying: Entity[] = []
    world.query(Stun).updateEach(([b], e) => { if (--b.ticksLeft === 0) expired.push([e, Stun]) })
    world.query(Haste).updateEach(([b], e) => { if (--b.ticksLeft === 0) expired.push([e, Haste]) })
    const burnedOut: Entity[] = []
    world.query(Burn, Health).updateEach(([b, h], e) => {
      b.ticksLeft--
      if (b.ticksLeft % k.BURN_INTERVAL === 0) {
        h.hp -= k.BURN_DAMAGE
        if (h.hp <= 0) dying.push(e)
      }
      if (b.ticksLeft === 0) burnedOut.push(e)
    })
    for (const [e, buff] of expired) e.remove(buff)
    for (const e of burnedOut) e.remove(Burn)
    for (const e of dying) if (!e.has(Dead)) e.add(Dead)

    if (tickNow() % k.THREAT_DECAY_PERIOD === 0) {
      const gone: [Entity, Entity][] = []
      for (const victim of world.query(Threat('*'))) {
        for (const attacker of victim.targetsFor(Threat)) {
          const amount = victim.get(Threat(attacker))!.amount
          const left = amount - Math.max(1, fx.div(amount, 4))
          if (left <= 0) gone.push([victim, attacker])
          else victim.set(Threat(attacker), { amount: left })
        }
      }
      for (const [victim, attacker] of gone) victim.remove(Threat(attacker))
    }
  }

  const morale = () => {
    const lost = new Map<Entity, number>()
    const lose = (e: Entity, n: number) => lost.set(e, (lost.get(e) ?? 0) + n)
    for (const d of world.query(Dead)) {
      if (d.has(Morale)) lose(d, 1)
      else {
        const parent = d.targetFor(MemberOf)
        if (parent?.has(Morale)) lose(parent, 1)
      }
    }
    for (const leader of world.query(Morale, MemberOf('*'))) {
      if (leader.targetFor(MemberOf)!.has(Dead)) lose(leader, k.WARLORD_LOSS)
    }
    for (const [e, n] of lost) e.set(Morale, (m) => ({ lost: m.lost + n }))

    const [num, den] = k.ROUT_LOST_PER_SIZE
    const routing: Entity[] = []
    world.query(Morale, Not(Routed)).readEach(([m], e) => { if (m.lost * den >= m.size0 * num) routing.push(e) })
    for (const e of routing) e.add(Routed)

    const routed = new Set(world.query(newlyRouted))
    if (routed.size > 0) {
      const flee: Entity[] = []
      for (const e of routed) if (!e.has(Dead) && !e.has(Fleeing)) flee.push(e)
      for (const m of world.query(MemberOf('*'), Not(Morale), Not(Fleeing), Not(Dead))) {
        if (routed.has(m.targetFor(MemberOf)!)) flee.push(m)
      }
      for (const e of flee) e.add(Fleeing)
    }

    for (const e of world.query(newlyFleeing)) {
      e.remove(Targets('*'))
      e.remove(Threat('*'))
      if (e.has(Morale)) e.remove(MemberOf('*'))
    }
  }

  const promote = (unit: Entity) => {
    const members = world.query(MemberOf(unit)).map((m) => ({ id: gid(m), e: m })).sort(byId)
    if (members.length === 0) return
    const [{ e: head }, ...rest] = members
    const headOffset = head.get(MemberOf(unit))!
    const parent = unit.targetFor(MemberOf)
    head.remove(MemberOf(unit))
    if (parent && !head.has(Fleeing)) head.add(MemberOf(parent, { ...unit.get(MemberOf(parent))! }))
    if (!head.has(Morale) && unit.has(Morale)) {
      head.add(Morale({ ...unit.get(Morale)! }))
      if (unit.has(Routed)) head.add(Routed)
    }
    for (const { e: m } of rest) {
      const o = m.get(MemberOf(unit))!
      m.add(MemberOf(head, { offsetX: o.offsetX - headOffset.offsetX, offsetY: o.offsetY - headOffset.offsetY }))
    }
  }

  const cleanup = () => {
    const kills = [0, 0]

    const leaving = sortedByGameId(Dead)
    world.query(Fleeing, GameId, Position, Team, Not(Dead)).readEach(([g, p, t], e) => {
      if (p.x === homeX(t.value)) leaving.push({ id: g.id, e })
    })
    leaving.sort(byId)

    for (const { e } of leaving) {
      if (!e.isAlive()) continue
      if (e.has(Dead)) {
        if (e.get(Kind)!.value !== KIND.MINION) kills[1 - e.get(Team)!.value]++
        const killer = e.targetFor(LastHitBy)
        if (killer) {
          killer.set(KillCount, (c) => ({ value: c.value + 1 }))
          if (killer.has(Veteran)) {
            const chronicle = killer.get(Chronicle)!.kinds
            chronicle.push(e.get(Kind)!.value)
            if (chronicle.length > k.CHRONICLE_MAX) chronicle.shift()
          }
        }
        const first = e.targetsFor(Equips).map((item) => ({ id: gid(item), e: item })).sort(byId)[0]?.e
        if (first) {
          const quality = e.get(Equips(first))!.quality
          const pos = e.get(Position)!
          e.remove(Equips(first))
          first.add(Ground({ quality }), Position({ x: pos.x, y: pos.y }), Age)
        }
      }
      promote(e)
      // The remaining items and the minions of the unit go with it (autoDestroy on Equips and ChildOf).
      e.destroy()
    }

    const oldMinions: Entity[] = []
    world.query(Minion, Age).readEach(([age], e) => { if (age.value >= k.MINION_LIFETIME) oldMinions.push(e) })
    for (const e of oldMinions) e.destroy()

    const doneProjectiles: Entity[] = []
    world.query(Projectile, Age).readEach(([, age], e) => {
      if (e.has(Spent) || !e.targetFor(Targets) || age.value >= k.PROJECTILE_LIFETIME) doneProjectiles.push(e)
    })
    for (const e of doneProjectiles) e.destroy()

    const ground = sortedByGameId(Ground)
    if (ground.length > 0) {
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
        g.e.remove(Ground, Position, Age)
      }
    }

    const old: Entity[] = []
    world.query(Ground, Age).readEach(([, age], e) => { if (age.value >= k.GROUND_ITEM_LIFETIME) old.push(e) })
    for (const e of old) e.destroy()

    world.set(Metrics, (m) => ({ kills0: m.kills0 + kills[0], kills1: m.kills1 + kills[1] }))
  }

  const objectives = () => {
    const grid = buildGrid()
    const shrines = sortedByGameId(Shrine)
    for (const { e } of shrines) {
      const pos = e.get(Position)!
      const count = [0, 0]
      forNear(grid, pos.x, pos.y, k.SHRINE_RADIUS, (v) => {
        if (inRange(pos.x, pos.y, v.x, v.y, k.SHRINE_RADIUS) && !v.fleeing) count[v.team]++
      })
      const step = Math.max(-k.SHRINE_STEP_MAX, Math.min(k.SHRINE_STEP_MAX, count[0] - count[1]))
      e.set(Shrine, (s) => {
        const progress = Math.max(-k.SHRINE_PROGRESS_MAX, Math.min(k.SHRINE_PROGRESS_MAX, s.progress + step))
        return { progress, owner: progress === k.SHRINE_PROGRESS_MAX ? 0 : progress === -k.SHRINE_PROGRESS_MAX ? 1 : s.owner }
      })
    }
    const owned = [0, 0]
    world.query(Shrine).readEach(([s]) => { if (s.owner >= 0) owned[s.owner]++ })
    world.set(Score, { shrines0: owned[0], shrines1: owned[1] })
  }

  const stats = () => {
    const candidates: Entity[] = []
    world.query(killsChanged).readEach(([c], e) => { if (c.value >= k.VETERAN_KILLS) candidates.push(e) })
    for (const e of candidates) e.add(Veteran)
    for (const e of world.query(newlyVeteran)) e.add(Chronicle({ kinds: [k.PROMOTION_MARK] }))

    for (const e of dirty) if (e.isAlive()) recomputeStats(e)
    dirty.clear()

    const alive = [0, 0]
    world.query(teamQuery).readEach(([t]) => { alive[t.value]++ })
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

  const snapshot = (): CanonicalState => {
    const m = world.get(Metrics)!, score = world.get(Score)!
    const s: number[] = [tickNow(), m.alive0, m.alive1, m.kills0, m.kills1, m.damage0, m.damage1, m.winner, score.shrines0, score.shrines1]

    const shrines = sortedByGameId(Shrine)
    s.push(shrines.length)
    for (const { id, e } of shrines) {
      const sh = e.get(Shrine)!
      s.push(id, sh.owner, sh.progress)
    }

    const units = sortedByGameId(Unit)
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
      const items = e.targetsFor(Equips).map((item) => ({ id: gid(item), e: item })).sort(byId)
      s.push(items.length)
      for (const it of items) s.push(it.id, it.e.get(ItemKind)!.value, e.get(Equips(it.e))!.quality)
      const hitBy = e.targetFor(LastHitBy)
      s.push((e.has(Fleeing) ? 1 : 0) | (e.has(Veteran) ? 2 : 0) | (e.has(Routed) ? 4 : 0), e.get(KillCount)!.value, hitBy ? gid(hitBy) : -1)
      const morale = e.get(Morale)
      s.push(morale ? morale.size0 : -1, morale ? morale.lost : -1)
      const edges = e.targetsFor(Threat).map((a) => ({ id: gid(a), amount: e.get(Threat(a))!.amount })).sort(byId)
      s.push(edges.length)
      for (const edge of edges) s.push(edge.id, edge.amount)
      const chronicle = e.get(Chronicle)?.kinds ?? []
      s.push(chronicle.length, ...chronicle)
    }

    const projectiles = sortedByGameId(Projectile)
    s.push(projectiles.length)
    for (const { id, e } of projectiles) {
      const p = e.get(Position)!, pr = e.get(Projectile)!, t = e.targetFor(Targets)
      s.push(id, pr.owner, t ? gid(t) : -1, p.x, p.y, e.get(Age)!.value, pr.speed, pr.volley)
    }

    const ground = sortedByGameId(Ground)
    s.push(ground.length)
    for (const { id, e } of ground) {
      const p = e.get(Position)!
      s.push(id, e.get(ItemKind)!.value, e.get(Ground)!.quality, p.x, p.y, e.get(Age)!.value)
    }
    return s
  }

  return {
    phases: { spawn, 'ai/target': aiTarget, move, combat, effects, morale, cleanup, objectives, stats },
    snapshot,
  }
}

export default createSim
