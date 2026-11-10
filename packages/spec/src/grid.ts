import { ARENA, distSq } from './kernel.ts'

const CELL = 16 * 1024
const N = Math.ceil(ARENA / CELL)
const cellOf = (v: number) => Math.min(N - 1, Math.max(0, Math.floor(v / CELL)))

/** Optional work-count hook. `add` accumulates, never read back. */
export interface GridCounters { add(name: string, n?: number): void }

/**
 * Shared spatial index over unit positions. The library owns entity data and picks a handle for each
 * entry: a dense non-negative int, unique while the entry is in the grid, reusable after `remove`.
 * The grid holds the position the library last passed to `add` or `update`, so a search sees every
 * move made before it. Visit order inside a cell is unspecified: break ties by `gameId`.
 */
export class SpatialGrid {
  private head = new Int32Array(N * N).fill(-1)
  private next = new Int32Array(0)
  private prev = new Int32Array(0)
  private cell = new Int32Array(0)
  private xs = new Int32Array(0)
  private ys = new Int32Array(0)
  private ids = new Uint32Array(0)
  private bestH = -1
  private bestD = 0
  private bestG = 0
  private accept: ((h: number) => boolean) | undefined

  constructor(private counters?: GridCounters) {}

  private grow(n: number) {
    let cap = Math.max(1024, this.next.length)
    while (cap <= n) cap *= 2
    const ext = <T extends Int32Array | Uint32Array>(a: T): T => { const b = new (a.constructor as new (n: number) => T)(cap); b.set(a); return b }
    this.next = ext(this.next); this.prev = ext(this.prev); this.cell = ext(this.cell)
    this.xs = ext(this.xs); this.ys = ext(this.ys); this.ids = ext(this.ids)
  }

  private link(h: number, c: number) {
    const first = this.head[c]
    this.next[h] = first
    this.prev[h] = -1
    if (first !== -1) this.prev[first] = h
    this.head[c] = h
    this.cell[h] = c
  }

  private unlink(h: number) {
    const p = this.prev[h], n = this.next[h]
    if (p === -1) this.head[this.cell[h]] = n
    else this.next[p] = n
    if (n !== -1) this.prev[n] = p
  }

  add(h: number, gameId: number, x: number, y: number) {
    if (h >= this.next.length) this.grow(h)
    this.ids[h] = gameId; this.xs[h] = x; this.ys[h] = y
    this.link(h, cellOf(y) * N + cellOf(x))
    this.counters?.add('grid.add')
  }

  /** Call for each entry that moved. Unmoved entries need no call. */
  update(h: number, x: number, y: number) {
    this.xs[h] = x; this.ys[h] = y
    const c = cellOf(y) * N + cellOf(x)
    if (c !== this.cell[h]) { this.unlink(h); this.link(h, c) }
    this.counters?.add('grid.update')
  }

  remove(h: number) {
    this.unlink(h)
    this.counters?.add('grid.remove')
  }

  /** Calls fn for each entry within squared distance r*r of (x, y). `label` names the query in counters. */
  forNear(x: number, y: number, r: number, fn: (h: number, d2: number, gameId: number) => void, label?: string) {
    const rr = r * r
    const cx0 = cellOf(x - r), cx1 = cellOf(x + r), cy1 = cellOf(y + r)
    let scanned = 0
    for (let cy = cellOf(y - r); cy <= cy1; cy++)
      for (let cx = cx0; cx <= cx1; cx++)
        for (let h = this.head[cy * N + cx]; h !== -1; h = this.next[h]) {
          scanned++
          const d2 = distSq(x, y, this.xs[h], this.ys[h])
          if (d2 <= rr) fn(h, d2, this.ids[h])
        }
    if (this.counters && label) { this.counters.add(`query.${label}`); this.counters.add(`query.${label}.scanned`, scanned) }
  }

  /** The handle of the entry nearest (x, y) within r that `accept` allows, a tie to the lowest gameId. -1 when none. */
  nearest(x: number, y: number, r: number, accept?: (h: number) => boolean, label?: string): number {
    this.bestH = -1
    this.accept = accept
    this.forNear(x, y, r, this.pick, label)
    return this.bestH
  }

  private pick = (h: number, d2: number, g: number) => {
    if (this.bestH !== -1 && (d2 > this.bestD || (d2 === this.bestD && g > this.bestG))) return
    if (this.accept && !this.accept(h)) return
    this.bestH = h; this.bestD = d2; this.bestG = g
  }
}
