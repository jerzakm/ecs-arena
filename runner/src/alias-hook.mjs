// Node resolve hook: ECS_ALIAS is JSON {pkgName: packageRootDir}. `pkg` and `pkg/sub` both resolve
// through the package's exports (publishConfig.exports first: the built layout). Unmapped sub-path = loud error.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const map = JSON.parse(process.env.ECS_ALIAS || '{}')

const pick = (target) => (typeof target === 'string' ? target : target?.import ? pick(target.import) : undefined)

const resolveAlias = (name, sub) => {
  const root = map[name]
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const file = pick((pkg.publishConfig?.exports ?? pkg.exports)?.[sub])
  if (!file) throw new Error(`ECS_ALIAS: ${name}${sub.slice(1)} is not exported by ${root}`)
  return pathToFileURL(join(root, file)).href
}

export function resolve(specifier, context, next) {
  const name = Object.keys(map).find((n) => specifier === n || specifier.startsWith(n + '/'))
  if (name) return { url: resolveAlias(name, '.' + specifier.slice(name.length)), shortCircuit: true }
  return next(specifier, context)
}
