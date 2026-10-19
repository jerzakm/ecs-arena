import type { EntityId } from 'iris-ecs'
import { SpatialGrid } from '@ecs-arena/spec'

/**
 * The kernel `SpatialGrid` plus a dense handle table in front of it: the grid stores small ints, and these arrays map a handle back to its unit.
 * Only this class writes the table. Systems read it and query `grid`.
 */
export class UnitGrid {
  readonly grid = new SpatialGrid()
  readonly unitAt: EntityId[] = [] // handle -> unit
  readonly teamAt: number[] = [] // handle -> team
  readonly idAt: number[] = [] // handle -> gameId
  readonly inGrid: boolean[] = [] // handle -> the unit is in the grid (a garrisoned unit is not)
  readonly handleOf = new Map<EntityId, number>() // unit -> handle
  private readonly freeHandles: number[] = []
  private handles = 0

  /** Gives a unit a handle and puts it in the grid. */
  track(e: EntityId, gameId: number, team: number, x: number, y: number): void {
    const h = this.freeHandles.pop() ?? this.handles++
    this.handleOf.set(e, h)
    this.unitAt[h] = e
    this.teamAt[h] = team
    this.idAt[h] = gameId
    this.grid.add(h, gameId, x, y)
    this.inGrid[h] = true
  }

  /** Takes a unit out of the grid and frees its handle. A unit that is not tracked is ignored. */
  untrack(e: EntityId): void {
    const h = this.handleOf.get(e)
    if (h === undefined) return
    this.leave(e)
    this.handleOf.delete(e)
    this.freeHandles.push(h)
  }

  /** Takes a tracked unit out of the grid and keeps its handle: a unit in a garrison. */
  leave(e: EntityId): void {
    const h = this.handleOf.get(e)!
    if (this.inGrid[h]) this.grid.remove(h)
    this.inGrid[h] = false
  }

  /** Puts a unit that `leave` took out back in the grid. */
  rejoin(e: EntityId, x: number, y: number): void {
    const h = this.handleOf.get(e)!
    this.grid.add(h, this.idAt[h], x, y)
    this.inGrid[h] = true
  }

  /** Takes every unit out of the grid and forgets the handles. `load` calls it before it rebuilds the world. */
  clear(): void {
    for (const h of this.handleOf.values()) if (this.inGrid[h]) this.grid.remove(h)
    this.handleOf.clear()
    this.freeHandles.length = this.unitAt.length = this.teamAt.length = this.inGrid.length = this.idAt.length = this.handles = 0
  }
}
