import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { checkCaps } from './check-capabilities.ts'

it('accepts every link in the committed CAPABILITIES.md files', () => {
  expect(checkCaps()).toEqual([])
})

it('reports a line past the end of the file and a missing file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'caps-'))
  mkdirSync(join(dir, 'x/src'), { recursive: true })
  writeFileSync(join(dir, 'x/src/a.ts'), 'one\ntwo\n')
  writeFileSync(join(dir, 'x/CAPABILITIES.md'), '[ok](src/a.ts#L2) [bad](src/a.ts#L3) [range](src/a.ts#L1-L5) [gone](src/b.ts#L1)')
  expect(checkCaps(dir)).toHaveLength(3)
})
