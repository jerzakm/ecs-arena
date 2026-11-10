import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { findPackageJSON } from 'node:module'
import { pathToFileURL } from 'node:url'
import { findScenario } from '@ecs-arena/spec'
import { runChild, type ChildArgs } from './child.ts'
import { implEntry, loadSim } from './games.ts'

const ROOT = resolve(import.meta.dirname, '../..')
const [impl, name, kind] = process.argv.slice(2)
const KINDS: readonly ChildArgs['kind'][] = ['headline', 'deep']
const isKind = (k: string | undefined): k is ChildArgs['kind'] => KINDS.some((x) => x === k)
if (!isKind(kind)) throw new Error(`run kind must be one of ${KINDS.join(', ')}, got "${kind}"`)
const { game } = findScenario(name)
const entry = pathToFileURL(implEntry(impl, game)).href
const createSim = await loadSim(impl, game)

// Print which koota build the run uses, so a variant run is easy to confirm.
const usesKoota = 'koota' in (JSON.parse(readFileSync(resolve(ROOT, 'impls', impl, 'package.json'), 'utf8')).dependencies ?? {})
if (usesKoota) console.log(`koota -> ${process.env.ECS_ALIAS?.includes('"koota"') ? import.meta.resolve('koota') : findPackageJSON('koota', entry)}`)

const goldenPath = resolve(ROOT, 'goldens', `${name}.json`)
const golden = existsSync(goldenPath) ? (JSON.parse(readFileSync(goldenPath, 'utf8')) as string[]).at(-1) : undefined
runChild({ createSim, impl, scenario: name, kind, golden })
