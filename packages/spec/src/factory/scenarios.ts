// The two sizes of factory (SPEC-factory §11). Machine count and drone count set the load. docs/design/factory.md logs how the numbers were tuned.
import type { BaseScenario } from '../contract.ts'
import type { Layout } from './kernel.ts'

export interface FactoryScenario extends BaseScenario, Layout {
  dronesPerDistrict: number
  shiftEvery: number     // ticks between shift changes
  shiftPermille: number  // share of the drones that a shift retires and replaces
  powerEvery: number     // ticks between outage draws
  outagePermille: number // chance that a district is down at a draw
}

const SEED = 0xec5a7e7a
/** `works` keeps the 16-slot block of the first version: 7 extractors, 4 smelters, 3 assemblers and 2 sinks for each 16 machines. */
const WORKS_PATTERN = [0, 1, 0, 2, 0, 1, 3, 0, 2, 1, 0, 0, 1, 2, 3, 0]
/** One of each kind, so every machine is on a line. */
const MILL_PATTERN = [0, 1, 2, 3]
const SMOKE_TICKS = 400
const base = [
  {
    name: 'mill', districtsX: 2, districtsY: 2, machinesPerDistrict: 400, kindPattern: MILL_PATTERN, lines: 100,
    dronesPerDistrict: 900, shiftEvery: 250, shiftPermille: 200, powerEvery: 50, outagePermille: 125, ticks: 1000, loadEvery: 200,
  },
  {
    name: 'works', districtsX: 12, districtsY: 10, machinesPerDistrict: 1250, kindPattern: WORKS_PATTERN, lines: 12,
    dronesPerDistrict: 50, shiftEvery: 250, shiftPermille: 200, powerEvery: 50, outagePermille: 125, ticks: 1000, loadEvery: 200,
  },
] as const

export const SCENARIOS: Readonly<Record<string, FactoryScenario>> = Object.fromEntries(base.flatMap((b) => [
  [b.name, { ...b, seed: SEED }],
  [`${b.name}-smoke`, { ...b, name: `${b.name}-smoke`, seed: SEED, ticks: SMOKE_TICKS }],
]))
export const BOARD = ['mill', 'works'] as const
export const SMOKE = ['mill-smoke', 'works-smoke'] as const
