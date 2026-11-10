// Captures the game screenshots under site/shots/ from the built viewer in _site/viewer.
// Run `pnpm site` first, then `node runner/src/shots.mjs`. Needs playwright-core and a
// Chromium; set PLAYWRIGHT_CORE to the package path if it is not installed here.
import { createServer } from 'node:http'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core')

const SHOTS = [
  ['rts-skirmish', 'viewer/?scenario=skirmish&impl=baseline-js'],
  ['rts-war', 'viewer/?scenario=war&impl=baseline-js'],
  ['survivors-grove', 'viewer/?scenario=grove&impl=baseline-js'],
  ['survivors-swarm', 'viewer/?scenario=swarm&impl=baseline-js'],
  ['factory-mill', 'viewer/factory.html?scenario=mill&impl=baseline-js'],
  ['factory-works', 'viewer/factory.html?scenario=works&impl=baseline-js'],
]
const TICKS = 300
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.webp': 'image/webp' }

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  const file = join(root, '_site', path.endsWith('/') ? `${path}index.html` : path)
  try {
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body)
  } catch {
    res.writeHead(404).end()
  }
}).listen(0)
const base = `http://127.0.0.1:${server.address().port}/`

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM })
const page = await browser.newPage({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 2 })
await mkdir(join(root, 'site/shots'), { recursive: true })
try {
  for (const [name, url] of SHOTS) {
    await page.goto(base + url)
    await page.addStyleTag({ content: '.bar, .hud, .help, .legend, #mini, #banner, #err { display: none !important }' })
    // Each HUD shows the tick; fall back to a fixed wait where it does not.
    await page
      .waitForFunction((t) => [...document.querySelectorAll('#tick, #sv-tick, [id$=tick]')].some((e) => Number(e.textContent) >= t), TICKS, { timeout: 60_000 })
      .catch(() => page.waitForTimeout(8000))
    // WebGL canvases clear their buffer after a frame, so read the composited page instead.
    const png = (await page.locator('canvas').first().screenshot()).toString('base64')
    const webp = await page.evaluate(async (png) => {
      const src = new Image()
      src.src = `data:image/png;base64,${png}`
      await src.decode()
      const out = document.createElement('canvas')
      out.width = 640
      out.height = 360
      const g = out.getContext('2d')
      g.drawImage(src, 0, 0, out.width, out.height)
      const px = g.getImageData(0, 0, out.width, out.height).data
      let sum = 0, sq = 0
      for (let i = 0; i < px.length; i += 4) { const v = px[i] + px[i + 1] + px[i + 2]; sum += v; sq += v * v }
      const n = px.length / 4
      const variance = sq / n - (sum / n) ** 2
      const blob = await new Promise((r) => out.toBlob(r, 'image/webp', 0.8))
      return { variance, bytes: [...new Uint8Array(await blob.arrayBuffer())] }
    }, png)
    if (webp.variance < 50) throw new Error(`${name}: the frame looks blank (pixel variance ${webp.variance.toFixed(1)})`)
    await writeFile(join(root, `site/shots/${name}.webp`), Uint8Array.from(webp.bytes))
    console.log(`${name}.webp ${(webp.bytes.length / 1024).toFixed(1)} KB, variance ${webp.variance.toFixed(0)}`)
  }
} finally {
  await browser.close()
  server.close()
}
