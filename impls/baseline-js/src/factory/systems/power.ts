import type { Ctx } from '../context.ts'
import { markDirty } from '../entities.ts'
import type { Machine } from '../types.ts'

/** SPEC-factory §5.2. A machine with Manual never has Powered, so a toggle skips it. */
export const power = (ctx: Ctx) => {
  const { k, scenario, districts, nv } = ctx
  const set = (m: Machine, on: boolean): number => {
    if (m.manual || m.powered === on) return 0
    m.powered = on
    markDirty(ctx, m)
    return 1
  }
  // The normal code walks the machine list of the district. The naive code finds them by a scan of every machine.
  const viaList = (d: number, on: boolean): number => {
    let n = 0
    const list = districts[d]
    for (let i = 0; i < list.length; i++) n += set(list[i], on)
    return n
  }
  const viaScan = (d: number, on: boolean): number => {
    let n = 0
    const all = ctx.machines
    for (let i = 0; i < all.length; i++) if (all[i].district === d) n += set(all[i], on)
    return n
  }
  const toggle = nv['power.toggle'] ? viaScan : viaList
  return () => {
    const { tick } = ctx
    if (tick === 0 || tick % scenario.powerEvery !== 0) return
    let toggled = 0
    for (let d = 0; d < districts.length; d++) {
      const down = k.districtDown(scenario.seed, tick, d, scenario.outagePermille)
      if (down !== ctx.up[d]) continue
      ctx.up[d] = !down
      ctx.begin('power.toggle')
      toggled += toggle(d, !down)
      ctx.end('power.toggle')
      ctx.add(down ? 'power.down' : 'power.up')
    }
    ctx.add('power.toggle', toggled)
  }
}
