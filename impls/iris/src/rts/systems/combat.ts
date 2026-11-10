import {
  addComponent, collectEntities, createEntity, defineSystem, type EntityId, EXPERIMENTAL_queryColumns as queryColumns, getComponentValue,
  getResourceValue, hasComponent, removeComponent, setComponentValue, setResourceValue,
} from 'iris-ecs'
import { GameId } from '../../shared/components.ts'
import {
  Age, Burn, Clock, Dead, FiredBy, Fleeing, Haste, Health, LastHitBy, Metrics, Overwhelmed, Position, Projectile, Spent, Stats, Stun,
  Targets, Team, Threat,
} from '../components.ts'
import type { Ctx } from '../context.ts'
import { nextId } from '../entities.ts'
import { setLink, targetOf } from '../links.ts'
import { attackers, cooldowns, overwhelmed, projectiles, targeting } from '../queries.ts'

interface Damage { victim: EntityId; victimId: number; attacker: EntityId | undefined; attackerId: number; team: number; value: number }
interface Incoming { damage: number; heal: number; stun: boolean; burn: boolean; haste: boolean }
interface Shot { id: number; j: number; targetId: number; x: number; y: number; team: number; kind: number; attack: number; crit: boolean }

export const combatSystem = (ctx: Ctx) => {
  const { k, world, scenario } = ctx
  const { KIND, BUFF, UNIT_STATS } = k
  const { seed } = scenario

  const setBuff = (e: EntityId, buff: typeof Stun | typeof Burn | typeof Haste, ticksLeft: number) => {
    if (hasComponent(world, e, buff)) setComponentValue(world, e, buff, 'ticksLeft', ticksLeft)
    else addComponent(world, e, buff, { ticksLeft })
  }

  return defineSystem('combat', () => {
    const tick = getResourceValue(world, Clock, 'tick')!
    const damages: Damage[] = []
    const incoming = new Map<EntityId, Incoming>()
    const incomingOf = (e: EntityId) => {
      let i = incoming.get(e)
      if (!i) incoming.set(e, i = { damage: 0, heal: 0, stun: false, burn: false, haste: false })
      return i
    }
    // Overwhelmed: 6 or more enemy units target the victim at the start of combat.
    const fanIn = new Map<EntityId, number>()
    queryColumns(world, targeting, (entities, [team, link]) => {
      for (let i = 0; i < entities.length; i++) {
        const v = ctx.entityOf.get(link.to[i]) // 0 is no link, and a destroyed target reads as none
        if (v !== undefined && team.value[i] !== getComponentValue(world, v, Team, 'value')!) fanIn.set(v, (fanIn.get(v) ?? 0) + 1)
      }
    })
    const over = new Set<EntityId>()
    for (const [v, n] of fanIn) if (n >= k.OVERWHELM_ATTACKERS) over.add(v)
    for (const e of collectEntities(world, overwhelmed)) if (!over.has(e)) removeComponent(world, e, Overwhelmed)
    for (const e of over) addComponent(world, e, Overwhelmed)

    const hurt = (victim: EntityId, attacker: EntityId | undefined, attackerId: number, team: number, value: number) => {
      if (over.has(victim)) value = k.overwhelmDamage(value)
      incomingOf(victim).damage += value
      damages.push({ victim, victimId: getComponentValue(world, victim, GameId, 'id')!, attacker, attackerId, team, value })
    }

    const spent: EntityId[] = []
    for (const e of collectEntities(world, projectiles)) {
      const t = targetOf(ctx, e, Targets)
      if (t === undefined) continue
      const px = getComponentValue(world, e, Position, 'x'), py = getComponentValue(world, e, Position, 'y')
      if (px !== getComponentValue(world, t, Position, 'x')! || py !== getComponentValue(world, t, Position, 'y')!) continue
      spent.push(e)
      const crit = getComponentValue(world, e, Projectile, 'crit') === 1
      const shooter = targetOf(ctx, e, FiredBy)
      const owner = getComponentValue(world, e, Projectile, 'owner'), ownerTeam = getComponentValue(world, e, Projectile, 'ownerTeam')
      const attack = getComponentValue(world, e, Projectile, 'attack')
      if (getComponentValue(world, e, Projectile, 'ownerKind') === KIND.MAGE) {
        ctx.units.grid.forNear(px, py, k.SPLASH_RADIUS, (h) => {
          if (ctx.units.tagAt[h] === ownerTeam) return
          const v = ctx.units.entityAt[h]
          hurt(v, shooter, owner, ownerTeam, k.damage(attack, getComponentValue(world, v, Stats, 'armor')!, crit))
          incomingOf(v).burn = true
        })
      } else {
        const armor = getComponentValue(world, t, Stats, 'armor')!
        const volley = getComponentValue(world, e, Projectile, 'volley')
        hurt(t, shooter, owner, ownerTeam, volley ? k.volleyDamage(attack, armor, crit) : k.damage(attack, armor, crit))
      }
    }
    for (const e of spent) addComponent(world, e, Spent)

    const shots: Shot[] = []
    queryColumns(world, attackers, (entities, [gameId, kindCol, teamCol, pos, statsCol, cooldown, targets]) => {
      for (let i = 0; i < entities.length; i++) {
        const kind = kindCol.value[i]
        if (cooldown.value[i] !== 0 || kind === KIND.SUMMONER) continue
        const t = ctx.entityOf.get(targets.to[i])
        if (t === undefined) continue
        const x = pos.x[i], y = pos.y[i]
        const tx = getComponentValue(world, t, Position, 'x')!, ty = getComponentValue(world, t, Position, 'y')!
        if (!k.inRange(x, y, tx, ty, UNIT_STATS[kind].range)) continue
        const id = gameId.id[i], team = teamCol.value[i], attack = statsCol.attack[i]
        const crit = k.isCrit(seed, tick, id)
        if (kind === KIND.WARRIOR || kind === KIND.MINION || kind === KIND.WARLORD) {
          hurt(t, entities[i], id, team, k.damage(attack, getComponentValue(world, t, Stats, 'armor')!, crit))
          if (crit && kind !== KIND.MINION) incomingOf(t).stun = true
        } else if (kind === KIND.MAGE || kind === KIND.ARCHER) {
          const volley = kind === KIND.ARCHER ? k.VOLLEY_SIZE : 1
          const targetId = getComponentValue(world, t, GameId, 'id')!
          for (let j = 0; j < volley; j++) shots.push({ id, j, targetId, x, y, team, kind, attack, crit })
        } else {
          const inc = incomingOf(t)
          inc.heal += attack
          inc.haste = true
        }
        cooldown.value[i] = UNIT_STATS[kind].cooldown
      }
    })
    shots.sort((a, b) => a.id - b.id || a.j - b.j)
    for (const s of shots) {
      const volley = s.kind === KIND.ARCHER
      createEntity(world, [
        [GameId, { id: nextId(ctx) }], [Position, { x: s.x, y: s.y }], [Age, { value: 0 }],
        [Projectile, {
          owner: s.id, ownerTeam: s.team, ownerKind: s.kind, attack: s.attack, crit: s.crit ? 1 : 0,
          speed: k.PROJECTILE_SPEED - (volley ? k.VOLLEY_SPEED_STEP * s.j : 0), volley: volley ? 1 : 0,
        }],
        [Targets, { to: s.targetId }], [FiredBy, { to: s.id }],
      ])
    }

    queryColumns(world, cooldowns, (entities, [cooldown]) => {
      for (let i = 0; i < entities.length; i++) if (cooldown.value[i] > 0) cooldown.value[i]--
    })

    for (const [e, inc] of incoming) {
      const maxHp = getComponentValue(world, e, Health, 'maxHp')!
      const hp = Math.min(maxHp, getComponentValue(world, e, Health, 'hp')! - inc.damage + inc.heal)
      setComponentValue(world, e, Health, 'hp', hp)
      if (hp <= 0) addComponent(world, e, Dead)
      if (inc.stun) setBuff(e, Stun, k.BUFF_DURATION[BUFF.STUN])
      if (inc.burn) setBuff(e, Burn, k.BUFF_DURATION[BUFF.BURN])
      if (inc.haste) setBuff(e, Haste, k.BUFF_DURATION[BUFF.HASTE])
    }

    damages.sort((a, b) => a.victimId - b.victimId || a.attackerId - b.attackerId)
    for (let i = 0; i < damages.length;) {
      const victim = damages[i].victim
      const sums: { attacker: EntityId; id: number; amount: number }[] = []
      for (; i < damages.length && damages[i].victim === victim; i++) {
        const { attacker, attackerId, value } = damages[i]
        if (attacker === undefined) continue
        const last = sums[sums.length - 1]
        if (last && last.id === attackerId) last.amount += value
        else sums.push({ attacker, id: attackerId, amount: value })
      }
      let top: (typeof sums)[number] | undefined
      for (const s of sums) if (!top || s.amount > top.amount) top = s
      if (top) setLink(ctx, victim, LastHitBy, top.attacker)
      if (hasComponent(world, victim, Fleeing)) continue
      const edges = getComponentValue(world, victim, Threat, 'edges')!
      // an edge to a destroyed attacker is no edge
      for (let n = edges.length - 2; n >= 0; n -= 2) if (!ctx.entityOf.has(edges[n])) edges.splice(n, 2)
      for (const s of sums) {
        let at = 0
        while (at < edges.length && edges[at] !== s.id) at += 2 // a flat list, so indexOf could match an amount
        if (at < edges.length) edges[at + 1] = Math.min(k.THREAT_CLAMP, edges[at + 1] + s.amount)
        else edges.push(s.id, Math.min(k.THREAT_CLAMP, s.amount))
      }
      while (edges.length > 2 * k.THREAT_MAX_EDGES) {
        let worst = 0
        for (let n = 2; n < edges.length; n += 2) {
          if (edges[n + 1] < edges[worst + 1] || (edges[n + 1] === edges[worst + 1] && edges[n] > edges[worst])) worst = n
        }
        edges.splice(worst, 2)
      }
    }

    const dealt = [0, 0]
    for (const d of damages) dealt[d.team] += d.value
    setResourceValue(world, Metrics, 'damage0', (getResourceValue(world, Metrics, 'damage0')! + dealt[0]) | 0)
    setResourceValue(world, Metrics, 'damage1', (getResourceValue(world, Metrics, 'damage1')! + dealt[1]) | 0)
  })
}
