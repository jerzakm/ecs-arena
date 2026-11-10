// iris entity ids are large encoded numbers, and the kernel `SpatialGrid` wants dense small handles. This table gives each tracked
// entity a handle (reused after `untrack`) and maps the handle back to the entity, its gameId and one int `tagAt` (the team in the RTS,
// the kind in survivors).
import type { EntityId } from 'iris-ecs'
import { SpatialGrid } from '@ecs-arena/spec'

/** The kernel `SpatialGrid` plus the handle table in front of it. Only this class writes the table. Systems read it and query `grid`. */
export class HandleGrid {
  readonly grid = new SpatialGrid()
  readonly entityAt: EntityId[] = [] // handle -> entity
  readonly tagAt: number[] = [] // handle -> team (RTS) or kind (survivors)
  readonly idAt: number[] = [] // handle -> gameId
  readonly inGrid: boolean[] = [] // handle -> the entity is in the grid (a garrisoned RTS unit is not)
  readonly handleOf = new Map<EntityId, number>() // entity -> handle
  private readonly freeHandles: number[] = []
  private handles = 0

  /** Gives an entity a handle and puts it in the grid. */
  track(e: EntityId, gameId: number, tag: number, x: number, y: number): void {
    const h = this.freeHandles.pop() ?? this.handles++
    this.handleOf.set(e, h)
    this.entityAt[h] = e
    this.tagAt[h] = tag
    this.idAt[h] = gameId
    this.grid.add(h, gameId, x, y)
    this.inGrid[h] = true
  }

  /** Takes an entity out of the grid and frees its handle. An entity that is not tracked is ignored. */
  untrack(e: EntityId): void {
    const h = this.handleOf.get(e)
    if (h === undefined) return
    this.leave(e)
    this.handleOf.delete(e)
    this.freeHandles.push(h)
  }

  /** Takes a tracked entity out of the grid and keeps its handle: a unit in a garrison. */
  leave(e: EntityId): void {
    const h = this.handleOf.get(e)!
    if (this.inGrid[h]) this.grid.remove(h)
    this.inGrid[h] = false
  }

  /** Puts an entity that `leave` took out back in the grid. */
  rejoin(e: EntityId, x: number, y: number): void {
    const h = this.handleOf.get(e)!
    this.grid.add(h, this.idAt[h], x, y)
    this.inGrid[h] = true
  }

  /** Takes every entity out of the grid and forgets the handles. `load` calls it before it rebuilds the world. */
  clear(): void {
    for (const h of this.handleOf.values()) if (this.inGrid[h]) this.grid.remove(h)
    this.handleOf.clear()
    this.freeHandles.length = this.entityAt.length = this.tagAt.length = this.inGrid.length = this.idAt.length = this.handles = 0
  }
}
