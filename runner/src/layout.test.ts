// The layout of docs/impl-conventions.md: each impl keeps one folder per game plus `shared/`, and a game never imports the other game.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { expect, it } from 'vitest'

const IMPLS = resolve(import.meta.dirname, '../../impls')
const GAMES = ['rts', 'survivors', 'factory']
const FOLDERS = [...GAMES, 'shared']

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : []
  })

const impls = readdirSync(IMPLS).filter((name) => statSync(join(IMPLS, name, 'src')).isDirectory())

it.each(impls)('%s keeps only the game folders and shared/ in src', (impl) => {
  const extra = readdirSync(join(IMPLS, impl, 'src')).filter((name) => !FOLDERS.includes(name))
  expect(extra).toEqual([])
})

it.each(impls)('%s has no import from one game folder into another, or from shared/ into a game', (impl) => {
  const src = join(IMPLS, impl, 'src')
  const folderOf = (file: string) => relative(src, file).split('/')[0]
  const bad: string[] = []
  for (const file of files(src)) {
    const from = folderOf(file)
    for (const [, spec] of readFileSync(file, 'utf8').matchAll(/from\s+'(\.{1,2}\/[^']+)'/g)) {
      const to = folderOf(resolve(dirname(file), spec))
      if (to !== from && to !== 'shared') bad.push(`${relative(src, file)} -> ${spec}`)
    }
  }
  expect(bad).toEqual([])
})
