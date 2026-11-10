import { pathToFileURL } from 'node:url'

/** True when the module of `meta` is the script node was started with. Pass `import.meta`. */
export const isMain = (meta: ImportMeta): boolean => process.argv[1] !== undefined && meta.url === pathToFileURL(process.argv[1]).href

/** The value of a `--runs` flag. Undefined stays undefined. Throws unless the text is a number of at least 1. */
export const parseRuns = (text: string | undefined): number | undefined => {
  if (text === undefined) return undefined
  const runs = Number(text)
  if (!(runs >= 1)) throw new Error(`--runs needs a positive number, got "${text}"`)
  return runs
}
