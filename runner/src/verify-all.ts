import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { GAMES } from '@ecs-arena/spec'
import { implEntry } from './games.ts'
const ROOT = resolve(import.meta.dirname, '../..')
const impls = readdirSync(resolve(ROOT, 'impls'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
let failed = false
for (const impl of impls)
  for (const game of GAMES) {
    // An impl with no entry for a game does not play it. That is a skip, not a failure.
    if (!existsSync(implEntry(impl, game))) { console.log(`skip ${impl} ${game.id}: no entry`); continue }
    const smoke = Object.keys(game.scenarios).filter((n) => n.endsWith('-smoke'))
    const r = spawnSync('pnpm', ['verify', impl, ...smoke], { cwd: ROOT, stdio: 'inherit' })
    if (r.status !== 0) failed = true
  }
process.exit(failed ? 1 : 0)
