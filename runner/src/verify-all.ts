import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '../..')
const SMOKE = ['skirmish-smoke', 'battle-smoke', 'war-smoke']
const impls = readdirSync(resolve(ROOT, 'impls'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)

let failed = false
for (const impl of impls) {
  const r = spawnSync('pnpm', ['verify', impl, ...SMOKE], { cwd: ROOT, stdio: 'inherit' })
  if (r.status !== 0) failed = true
}
process.exit(failed ? 1 : 0)
