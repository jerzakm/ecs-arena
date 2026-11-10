import type { Snapshot, Unit } from './snapshot.ts'

export type Anim = 'Idle' | 'Walk' | 'Attack' | 'Hurt' | 'Death'
export interface Actor {
  unit: Unit
  anim: Anim
  /** 1 faces right, -1 faces left. */
  facing: 1 | -1
  /** Frames since the action (Attack/Hurt/Death) started, else 0. */
  frame: number
}

/**
 * Derives per-unit animation from consecutive snapshots. `frames(unit, anim)` is the strip's frame count
 * (strip width / 100); Attack, Hurt and Death hold that many updates, one frame per update.
 */
export class AnimTracker {
  private prev = new Map<number, Unit>()
  private facing = new Map<number, 1 | -1>()
  private ghosts = new Map<number, Actor>()
  private actions = new Map<number, { anim: 'Attack' | 'Hurt'; frame: number }>()

  constructor(private frames: (unit: Unit, anim: Anim) => number) {}

  update(cur: Pick<Snapshot, 'units'>): Actor[] {
    const actors: Actor[] = []
    const next = new Map<number, Unit>()
    for (const unit of cur.units) {
      const p = this.prev.get(unit.gameId)
      let facing = this.facing.get(unit.gameId) ?? 1
      if (p && unit.x !== p.x) facing = unit.x < p.x ? -1 : 1
      this.facing.set(unit.gameId, facing)
      let act = this.actions.get(unit.gameId)
      if (act && ++act.frame >= this.frames(unit, act.anim)) act = undefined
      if (p) {
        if (unit.cooldown > p.cooldown) act = { anim: 'Attack', frame: 0 }
        else if (unit.hp < p.hp && act?.anim !== 'Attack') act = { anim: 'Hurt', frame: 0 }
      }
      if (act) this.actions.set(unit.gameId, act)
      else this.actions.delete(unit.gameId)
      let anim: Anim = 'Idle'
      if (act) anim = act.anim
      else if (p && (unit.x !== p.x || unit.y !== p.y)) anim = 'Walk'
      next.set(unit.gameId, unit)
      actors.push({ unit, anim, facing, frame: act?.frame ?? 0 })
    }
    for (const [id, unit] of this.prev) {
      if (!next.has(id)) this.actions.delete(id)
      if (!next.has(id)) this.ghosts.set(id, { unit, anim: 'Death', facing: this.facing.get(id) ?? 1, frame: -1 })
    }
    for (const [id, g] of this.ghosts) {
      g.frame++
      if (g.frame >= this.frames(g.unit, 'Death')) {
        this.ghosts.delete(id)
        this.facing.delete(id)
      } else actors.push(g)
    }
    this.prev = next
    return actors
  }
}
