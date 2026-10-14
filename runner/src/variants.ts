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

/** Idempotent: worktree at .worktrees/<variant>, detached at origin/<ref> (else local <ref>), publish package built. Returns the built package root. */
export const ensureVariant = (name: string): string => {
  const cfg = loadVariants()[name]
  if (!cfg) throw new Error(`unknown variant ${name} (see runner/variants.json)`)
  const repo = cfg.repo.replace(/^~/, homedir())
  const slug = name.replace(/[^\w.-]/g, '-')
  const wt = resolve(ROOT, '.worktrees', slug)
  try { sh('git', ['fetch', '--quiet'], repo) } catch { /* local-only checkout is fine */ }
  let rev = cfg.ref
  try { rev = out('git', ['rev-parse', '--verify', '--quiet', `origin/${cfg.ref}`], repo) } catch { /* no remote ref: use local */ }
  const sha = out('git', ['rev-parse', rev], repo)
  if (!existsSync(wt)) sh('git', ['worktree', 'add', '--detach', wt, sha], repo)
  else {
    if (out('git', ['status', '--porcelain'], wt)) throw new Error(`variant worktree ${wt} is dirty; clean or delete it`)
    if (out('git', ['rev-parse', 'HEAD'], wt) !== sha) sh('git', ['checkout', '--detach', sha], wt)
  }
  const root = resolve(wt, 'packages/publish')
  const stamp = resolve(ROOT, '.worktrees', `${slug}.built`) // outside the worktree so it never dirties it
  if (!existsSync(resolve(root, 'dist/index.js')) || !existsSync(stamp) || readFileSync(stamp, 'utf8') !== sha) {
    sh('pnpm', ['install', '--frozen-lockfile'], wt)
    sh('pnpm', ['-F', 'koota', 'build'], wt)
    sh('git', ['checkout', '--quiet', '--', '.'], wt) // build rewrites tracked files (README); worktree was clean, so restore it
    writeFileSync(stamp, sha)
  }
  return root
}
