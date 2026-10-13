import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

export interface VariantConfig {
  repo: string
  ref: string
}

/** `koota@main` -> impl `koota`, variant `koota@main`. Plain `koota` has no variant. */
export const parseTarget = (target: string): { impl: string; variant?: string } => {
  const i = target.indexOf('@')
  return i < 0 ? { impl: target } : { impl: target.slice(0, i), variant: target }
}

export const loadVariants = (): Record<string, VariantConfig> =>
  JSON.parse(readFileSync(resolve(ROOT, 'runner/variants.json'), 'utf8'))

const sh = (cmd: string, args: string[], cwd: string) =>
  execFileSync(cmd, args, { cwd, stdio: ['ignore', 'inherit', 'inherit'] })
const out = (cmd: string, args: string[], cwd: string) =>
  execFileSync(cmd, args, { cwd, encoding: 'utf8' }).trim()

/** Idempotent: worktree at .worktrees/<ref>, detached at the ref's current commit, publish package built. Returns the built entry file. */
export const ensureVariant = (name: string): string => {
  const cfg = loadVariants()[name]
  if (!cfg) throw new Error(`unknown variant ${name} (see runner/variants.json)`)
  const repo = cfg.repo.replace(/^~/, homedir())
  const wt = resolve(ROOT, '.worktrees', cfg.ref.replace(/[^\w.-]/g, '-'))
  try { sh('git', ['fetch', '--quiet'], repo) } catch { /* local-only checkout is fine */ }
  const sha = out('git', ['rev-parse', cfg.ref], repo)
  if (!existsSync(wt)) sh('git', ['worktree', 'add', '--detach', wt, sha], repo)
  else if (out('git', ['rev-parse', 'HEAD'], wt) !== sha) sh('git', ['checkout', '--detach', sha], wt)
  const entry = resolve(wt, 'packages/publish/dist/index.js')
  const stamp = resolve(wt, '.ecs-arena-built')
  if (!existsSync(entry) || !existsSync(stamp) || readFileSync(stamp, 'utf8') !== sha) {
    sh('pnpm', ['install', '--frozen-lockfile'], wt)
    sh('pnpm', ['-F', 'koota', 'build'], wt)
    writeFileSync(stamp, sha)
  }
  return entry
}
