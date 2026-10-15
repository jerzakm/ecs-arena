import { chmodSync, mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, type Plugin } from 'esbuild'
import { resolveInRoot } from './alias-hook.mjs'
import { ensureVariant, parseTarget } from './variants.ts'

const ROOT = resolve(import.meta.dirname, '../..')
const SCENARIOS = ['skirmish', 'battle', 'war']

/** Final golden hash of each scenario. */
const goldens = () => Object.fromEntries(SCENARIOS.map((sc) => [sc, (JSON.parse(readFileSync(resolve(ROOT, 'goldens', `${sc}.json`), 'utf8')) as string[]).at(-1)]))

/** Sends `koota` and `koota/*` to the built variant package, with the same resolver as the node hook. */
const variantPlugin = (root: string): Plugin => ({
  name: 'variant',
  setup: (b) => b.onResolve({ filter: /^koota(\/.*)?$/ }, (a) => ({ path: fileURLToPath(resolveInRoot(root, 'koota', '.' + a.path.slice('koota'.length))) })),
})

export const buildEntry = async (target: string) => {
  const { impl, variant } = parseTarget(target)
  const outfile = resolve(ROOT, 'dist', `bench-${target.replace(/[^\w.-]/g, '-')}.mjs`)
  mkdirSync(resolve(ROOT, 'dist'), { recursive: true })
  await build({
    stdin: {
      contents: `import createSim from './impls/${impl}/src/index.ts'
import { main } from './runner/src/entry.ts'
await main(${JSON.stringify(target)}, createSim, ${JSON.stringify(goldens())})
`,
      resolveDir: ROOT,
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    banner: { js: '#!/usr/bin/env node' },
    // The bench modules start their CLI when import.meta.url matches argv[1]. A fixed url keeps them quiet in a bundle.
    define: { 'import.meta.url': '"file:///bundled"' },
    outfile,
    logLevel: 'warning',
    plugins: variant ? [variantPlugin(ensureVariant(variant))] : [],
  })
  chmodSync(outfile, 0o755)
  return outfile
}

const targets = process.argv.slice(2)
for (const t of targets.length ? targets : ['koota', 'baseline-js']) console.log(await buildEntry(t))
