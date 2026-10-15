import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { findPackageJSON } from 'node:module'
import { pathToFileURL } from 'node:url'
import type { CreateSim } from '@ecs-arena/spec'
import { runChild } from './child.ts'

const ROOT = resolve(import.meta.dirname, '../..')
const [impl, name, kind] = process.argv.slice(2)
const implEntry = pathToFileURL(resolve(ROOT, 'impls', impl, 'src/index.ts')).href
const createSim = (await import(implEntry)).default as CreateSim

// Print which koota build the run uses, so a variant run is easy to confirm.
const usesKoota = 'koota' in (JSON.parse(readFileSync(resolve(ROOT, 'impls', impl, 'package.json'), 'utf8')).dependencies ?? {})
if (usesKoota) console.log(`koota -> ${process.env.ECS_ALIAS?.includes('"koota"') ? import.meta.resolve('koota') : findPackageJSON('koota', implEntry)}`)

const goldenPath = resolve(ROOT, 'goldens', `${name}.json`)
const golden = existsSync(goldenPath) ? (JSON.parse(readFileSync(goldenPath, 'utf8')) as string[]).at(-1) : undefined
runChild({ createSim, impl, scenario: name, kind: kind as 'headline' | 'deep', golden })
