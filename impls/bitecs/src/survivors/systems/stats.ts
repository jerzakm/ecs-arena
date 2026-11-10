import { query } from 'bitecs'
import { survivors } from '@ecs-arena/spec'
import { Mob, Particle, Pickup, Player, Position, Projectile } from '../components.ts'
import { GameId } from '../../shared/components.ts'
import type { Ctx } from '../context.ts'
import { Q } from '../queries.ts'
const { RENDER_KIND, RENDER_STRIDE, CAMERA_HALF: CAM, STATUS } = survivors.kernel
const VIEWED = [Q.mobs, Q.projs, Q.pickups, Q.parts]
export const statsSystems: Pick<survivors.SystemTable<Ctx>, 'stats.render'> = {
  'stats.render': (ctx) => {
    let buf = new Int32Array(0)
    return () => {
      const { k, world, totals, player, px, py } = ctx
      totals.alive = query(ctx.world, Q.mobs).length
      // The camera window picks the entities first, so only those are sorted by gameId.
      const inView = (e: number) => Math.abs(Position.x[e] - px) <= CAM && Math.abs(Position.y[e] - py) <= CAM
      // A row is `entity * 4 + type`, the type being the index in the list of queries.
      const rows: number[] = []
      VIEWED.forEach((terms, type) => { for (const e of query(ctx.world, terms)) if (inView(e)) rows.push(e * 4 + type) })
      rows.sort((a, b) => GameId.id[a >> 2] - GameId.id[b >> 2])
      const need = 1 + RENDER_STRIDE * (1 + rows.length)
      if (buf.length < need) buf = new Int32Array(Math.max(need, 2 * buf.length))
      let at = 1
      const iframes = Player.iframes[player]
      buf[at++] = k.PLAYER_ID; buf[at++] = RENDER_KIND.PLAYER; buf[at++] = Position.x[player]; buf[at++] = Position.y[player]
      buf[at++] = k.hpByte(Player.hp[player], k.maxHp(ctx.loadout.stats.vigor)); buf[at++] = iframes ? k.bit(STATUS.IFRAMES) : 0
      for (const row of rows) {
        const e = row >> 2, type = row & 3
        let code: number, hb = 0, fl = 0
        if (type === 0) { code = Mob.kind[e]; hb = k.hpByte(Mob.hp[e], k.mobMaxHp(Mob.kind[e], Mob.flags[e])); fl = Mob.flags[e] }
        else if (type === 1) {
          code = Projectile.weapon[e] === -1 ? RENDER_KIND.PROJECTILE : RENDER_KIND.PROJECTILE + Projectile.weapon[e] + 1
          fl = Projectile.traits[e]
        }
        else if (type === 2) code = RENDER_KIND.PICKUP + Pickup.kind[e]
        else code = RENDER_KIND.PARTICLE + Particle.kind[e]
        buf[at++] = GameId.id[e]; buf[at++] = code; buf[at++] = Position.x[e]; buf[at++] = Position.y[e]; buf[at++] = hb; buf[at++] = fl
      }
      buf[0] = (at - 1) / RENDER_STRIDE
      totals.renderChain = k.foldRender(totals.renderChain, buf, at)
      totals.tick = world.tick
      world.tick++
    }
  },
}
