import {
  collectEntities, EXPERIMENTAL_queryColumns as queryColumns, getComponentValue, getResourceValue, hasComponent, setResourceValue,
} from 'iris-ecs'
import { survivors } from '@ecs-arena/spec'
import { IFrames, PlayerHp, Run } from '../components.ts'
import type { Ctx } from '../context.ts'
import { mobsAlive, renderMobs, renderParticles, renderPickups, renderProjs } from '../queries.ts'
import { flagsOf, traitsOf } from '../tags.ts'

const { RENDER_KIND, RENDER_STRIDE, CAMERA_HALF: CAM, STATUS } = survivors.kernel

export const statsSystems: Pick<survivors.SystemTable<Ctx>, 'stats.render'> = {
  'stats.render': (ctx) => () => {
    const { k, world, player, px, py } = ctx
    setResourceValue(world, Run, 'alive', collectEntities(world, mobsAlive).length)
    const flat: number[] = []
    const ids: number[] = []
    const row = (id: number, code: number, x: number, y: number, hpByte: number, flags: number) => {
      ids.push(id)
      flat.push(id, code, x, y, hpByte, flags)
    }
    const inWindow = (x: number, y: number) => !(x - px > CAM || px - x > CAM || y - py > CAM || py - y > CAM)
    const hpByte = k.hpByte(getComponentValue(world, player, PlayerHp, 'hp')!, k.maxHp(ctx.loadout.stats.vigor))
    row(k.PLAYER_ID, RENDER_KIND.PLAYER, px, py, hpByte, hasComponent(world, player, IFrames) ? 1 << STATUS.IFRAMES : 0)
    queryColumns(world, renderMobs, (entities, [id, kind, pos, hp]) => {
      // The tags are the same for the whole archetype, so one read gives the flags of every mob in it.
      const flags = flagsOf(world, entities[0])
      for (let i = 0; i < entities.length; i++) {
        if (!inWindow(pos.x[i], pos.y[i])) continue
        row(id.id[i], kind.value[i], pos.x[i], pos.y[i], k.hpByte(hp.hp[i], k.mobMaxHp(kind.value[i], flags)), flags)
      }
    })
    queryColumns(world, renderProjs, (entities, [proj, id, pos]) => {
      const traits = traitsOf(world, entities[0])
      for (let i = 0; i < entities.length; i++) {
        if (!inWindow(pos.x[i], pos.y[i])) continue
        const code = proj.weapon[i] === -1 ? RENDER_KIND.PROJECTILE : RENDER_KIND.PROJECTILE + proj.weapon[i] + 1
        row(id.id[i], code, pos.x[i], pos.y[i], 0, traits)
      }
    })
    queryColumns(world, renderPickups, (entities, [pickup, id, pos]) => {
      for (let i = 0; i < entities.length; i++) {
        if (inWindow(pos.x[i], pos.y[i])) row(id.id[i], RENDER_KIND.PICKUP + pickup.kind[i], pos.x[i], pos.y[i], 0, 0)
      }
    })
    queryColumns(world, renderParticles, (entities, [part, id, pos]) => {
      for (let i = 0; i < entities.length; i++) {
        if (inWindow(pos.x[i], pos.y[i])) row(id.id[i], RENDER_KIND.PARTICLE + part.kind[i], pos.x[i], pos.y[i], 0, 0)
      }
    })
    const order = ids.map((_, i) => i).sort((a, b) => ids[a] - ids[b])
    const buf: number[] = [order.length]
    for (const i of order) for (let f = 0; f < RENDER_STRIDE; f++) buf.push(flat[i * RENDER_STRIDE + f])
    setResourceValue(world, Run, 'renderChain', k.foldRender(getResourceValue(world, Run, 'renderChain')!, buf, buf.length))
    setResourceValue(world, Run, 'tick', ctx.tick) // the last finished tick, for the snapshot header
    ctx.tick++
  },
}
