import type { Ctx } from '../context.ts'
import { InDistrict, Lit, Manual, Powered, Totals } from '../traits.ts'
import { Not } from 'koota'

/**
 * SPEC-factory §5.2. A district entity holds the Lit tag. A machine reaches its district through the InDistrict relation,
 * and a Manual machine never has Powered, so the query for a restore skips it. The tags change after the query has been read.
 */
export const power = (ctx: Ctx) => {
  const { k, scenario, world, districts } = ctx
  return () => {
    const tick = world.get(Totals)!.tick + 1
    if (tick === 0 || tick % scenario.powerEvery !== 0) return
    for (let d = 0; d < districts.length; d++) {
      const down = k.districtDown(scenario.seed, tick, d, scenario.outagePermille)
      const district = districts[d]
      if (down !== district.has(Lit)) continue
      if (down) {
        district.remove(Lit)
        for (const m of world.query(InDistrict(district), Powered)) m.remove(Powered)
      } else {
        district.add(Lit)
        for (const m of world.query(InDistrict(district), Not(Manual))) m.add(Powered)
      }
    }
  }
}
