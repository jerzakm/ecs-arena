import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkCaps, symbolsOf } from './check-capabilities.ts'

const fixture = (doc: string) => {
  const dir = mkdtempSync(join(tmpdir(), 'caps-'))
  mkdirSync(join(dir, 'x/src'), { recursive: true })
  writeFileSync(join(dir, 'x/src/a.ts'), 'export const one = 1\nexport const two = 2\n')
  writeFileSync(join(dir, 'x/CAPABILITIES.md'), doc)
  return dir
}

it('accepts every link in the committed CAPABILITIES.md files', () => {
  expect(checkCaps()).toEqual([])
})

it('reports a line past the end of the file and a missing file', () => {
  const dir = fixture('[ok](src/a.ts#L2) [bad](src/a.ts#L3) [range](src/a.ts#L1-L5) [gone](src/b.ts#L1)')
  expect(checkCaps(dir)).toHaveLength(3)
})

describe('symbols in the link text', () => {
  it('reads the symbols and skips file names', () => {
    expect(symbolsOf('entities.ts L67')).toEqual([])
    expect(symbolsOf('src/rts/entities.ts createEntity L33')).toEqual(['createEntity'])
    expect(symbolsOf('`two` L2-L3')).toEqual(['two'])
  })

  it('accepts a symbol that is on the anchored line', () => {
    expect(checkCaps(fixture('[a.ts two L2](src/a.ts#L2) [`one` L1](src/a.ts#L1) [a.ts one two L1-L2](src/a.ts#L1-L2)'))).toEqual([])
  })

  it('reports a symbol that is on another line', () => {
    expect(checkCaps(fixture('[a.ts two L1](src/a.ts#L1)'))).toEqual([expect.stringContaining('src/a.ts#L1 does not hold two')])
  })

  it('does not take a longer name for the symbol', () => {
    expect(checkCaps(fixture('[a.ts on L1](src/a.ts#L1)'))).toHaveLength(1)
  })
})
