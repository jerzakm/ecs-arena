import { chmodSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, type Plugin } from 'esbuild'
import { resolveInRoot } from './alias-hook.mjs'
import { ensureVariant, parseTarget } from './variants.ts'

const ROOT = resolve(import.meta.dirname, '../..')

/** Final golden hash of each scenario that has a goldens/<name>.json file. The .s2 and .s3 seed files are skipped. */
const goldens = () =>
  Object.fromEntries(
    readdirSync(resolve(ROOT, 'goldens'))
      .filter((f) => /^[\w-]+\.json$/.test(f))
      .map((f) => [f.slice(0, -5), (JSON.parse(readFileSync(resolve(ROOT, 'goldens', f), 'utf8')) as string[]).at(-1)]),
  )

/** Sends `koota` and `koota/*` to the built variant package, with the same resolver as the node hook. */
const variantPlugin = (root: string): Plugin => ({
  name: 'variant',
  setup: (b) => b.onResolve({ filter: /^koota(\/.*)?$/ }, (a) => ({ path: fileURLToPath(resolveInRoot(root, 'koota', '.' + a.path.slice('koota'.length))) })),
})

/** A `:smoke` suffix builds a short entry for a quick check on the bench box: skirmish-smoke, 3 runs. */
const SMOKE = { scenarios: ['skirmish-smoke'], runs: 3 }

export const buildEntry = async (name: string) => {
  const smoke = name.endsWith(':smoke')
  const target = smoke ? name.slice(0, -':smoke'.length) : name
  const { impl, variant } = parseTarget(target)
  const outfile = resolve(ROOT, 'dist', `bench-${name.replace(/[^\w.-]/g, '-')}.mjs`)
  mkdirSync(resolve(ROOT, 'dist'), { recursive: true })
  await build({
    stdin: {
      contents: `import createSim from './impls/${impl}/src/index.ts'
import { main } from './runner/src/entry.ts'
await main(${JSON.stringify(target)}, createSim, ${JSON.stringify(goldens())}${smoke ? `, ${JSON.stringify(SMOKE)}` : ''})
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
