import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { expect, it } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'alias-'))
const root = join(dir, 'koota')
mkdirSync(join(root, 'dist'), { recursive: true })
writeFileSync(join(root, 'dist/index.js'), 'export default "fake-koota"')
writeFileSync(join(root, 'dist/react.js'), 'export default "fake-react"')
writeFileSync(
  join(root, 'package.json'),
  JSON.stringify({
    type: 'module',
    exports: { '.': './nope.js' },
    publishConfig: {
      exports: { '.': { types: './x.d.ts', import: './dist/index.js' }, './react': { import: './dist/react.js' } },
    },
  }),
)

const run = (code: string) => {
  const probe = join(dir, 'probe.mjs')
  writeFileSync(probe, code)
  return execFileSync(process.execPath, ['--import', resolve(import.meta.dirname, 'alias-register.mjs'), probe], {
    env: { ...process.env, ECS_ALIAS: JSON.stringify({ koota: root }) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
    .toString()
    .trim()
}

it('resolves the package root and exported sub-paths into the aliased build', () => {
  expect(run('import k from "koota"; console.log(k)')).toBe('fake-koota')
  expect(run('import k from "koota/react"; console.log(k)')).toBe('fake-react')
})

it('fails loudly on an unmapped sub-path', () => {
  expect(() => run('import "koota/missing"')).toThrow(/koota\/missing is not exported/)
})
