// Checks every `path#L<n>` or `path#L<n>-L<m>` link in impls/*/CAPABILITIES.md:
// 1. the lines exist in the file;
// 2. a symbol in the link text is on the linked lines. The text is `[<file> <symbol> L<n>]` or `[<symbol> L<n>]`, and a symbol may be in backticks.
//    A word that looks like a file (a `/` or an extension) is not a symbol, so `[entities.ts L67]` is checked for range only.
// Usage: pnpm run check:caps
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isMain } from './cli.ts'

const ROOT = resolve(import.meta.dirname, '../..')

const LINK = /\[([^\]]*)\]\(([^)#\s]+)#L(\d+)(?:-L(\d+))?\)/g
const LINE_SUFFIX = /\s*L\d+(?:-L\d+)?$/
const looksLikeFile = (word: string) => word.includes('/') || /\.\w+$/.test(word)

/** The words of a link text that name a symbol: the text without its `L<n>` suffix, minus backticks and file names. A text with no suffix names none. */
export const symbolsOf = (text: string): string[] =>
  LINE_SUFFIX.test(text) ? text.replace(LINE_SUFFIX, '').replaceAll('`', '').split(/\s+/).filter((w) => w && !looksLikeFile(w)) : []

const holds = (text: string, symbol: string) => new RegExp(`(?<![\\w$])${symbol.replaceAll('$', '\\$')}(?![\\w$])`).test(text)

export const checkCaps = (implsDir = resolve(ROOT, 'impls')): string[] => {
  const errors: string[] = []
  for (const impl of readdirSync(implsDir)) {
    const doc = resolve(implsDir, impl, 'CAPABILITIES.md')
    if (!existsSync(doc)) continue
    const files = new Map<string, string[] | undefined>()
    const linesOf = (file: string) => {
      if (!files.has(file)) files.set(file, existsSync(file) ? readFileSync(file, 'utf8').split('\n') : undefined)
      return files.get(file)
    }
    for (const [, label, path, from, to] of readFileSync(doc, 'utf8').matchAll(LINK)) {
      const lines = linesOf(resolve(implsDir, impl, path))
      const first = Number(from)
      const last = Number(to ?? from)
      const where = `${impl}: ${path}#L${from}${to ? `-L${to}` : ''}`
      if (!lines) errors.push(`${impl}: ${path} does not exist`)
      else if (first < 1 || last < first || last > lines.length - 1) errors.push(`${where} is outside the file (${lines.length - 1} lines)`)
      else {
        const anchored = lines.slice(first - 1, last).join('\n')
        for (const symbol of symbolsOf(label))
          if (!holds(anchored, symbol)) errors.push(`${where} does not hold ${symbol}: ${lines[first - 1].trim().slice(0, 60)}`)
      }
    }
  }
  return errors
}

if (isMain(import.meta)) {
  const errors = checkCaps()
  errors.forEach((e) => console.error(e))
  process.exit(errors.length ? 1 : 0)
}
