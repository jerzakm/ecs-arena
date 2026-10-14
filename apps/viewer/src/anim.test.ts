import { describe, expect, it } from 'vitest'
import { AnimTracker } from './anim.ts'
import type { Unit } from './snapshot.ts'

const u = (o: Partial<Unit> & { gameId: number }): Unit => ({ team: 0, kind: 0, x: 100, y: 100, hp: 10, maxHp: 10, cooldown: 0, flags: 0, buffs: [], ...o })
const snap = (...units: Unit[]) => ({ units })
const get = (a: ReturnType<AnimTracker['update']>, id: number) => a.find((x) => x.unit.gameId === id)!

describe('AnimTracker', () => {
  it('is Idle on the first snapshot and when nothing changes', () => {
    const t = new AnimTracker(() => 4)
    expect(get(t.update(snap(u({ gameId: 1 }))), 1).anim).toBe('Idle')
    expect(get(t.update(snap(u({ gameId: 1 }))), 1).anim).toBe('Idle')
  })
  it('Walk on x or y change, facing flips when x decreases and persists', () => {
    const t = new AnimTracker(() => 4)
    t.update(snap(u({ gameId: 1 })))
    let a = get(t.update(snap(u({ gameId: 1, x: 90 }))), 1)
    expect(a).toMatchObject({ anim: 'Walk', facing: -1 })
    a = get(t.update(snap(u({ gameId: 1, x: 90, y: 95 }))), 1)
    expect(a).toMatchObject({ anim: 'Walk', facing: -1 })
    a = get(t.update(snap(u({ gameId: 1, x: 95, y: 95 }))), 1)
    expect(a).toMatchObject({ anim: 'Walk', facing: 1 })
    a = get(t.update(snap(u({ gameId: 1, x: 95, y: 95 }))), 1)
    expect(a).toMatchObject({ anim: 'Idle', facing: 1 })
  })
  it('Attack when cooldown jumps up, not when it ticks down', () => {
    const t = new AnimTracker(() => 4)
    t.update(snap(u({ gameId: 1, cooldown: 0 })))
    expect(get(t.update(snap(u({ gameId: 1, cooldown: 5 }))), 1).anim).toBe('Attack')
    expect(get(t.update(snap(u({ gameId: 1, cooldown: 4 }))), 1).anim).toBe('Attack')
  })
  it('Attack starts at frame 0, holds for the strip length, then returns to Walk/Idle', () => {
    const t = new AnimTracker((_u, anim) => (anim === 'Attack' ? 3 : 4))
    t.update(snap(u({ gameId: 1 })))
    for (let i = 0; i < 3; i++) {
      const a = get(t.update(snap(u({ gameId: 1, cooldown: i === 0 ? 5 : 4 - i }))), 1)
      expect(a).toMatchObject({ anim: 'Attack', frame: i })
    }
    expect(get(t.update(snap(u({ gameId: 1, x: 90 }))), 1)).toMatchObject({ anim: 'Walk', frame: 0 })
    t.update(snap(u({ gameId: 1, x: 90, cooldown: 5 })))
    for (let i = 0; i < 2; i++) t.update(snap(u({ gameId: 1, x: 90 })))
    expect(get(t.update(snap(u({ gameId: 1, x: 90 }))), 1)).toMatchObject({ anim: 'Idle', frame: 0 })
  })
  it('Attack outranks Hurt in the same tick', () => {
    const t = new AnimTracker(() => 3)
    t.update(snap(u({ gameId: 1 })))
    expect(get(t.update(snap(u({ gameId: 1, hp: 5, cooldown: 5 }))), 1)).toMatchObject({ anim: 'Attack', frame: 0 })
  })
  it('Hurt does not cut a playing Attack', () => {
    const t = new AnimTracker(() => 3)
    t.update(snap(u({ gameId: 1 })))
    t.update(snap(u({ gameId: 1, cooldown: 5 })))
    expect(get(t.update(snap(u({ gameId: 1, hp: 5, cooldown: 4 }))), 1)).toMatchObject({ anim: 'Attack', frame: 1 })
  })
  it('a new Attack restarts at frame 0', () => {
    const t = new AnimTracker(() => 3)
    t.update(snap(u({ gameId: 1 })))
    t.update(snap(u({ gameId: 1, cooldown: 5 })))
    t.update(snap(u({ gameId: 1, cooldown: 4 })))
    expect(get(t.update(snap(u({ gameId: 1, cooldown: 9 }))), 1)).toMatchObject({ anim: 'Attack', frame: 0 })
  })
  it('Hurt plays from frame 0 for its strip length', () => {
    const t = new AnimTracker(() => 2)
    t.update(snap(u({ gameId: 1 })))
    expect(get(t.update(snap(u({ gameId: 1, hp: 5 }))), 1)).toMatchObject({ anim: 'Hurt', frame: 0 })
    expect(get(t.update(snap(u({ gameId: 1, hp: 5 }))), 1)).toMatchObject({ anim: 'Hurt', frame: 1 })
    expect(get(t.update(snap(u({ gameId: 1, hp: 5 }))), 1).anim).toBe('Idle')
  })
  it('Hurt when hp drops, and beats Walk', () => {
    const t = new AnimTracker(() => 4)
    t.update(snap(u({ gameId: 1 })))
    expect(get(t.update(snap(u({ gameId: 1, hp: 7, x: 101 }))), 1).anim).toBe('Hurt')
  })
  it('keeps a vanished unit as a Death ghost for its strip length, then drops it', () => {
    const t = new AnimTracker((unit, anim) => (anim === 'Death' && unit.kind === 0 ? 3 : 4))
    t.update(snap(u({ gameId: 1, x: 50 }), u({ gameId: 2 })))
    for (let i = 0; i < 3; i++) {
      const a = t.update(snap(u({ gameId: 2 })))
      expect(get(a, 1)).toMatchObject({ anim: 'Death', frame: i })
      expect(get(a, 1).unit.x).toBe(50)
    }
    expect(t.update(snap(u({ gameId: 2 })))).toHaveLength(1)
  })
})
