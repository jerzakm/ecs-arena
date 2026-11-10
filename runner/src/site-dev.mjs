// pnpm site:dev: regenerate the rules pages, then run the page and the viewer with Vite hot reload.
// Set ECS_DEV_RESULTS=<path> to also serve that result file as site/results.dev.json (gitignored); open /?results=results.dev.json to see it.
import { spawn } from 'node:child_process'
import { copyFileSync, watchFile } from 'node:fs'

const run = (args) => spawn('pnpm', args, { stdio: 'inherit', shell: process.platform === 'win32' })
await new Promise((ok, fail) => run(['site:gen']).on('exit', (c) => (c ? fail(new Error(`site:gen exited ${c}`)) : ok())))
const devResults = process.env.ECS_DEV_RESULTS
if (devResults) {
  const copy = () => copyFileSync(devResults, new URL('../../site/results.dev.json', import.meta.url))
  copy()
  watchFile(devResults, { interval: 1000 }, copy)
}
const kids = [
  run(['--filter', '@ecs-arena/viewer', 'exec', 'vite', '--port', '5174', '--strictPort', '--base', '/viewer/', '--logLevel', 'warn']),
  run(['--filter', '@ecs-arena/viewer', 'exec', 'vite', '../../site', '--strictPort', '--open']),
]
const stop = () => { for (const k of kids) k.kill(); process.exit() }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
for (const k of kids) k.on('exit', stop)
