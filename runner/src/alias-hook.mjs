// Node resolve hook: maps bare specifiers to absolute paths from ECS_ALIAS (JSON {name: path}).
import { pathToFileURL } from 'node:url'

export async function resolve(specifier, context, next) {
  const map = JSON.parse(process.env.ECS_ALIAS || '{}')
  if (Object.hasOwn(map, specifier)) {
    return { url: pathToFileURL(map[specifier]).href, shortCircuit: true }
  }
  return next(specifier, context)
}
