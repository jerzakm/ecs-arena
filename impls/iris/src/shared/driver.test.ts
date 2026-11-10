import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { IRIS_VERSION } from './driver.ts'

// driver.ts reaches into the iris internals, so a version bump must come with a check of `getWorldInternals`.
type Manifest = { version: string; dependencies?: Record<string, string> }
const manifest = (path: string) => JSON.parse(readFileSync(join(import.meta.dirname, '../..', path), 'utf8')) as Manifest

it('runs against the iris-ecs version that driver.ts targets', () => {
  expect(manifest('node_modules/iris-ecs/package.json').version).toBe(IRIS_VERSION)
  expect(manifest('package.json').dependencies?.['iris-ecs']).toBe(IRIS_VERSION)
})
