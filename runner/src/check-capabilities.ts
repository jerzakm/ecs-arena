// Checks that every `path#L<n>` or `path#L<n>-L<m>` link in impls/*/CAPABILITIES.md points to an existing line.
// Usage: pnpm run check:caps
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = resolve(import.meta.dirname, '../..')

export const checkCaps = (implsDir = resolve(ROOT, 'impls')): string[] => {
  const errors: string[] = []
  for (const impl of readdirSync(implsDir)) {
    const doc = resolve(implsDir, impl, 'CAPABILITIES.md')
    if (!existsSync(doc)) continue
    const lines = new Map<string, number>()
    const count = (file: string) => {
      if (!lines.has(file)) lines.set(file, existsSync(file) ? readFileSync(file, 'utf8').split('\n').length - 1 : -1)
      return lines.get(file)!
    }
    for (const [, path, from, to] of readFileSync(doc, 'utf8').matchAll(/\]\(([^)#\s]+)#L(\d+)(?:-L(\d+))?\)/g)) {
      const n = count(resolve(implsDir, impl, path))
      const last = Number(to ?? from)
      if (n < 0) errors.push(`${impl}: ${path} does not exist`)
      else if (Number(from) < 1 || last < Number(from) || last > n) errors.push(`${impl}: ${path}#L${from}${to ? `-L${to}` : ''} is outside the file (${n} lines)`)
    }
  }
  return errors
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const errors = checkCaps()
  errors.forEach((e) => console.error(e))
  process.exit(errors.length ? 1 : 0)
}
