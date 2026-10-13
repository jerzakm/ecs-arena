import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { expect, it } from 'vitest'

it('child resolves a bare specifier to the aliased path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'alias-'))
  const fake = join(dir, 'fake.mjs')
  writeFileSync(fake, 'export default "fake-koota"')
  const probe = join(dir, 'probe.mjs')
  writeFileSync(probe, 'import k from "koota"; console.log(k)')
  const out = execFileSync(process.execPath, ['--import', resolve(import.meta.dirname, 'alias-register.mjs'), probe], {
    env: { ...process.env, ECS_ALIAS: JSON.stringify({ koota: fake }) },
  })
  expect(out.toString().trim()).toBe('fake-koota')
})
