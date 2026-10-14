export const alphaOf = (elapsedMs: number, intervalMs: number) =>
  intervalMs <= 0 ? 1 : Math.min(1, Math.max(0, elapsedMs / intervalMs))

interface Pos { gameId: number, x: number, y: number }

/** Aligns the previous snapshot's positions to the current list, so a frame lerps by index with no lookups. */
export class PosTrack {
  private idx = new Map<number, number>()
  private cur = new Float32Array(0)
  private prev = new Float32Array(0)

  update<T>(items: T[], get: (t: T) => Pos) {
    const n = items.length
    const oldIdx = this.idx, oldXY = this.cur
    const cur = new Float32Array(n * 2), prev = new Float32Array(n * 2)
    const idx = new Map<number, number>()
    for (let i = 0; i < n; i++) {
      const p = get(items[i])
      const j = oldIdx.get(p.gameId)
      cur[2 * i] = p.x
      cur[2 * i + 1] = p.y
      prev[2 * i] = j === undefined ? p.x : oldXY[2 * j]
      prev[2 * i + 1] = j === undefined ? p.y : oldXY[2 * j + 1]
      idx.set(p.gameId, i)
    }
    this.idx = idx
    this.cur = cur
    this.prev = prev
  }

  at(i: number, alpha: number, out: { x: number, y: number }) {
    const px = this.prev[2 * i], py = this.prev[2 * i + 1]
    out.x = px + (this.cur[2 * i] - px) * alpha
    out.y = py + (this.cur[2 * i + 1] - py) * alpha
  }

  reset() {
    this.idx = new Map()
    this.cur = new Float32Array(0)
    this.prev = new Float32Array(0)
  }
}
