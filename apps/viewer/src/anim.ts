import type { Snapshot, Unit } from './snapshot.ts'

export type Anim = 'Idle' | 'Walk' | 'Attack' | 'Hurt' | 'Death'
export interface Actor {
  unit: Unit
  anim: Anim
  /** 1 faces right, -1 faces left. */
  facing: 1 | -1
  /** Ticks since death for a Death ghost, else 0. */
  frame: number
}

/**
 * Derives per-unit animation from consecutive snapshots. `deathFrames` is the Death strip's frame count
 * (strip width / 100); a ghost stays that many ticks.
 */
export class AnimTracker {
  private prev = new Map<number, Unit>()
  private facing = new Map<number, 1 | -1>()
  private ghosts = new Map<number, Actor>()

  constructor(private deathFrames: (unit: Unit) => number) {}

  update(cur: Pick<Snapshot, 'units'>): Actor[] {
    const actors: Actor[] = []
    const next = new Map<number, Unit>()
    for (const unit of cur.units) {
      const p = this.prev.get(unit.gameId)
      let facing = this.facing.get(unit.gameId) ?? 1
      if (p && unit.x !== p.x) facing = unit.x < p.x ? -1 : 1
      this.facing.set(unit.gameId, facing)
      let anim: Anim = 'Idle'
      if (p) {
        if (unit.hp < p.hp) anim = 'Hurt'
        else if (unit.cooldown > p.cooldown) anim = 'Attack'
        else if (unit.x !== p.x || unit.y !== p.y) anim = 'Walk'
      }
      next.set(unit.gameId, unit)
      actors.push({ unit, anim, facing, frame: 0 })
    }
    for (const [id, unit] of this.prev) {
      if (!next.has(id)) this.ghosts.set(id, { unit, anim: 'Death', facing: this.facing.get(id) ?? 1, frame: -1 })
    }
    for (const [id, g] of this.ghosts) {
      g.frame++
      if (g.frame >= this.deathFrames(g.unit)) {
        this.ghosts.delete(id)
        this.facing.delete(id)
      } else actors.push(g)
    }
    this.prev = next
    return actors
  }
}
