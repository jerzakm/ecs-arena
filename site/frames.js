// Results chart, ms/frame, frame-time and memory views. Reads results.json, or ?results=<url>.
// Uses REPO and GAMES from the inline script in index.html.
const LIBS = [['bitecs', 's1'], ['iris', 's2'], ['koota', 's3']]
const BASE = 'baseline-js'
const SERIES = [...LIBS.map(([lib, c]) => ({ lib, name: lib, color: `var(--${c})`, dash: false })), { lib: BASE, name: 'plain JS', color: 'var(--dim)', dash: true }]
const BUDGET = 1000 / 60
const MAX = 32, pos = (x) => Math.log2(x) / Math.log2(MAX) * 100
const ms = (v) => v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`
const f1 = (v) => v.toFixed(1)
const niceStep = (max, n) => [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000, 2000, 5000].find((s) => max / s <= n) ?? 10000
const overMark = (v, text = f1(v)) => v > BUDGET ? `<span class="over" title="over the 16.6 ms budget">${text}▲</span>` : text
const swatch = (c) => `<span class="tsw" style="--c:${c}"></span>`
const isBoard = (sc) => !sc.endsWith('-smoke') && !sc.startsWith('sweep-')
const gameName = (g) => GAMES.find((x) => x[0] === g)[1]
const tip = document.getElementById('tip')
const NS = 'http://www.w3.org/2000/svg'

const placeTip = (x, y) => {
  tip.hidden = false
  tip.classList.remove('docked')
  tip.style.left = `${Math.max(8, Math.min(x, document.documentElement.clientWidth - tip.offsetWidth - 8)) + window.scrollX}px`
  tip.style.top = `${y + window.scrollY}px`
}

// Tooltip next to the cursor, kept inside the chart; on phones docked full width under the chart so it covers nothing.
const chartTip = (svg, e) => {
  const sr = svg.getBoundingClientRect(), vw = document.documentElement.clientWidth
  if (vw < 640) { placeTip(8, sr.bottom + 6); tip.classList.add('docked'); return }
  const right = e.clientX + 16 + tip.offsetWidth < vw - 8
  placeTip(right ? e.clientX + 16 : e.clientX - 16 - tip.offsetWidth, Math.max(sr.top, Math.min(e.clientY + 16, sr.bottom - tip.offsetHeight)))
}
const gcFmt = (v) => v === 0 ? '–' : v < 0.05 ? '<0.1' : f1(v)

const src = new URLSearchParams(location.search).get('results') ?? 'results.json'
fetch(src).then((r) => r.ok ? r.json() : null).then((res) => {
  const chart = document.getElementById('chart')
  const box = document.getElementById('frames-box')
  if (!res) { chart.innerHTML = '<p class="meta">Results pending.</p>'; box.innerHTML = ''; return }
  const { machine: m, scores = [], games = {}, report = {}, ticks: tickMap } = res
  const date = new Date(m.date).toISOString().slice(0, 10)
  document.getElementById('machine').textContent = `${m.os.startsWith('win') ? 'Windows' : m.os} · ${m.cpu.trim().replace(/\s+/g, ' ')} · Node ${m.node.replace(/^v/, '')} · ${date}`
  document.getElementById('commit').innerHTML = `results from commit <a href="${REPO}/commit/${m.commit}">${m.commit}</a>`

  // ms per tick; null when the file predates the ticks map.
  const mspf = (lib, sc) => {
    const t = tickMap?.[sc], tot = report[lib]?.[sc]?.totalMs?.median
    return t && tot ? tot / t : null
  }
  // Scenarios of a game that have data: board ones, or smoke ones when there are no board ones.
  const withData = (g) => (games[g] ?? []).filter((sc) => report[BASE]?.[sc])
  const shown = (g) => { const all = withData(g), b = all.filter(isBoard); return b.length ? b : all.filter((sc) => sc.endsWith('-smoke')) }

  const gridTicks = [1, 2, 4, 8, 16, 32]
  chart.innerHTML = GAMES.map(([g, name]) => {
    const sc = scores.find((x) => x.game === g)?.scores ?? []
    const rows = LIBS.map(([lib, c]) => {
      const s = sc.find((x) => x.target === lib)
      if (!s) return ''
      return `<div class="bar-row" data-g="${g}" data-lib="${lib}" tabindex="0">
        <span class="bar" style="width:${pos(s.point)}%;--c:var(--${c})"></span>
        <span class="ci" style="left:${pos(s.lo)}%;width:${pos(s.hi) - pos(s.lo)}%"></span>
        <span class="val">${lib} <b>${s.point.toFixed(2)}×</b></span></div>`
    }).join('')
    return `<div class="panel"><h3>${name}</h3><div class="plot">${gridTicks.map((t) => `<span class="grid" style="left:${pos(t)}%"><i>${t}×</i></span>`).join('')}${rows}</div></div>`
  }).join('')

  for (const tr of document.querySelectorAll('#scores-table tr[data-lib]')) {
    for (const td of tr.querySelectorAll('td[data-g]')) {
      const s = scores.find((x) => x.game === td.dataset.g)?.scores?.find((x) => x.target === tr.dataset.lib)
      if (s) td.innerHTML = `<b>${s.point.toFixed(2)}×</b>`
    }
  }

  // The tutorial game has its own line. Its score divides by the vanilla entry, and it never joins the headline.
  const tut = scores.find((x) => x.game === 'bricks')?.scores ?? []
  if (tut.length) document.getElementById('tutorial-results').textContent = `Tutorial score, time ÷ vanilla entry: ${tut.map((s) => `${s.target} ${s.point.toFixed(2)}×`).join(', ')}. It is not in the headline.`

  const show = (row) => {
    const { g, lib } = row.dataset
    const lines = shown(g).map((sc) => {
      const a = report[lib]?.[sc]?.totalMs?.median, b = report[BASE]?.[sc]?.totalMs?.median
      if (!a || !b) return ''
      const pa = mspf(lib, sc), pb = mspf(BASE, sc)
      if (pa == null) return `${sc}: ${ms(a)} vs ${ms(b)} plain JS`
      return `${sc.padEnd(15)}${overMark(pa)} ms/frame · ${(a / b).toFixed(2)}× · plain JS ${overMark(pb)}`
    }).filter(Boolean)
    const head = `<b>${lib}</b> · ${gameName(g)}${tickMap ? ' · budget 16.6 ms (60 fps)' : ''}`
    tip.innerHTML = `${head}<br>${lines.join('<br>')}${tickMap ? '' : '<br><span class="dim">ms/frame needs a new bench run</span>'}`
    const r = row.getBoundingClientRect()
    placeTip(r.left, r.bottom + 6)
  }
  for (const row of chart.querySelectorAll('.bar-row')) {
    row.onmouseenter = row.onfocus = () => show(row)
    row.onmouseleave = row.onblur = () => { tip.hidden = true }
  }

  // Frame times: one tab per game; the chosen game and view live in the URL hash (#frames-rts-every).
  // Without frames, the memory charts still show and the chart area says why it is empty.
  const hasFrames = Object.values(report).some((r) => Object.values(r).some((a) => a.frames))
  const gs = GAMES.filter(([g]) => withData(g).length)
  if (!gs.length) { box.innerHTML = ''; return }
  const states = Object.fromEntries(gs.map(([g]) => [g, { sc: shown(g)[0], hidden: new Set(), clip: true, memTable: false }]))
  const HASH = /^#frames-(\w+?)(-every)?$/
  const hm = location.hash.match(HASH)
  const ui = { g: hm && states[hm[1]] ? hm[1] : gs[0][0], view: hm?.[2] ? 'frames' : 'grouped' }
  const setHash = () => history.replaceState(null, '', `#frames-${ui.g}${ui.view === 'frames' ? '-every' : ''}`)
  let redraw = () => {}
  box.innerHTML = `<div class="gtabs" role="tablist" aria-label="Game">${gs.map(([g, name]) => `<button type="button" role="tab" id="gt-${g}" data-g="${g}" aria-controls="gpanel">${name}</button>`).join('')}</div>
    <div id="gpanel" role="tabpanel" tabindex="0"></div>`
  const tabs = [...box.querySelectorAll('.gtabs button')], panel = box.querySelector('#gpanel')
  const pick = (g, focus) => { ui.g = g; setHash(); buildGame(); if (focus) box.querySelector(`#gt-${g}`).focus() }
  for (const t of tabs) {
    t.onclick = () => pick(t.dataset.g)
    t.onkeydown = (e) => {
      const i = tabs.indexOf(t), n = tabs.length
      const j = { ArrowRight: (i + 1) % n, ArrowLeft: (i + n - 1) % n, Home: 0, End: n - 1 }[e.key]
      if (j != null) { e.preventDefault(); pick(tabs[j].dataset.g, true) }
    }
  }

  function buildGame() {
    const g = ui.g, st = states[g]
    for (const t of tabs) { const on = t.dataset.g === g; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1 }
    panel.setAttribute('aria-labelledby', `gt-${g}`)
    const primary = shown(g), rest = withData(g).filter((sc) => !primary.includes(sc))
    const one = primary.length + rest.length < 2
    panel.innerHTML = `<div class="picker"><span class="meta">scenario</span>${one ? `<span>${primary[0]}</span>` : primary.map((sc) => `<button type="button" data-sc="${sc}">${sc}</button>`).join('')}${rest.length ? `<select aria-label="more scenarios"><option value="">more…</option>${rest.map((sc) => `<option>${sc}</option>`).join('')}</select>` : ''}
      <span class="sep"></span><span class="meta">view</span><button type="button" data-view="grouped">grouped</button><button type="button" data-view="frames">every frame</button>
      <label class="meta" title="Spikes above the top of the chart are marked ▲; uncheck to see them whole"><input type="checkbox"${st.clip ? ' checked' : ''}> clip spikes</label></div>
      <p class="legend"><span class="li"><span class="sw" style="--c:var(--s1)"></span>bitecs</span><span class="li"><span class="sw" style="--c:var(--s2)"></span>iris</span><span class="li"><span class="sw" style="--c:var(--s3)"></span>koota</span><span class="li"><span class="sw dash"></span>plain JS</span><span class="li"><span class="sw budget"></span>16.6 ms · 60 fps</span></p>
      <div class="fchart"></div>
      <p class="meta fcopy"></p>
      <div class="scroll"><table class="ftable"></table></div>
      <h3>Memory and GC</h3>
      <div class="mem"></div>`
    const draw = () => {
      for (const b of panel.querySelectorAll('.picker button[data-sc]')) b.setAttribute('aria-pressed', String(b.dataset.sc === st.sc))
      for (const b of panel.querySelectorAll('.picker button[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === ui.view))
      const sel = panel.querySelector('select')
      if (sel) sel.value = rest.includes(st.sc) ? st.sc : ''
      const host = panel.querySelector('.fchart')
      if (!hasFrames) host.innerHTML = '<p class="meta">Frame times need a new bench run: this result file has no per-tick data. Run <code>pnpm bench:site</code>.</p>'
      else if (ui.view === 'frames') lineChart(host, st, draw)
      else frameChart(host, st)
      frameTable(panel, st.sc)
      memory(panel.querySelector('.mem'), st)
    }
    for (const b of panel.querySelectorAll('.picker button[data-view]')) b.onclick = () => { ui.view = b.dataset.view; setHash(); draw() }
    for (const b of panel.querySelectorAll('.picker button[data-sc]')) b.onclick = () => { st.sc = b.dataset.sc; draw() }
    const sel = panel.querySelector('select')
    if (sel) sel.onchange = () => { if (sel.value) { st.sc = sel.value; draw() } }
    panel.querySelector('input[type=checkbox]').onchange = (e) => { st.clip = e.target.checked; draw() }
    redraw = draw
    draw()
  }

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag)
    for (const k in attrs) e.setAttribute(k, attrs[k])
    parent?.appendChild(e)
    return e
  }

  // Direct labels at the right end of a plot, nudged apart; click one to hide or show that library in both plots.
  function directLabels(svg, items, x0, top, bottom, st, redraw) {
    const labs = items
    let last = -Infinity
    for (const l of labs) { l.y = Math.max(l.want, last + 16, top + 4); last = l.y }
    const over = last - bottom
    if (over > 0) for (const l of labs) l.y -= over
    for (const l of labs) {
      const off = st.hidden.has(l.s.lib)
      const g = el('g', { class: `dl${off ? ' off' : ''}`, tabindex: 0, role: 'button', 'aria-pressed': String(!off) }, svg)
      el('title', {}, g).textContent = off ? 'click to show' : 'click to hide'
      el('line', { x1: x0 + 6, x2: x0 + 18, y1: l.y, y2: l.y, class: l.s.dash ? 'dsw dash' : 'dsw', style: `stroke:${l.s.color}` }, g)
      el('text', { x: x0 + 22, y: l.y + 4 }, g).textContent = l.text
      g.onclick = () => { if (off) st.hidden.delete(l.s.lib); else st.hidden.add(l.s.lib); redraw() }
      g.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); g.onclick() } }
    }
  }

  // Every frame: frame time per tick on top, GC per tick below, same x axis, one crosshair and one tooltip.
  function lineChart(host, st, redraw) {
    const sc = st.sc
    const lines = SERIES.map((s) => ({ ...s, f: report[s.lib]?.[sc]?.frames, m: report[s.lib]?.[sc]?.memory })).filter((s) => s.f)
    host.innerHTML = ''
    if (!lines.length) { host.innerHTML = '<p class="meta">No frame data for this scenario.</p>'; return }
    const W = Math.max(300, host.clientWidth), narrow = W < 640
    const gcs = lines.filter((s) => s.m?.gcFrames)
    const M = { l: 44, r: narrow ? 84 : 160 }
    const FH = narrow ? 240 : 380, GH = gcs.length ? Math.round(FH * 0.55) : 0
    const ft = 26, gt = ft + FH + 50, H = (gcs.length ? gt + GH : ft + FH) + 28
    const pw = W - M.l - M.r
    const nTicks = Math.max(...lines.map((s) => s.f.ticks))
    const vis = lines.filter((s) => !st.hidden.has(s.lib))
    const peak = Math.max(BUDGET * 1.2, ...vis.map((s) => s.f.worst))
    // Clipped: scale to the typical ticks (p90 with headroom), so the 16.6 ms rule and the calm lines stay readable; ▲ marks what goes above.
    const yMax = st.clip ? Math.min(peak, Math.max(24, ...vis.map((s) => s.f.p90 * 1.5))) : peak
    const x = (t) => M.l + Math.min(t, nTicks) / nTicks * pw
    const y = (v) => ft + FH - Math.min(v, yMax) / yMax * FH
    const gvis = gcs.filter((s) => !st.hidden.has(s.lib))
    const gPeak = gvis.reduce((a, s) => s.m.gcFrames.reduce((b, v) => Math.max(b, v), a), 0)
    const gStep = niceStep(Math.max(0.1, gPeak), 4)
    const gMax = gStep * Math.max(1, Math.ceil(gPeak / gStep))
    const gy = (v) => gt + GH - v / gMax * GH
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'fsvg', role: 'img', 'aria-label': `Frame time and GC time per tick, ${sc}; values are in the table below` }, host)
    el('text', { x: M.l, y: ft - 12, class: 'ptitle' }, svg).textContent = 'Frame time, ms'
    const step = niceStep(yMax, 5)
    for (let v = 0; v <= yMax + 1e-9; v += step) {
      el('line', { x1: M.l, x2: M.l + pw, y1: y(v), y2: y(v), class: 'gl' }, svg)
      el('text', { x: M.l - 6, y: y(v) + 4, class: 'ax', 'text-anchor': 'end' }, svg).textContent = v
    }
    if (BUDGET <= yMax) el('line', { x1: M.l, x2: M.l + pw, y1: y(BUDGET), y2: y(BUDGET), class: 'budget' }, svg)
    // Largest spikes first, so they sit under the calmer lines.
    for (const s of [...vis].sort((a, b) => b.f.p99 - a.f.p99)) {
      el('polyline', { points: s.f.max.map((v, i) => `${x(i * s.f.bucket).toFixed(1)},${y(v).toFixed(1)}`).join(' '), class: s.dash ? 'fl dash' : 'fl', style: `stroke:${s.color}` }, svg)
    }
    if (st.clip) for (const s of vis) s.f.max.forEach((v, i) => { if (v > yMax) el('text', { x: x(i * s.f.bucket), y: ft + 9, class: 'clipm', 'text-anchor': 'middle', style: `fill:${s.color}` }, svg).textContent = '▲' })
    if (BUDGET <= yMax) el('text', { x: M.l + pw - 2, y: y(BUDGET) - 5, class: 'ax budget-t', 'text-anchor': 'end' }, svg).textContent = '16.6 ms · 60 fps'
    el('line', { x1: M.l, x2: M.l, y1: ft, y2: ft + FH, class: 'axl' }, svg)
    el('line', { x1: M.l, x2: M.l + pw, y1: ft + FH, y2: ft + FH, class: 'axl' }, svg)
    // Both plots label the libraries in the same order: by where each frame line ends.
    const order = [...lines].sort((p, q) => y(p.f.max.at(-1)) - y(q.f.max.at(-1)))
    directLabels(svg, order.map((s) => ({ s, want: y(s.f.max.at(-1)), text: narrow ? s.name : `${s.name} · p50 ${f1(s.f.p50)}` })), M.l + pw, ft, ft + FH, st, redraw)

    // GC plot, only when the file has GC per tick.
    if (gcs.length) {
      el('text', { x: M.l, y: gt - 12, class: 'ptitle' }, svg).textContent = 'GC per tick, ms'
      for (let v = 0; v <= gMax + 1e-9; v += gStep) {
        el('line', { x1: M.l, x2: M.l + pw, y1: gy(v), y2: gy(v), class: 'gl' }, svg)
        el('text', { x: M.l - 6, y: gy(v) + 4, class: 'ax', 'text-anchor': 'end' }, svg).textContent = +v.toFixed(1)
      }
      for (const s of [...gvis].sort((p, q) => Math.max(...q.m.gcFrames) - Math.max(...p.m.gcFrames))) {
        el('polyline', { points: s.m.gcFrames.map((v, i) => `${x(i * s.m.gcBucket).toFixed(1)},${gy(v).toFixed(1)}`).join(' '), class: s.dash ? 'fl gc dash' : 'fl gc', style: `stroke:${s.color}` }, svg)
      }
      el('line', { x1: M.l, x2: M.l, y1: gt, y2: gt + GH, class: 'axl' }, svg)
      el('line', { x1: M.l, x2: M.l + pw, y1: gt + GH, y2: gt + GH, class: 'axl' }, svg)
      const gOrder = order.filter((s) => gcs.includes(s))
      directLabels(svg, gOrder.map((s, i) => ({ s, want: gt + GH / 2 + (i - (gOrder.length - 1) / 2) * 16, text: narrow ? s.name : `${s.name} · ${Math.round(s.m.gcMs)} ms` })), M.l + pw, gt, gt + GH, st, redraw)
    }
    const xs = (narrow ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1]).map((p) => Math.round(nTicks * p))
    for (const t of xs) el('text', { x: x(t), y: H - 6, class: 'ax', 'text-anchor': t === 0 ? 'start' : t === nTicks ? 'end' : 'middle' }, svg).textContent = t === nTicks ? `${t} ticks` : t

    // One crosshair across both plots, dots on each visible line, one tooltip.
    const bottom = gcs.length ? gt + GH : ft + FH
    const cross = el('line', { y1: ft, y2: bottom, class: 'cross', visibility: 'hidden' }, svg)
    const dots = vis.map((s) => [el('circle', { r: 3.5, class: 'dot', style: `fill:${s.color}`, visibility: 'hidden' }, svg), s.m?.gcFrames && el('circle', { r: 3.5, class: 'dot', style: `fill:${s.color}`, visibility: 'hidden' }, svg)])
    const hit = el('rect', { x: M.l, y: ft, width: pw, height: bottom - ft, fill: 'transparent' }, svg)
    const b = lines[0].f.bucket
    const hide = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); for (const d of dots.flat()) d?.setAttribute('visibility', 'hidden') }
    hit.onpointermove = (e) => {
      const r = svg.getBoundingClientRect()
      const px = (e.clientX - r.left) * W / r.width
      const t = Math.max(0, Math.min(nTicks - 1, Math.round((px - M.l) / pw * nTicks)))
      const t0 = Math.floor(t / b) * b
      cross.setAttribute('x1', x(t0)); cross.setAttribute('x2', x(t0)); cross.setAttribute('visibility', 'visible')
      const put = (d, cy) => { if (!d) return; if (cy == null) { d.setAttribute('visibility', 'hidden'); return } d.setAttribute('cx', x(t0)); d.setAttribute('cy', cy); d.setAttribute('visibility', 'visible') }
      const vals = vis.map((s, i) => {
        const v = s.f.max[Math.floor(t / s.f.bucket)], gc = s.m?.gcFrames?.[Math.floor(t / s.m.gcBucket)]
        put(dots[i][0], v == null ? null : y(v)); put(dots[i][1], gc == null ? null : gy(gc))
        return v == null ? null : { s, v, gc }
      }).filter(Boolean).sort((p, q) => q.v - p.v)
      tip.innerHTML = `<b>tick ${b > 1 ? `${t0}–${Math.min(t0 + b, nTicks) - 1}` : t0}</b> · ${sc}<br><span class="dim">${''.padEnd(11)}${'frame ms'.padStart(9)}${gcs.length ? '   GC ms' : ''}</span>${vals.map(({ s, v, gc }) => `<br>${swatch(s.color)}${s.name.padEnd(9)}${overMark(v, f1(v).padStart(9))}${gc == null ? '' : gcFmt(gc).padStart(8)}`).join('')}${b > 1 ? `<br><span class="dim">slowest of every ${b} ticks</span>` : ''}`
      chartTip(svg, e)
    }
    hit.onpointerleave = hide
    host.parentElement.querySelector('.fcopy').textContent = `One run per line${b > 1 ? `, each point the slowest of ${b} ticks` : ''}.${gcs.length ? ' GC comes from a separate instrumented run on the same ticks.' : ''} Click a name to hide it.`
  }

  function frameChart(host, st) {
    const sc = st.sc
    const rows = SERIES.map((s) => ({ ...s, f: report[s.lib]?.[sc]?.frames })).filter((s) => s.f)
    host.innerHTML = ''
    if (!rows.length) { host.innerHTML = '<p class="meta">No frame data for this scenario.</p>'; return }
    const nTicks = Math.max(...rows.map((s) => s.f.ticks))
    const N = Math.min(host.clientWidth < 640 ? 25 : host.clientWidth > 1100 ? 80 : 50, Math.max(...rows.map((s) => s.f.max.length)))
    const med = (a) => { const b = [...a].sort((p, q) => p - q); return b.length ? b[b.length >> 1] : 0 }
    // Group the stored points (already the slowest tick of each small bucket) into N columns: typical = median, worst = max.
    for (const r of rows) {
      const m = r.f.max, per = m.length / N
      r.g = Array.from({ length: N }, (_, i) => {
        const part = m.slice(Math.floor(i * per), Math.max(Math.floor(i * per) + 1, Math.floor((i + 1) * per)))
        return { typ: med(part), top: Math.max(...part) }
      })
    }
    const peak = Math.max(BUDGET * 1.2, ...rows.map((s) => s.f.worst))
    // Clipped: scale to the typical ticks (the bars), so every row stays readable; spikes above get a ▲.
    const yMax = st.clip ? Math.min(peak, Math.max(BUDGET * 1.6, ...rows.flatMap((r) => r.g.map((c) => c.typ * 1.2)))) : peak
    const W = Math.max(300, host.clientWidth), narrow = W < 640
    const RH = narrow ? 70 : 120, GAP = 30, M = { l: 34, r: 8, t: 4, b: 22 }
    const H = M.t + rows.length * (RH + GAP) + M.b
    const pw = W - M.l - M.r, cw = pw / N
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'fsvg', role: 'img', 'aria-label': `Frame time per group of ticks for each library, ${sc}; values are in the table below` }, host)
    const step = niceStep(yMax, narrow ? 3 : 4)
    rows.forEach((r, ri) => {
      const top = M.t + ri * (RH + GAP) + GAP - 6, base = top + RH
      const y = (v) => base - Math.min(v, yMax) / yMax * RH
      const over = r.f.over
      el('text', { x: M.l, y: top - 6, class: 'rowlab' }, svg).innerHTML = `<tspan class="rname">${r.name}</tspan><tspan class="ax"> · typical ${f1(r.f.p50)} ms · worst ${ms(r.f.worst)}${over && !narrow ? ` · ${over} ticks over 16.6` : ''}</tspan>`
      for (let v = step; v <= yMax + 1e-9; v += step) {
        el('line', { x1: M.l, x2: M.l + pw, y1: y(v), y2: y(v), class: 'gl' }, svg)
        el('text', { x: M.l - 4, y: y(v) + 4, class: 'ax', 'text-anchor': 'end' }, svg).textContent = v
      }
      r.g.forEach((c, i) => {
        const x0 = M.l + i * cw + 1, w = Math.max(1, cw - 2), xm = x0 + w / 2
        if (c.top > c.typ * 1.15) el('line', { x1: xm, x2: xm, y1: y(c.typ), y2: y(c.top), class: 'whisk', style: `stroke:${r.color}` }, svg)
        if (c.top > c.typ * 1.15 && c.top <= yMax) el('line', { x1: xm - Math.min(3, w / 2), x2: xm + Math.min(3, w / 2), y1: y(c.top), y2: y(c.top), class: 'whisk', style: `stroke:${r.color}` }, svg)
        el('rect', { x: x0, y: y(c.typ), width: w, height: Math.max(1, base - y(c.typ)), class: r.dash ? 'col base' : 'col', style: `fill:${r.color}` }, svg)
        if (c.top > yMax) el('text', { x: xm, y: top - 1 + 9, class: 'clipm', 'text-anchor': 'middle', style: `fill:${r.color}` }, svg).textContent = '▲'
      })
      if (BUDGET <= yMax) el('line', { x1: M.l, x2: M.l + pw, y1: y(BUDGET), y2: y(BUDGET), class: 'budget' }, svg)
      el('line', { x1: M.l, x2: M.l + pw, y1: base, y2: base, class: 'axl' }, svg)
      r.y = y
    })
    const firstBudgetY = rows[0].y(BUDGET)
    if (BUDGET <= yMax) el('text', { x: M.l + pw - 2, y: firstBudgetY - 3, class: 'ax budget-t', 'text-anchor': 'end' }, svg).textContent = '16.6 ms · 60 fps'
    const xs = (narrow ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1]).map((p) => Math.round(nTicks * p))
    for (const t of xs) el('text', { x: M.l + t / nTicks * pw, y: H - 6, class: 'ax', 'text-anchor': t === 0 ? 'start' : t === nTicks ? 'end' : 'middle' }, svg).textContent = t === nTicks ? `${t} ticks run` : t
    const hl = el('rect', { y: M.t, height: H - M.t - M.b, width: cw, class: 'colhl', visibility: 'hidden' }, svg)
    const hit = el('rect', { x: M.l, y: M.t, width: pw, height: H - M.t - M.b, fill: 'transparent' }, svg)
    hit.onpointermove = (e) => {
      const rc = svg.getBoundingClientRect()
      const i = Math.max(0, Math.min(N - 1, Math.floor(((e.clientX - rc.left) * W / rc.width - M.l) / cw)))
      hl.setAttribute('x', M.l + i * cw); hl.setAttribute('visibility', 'visible')
      const t0 = Math.round(i * nTicks / N), t1 = Math.round((i + 1) * nTicks / N) - 1
      tip.innerHTML = `<b>ticks ${t0}–${t1}</b> · ${sc}<br><span class="dim">${'typical'.padStart(17)}  worst</span>${rows.map((r) => `<br>${swatch(r.color)}${r.name.padEnd(9)}${f1(r.g[i].typ).padStart(7)}  ${overMark(r.g[i].top)} ms`).join('')}`
      chartTip(svg, e)
    }
    hit.onpointerleave = () => { tip.hidden = true; hl.setAttribute('visibility', 'hidden') }
    host.parentElement.querySelector('.fcopy').textContent = `Each column is ${Math.round(nTicks / N)} ticks: the bar is a typical tick, the thin line the slowest. ▲ marks a spike above the top.`
  }


  function frameTable(body, sc) {
    const rows = SERIES.map((s) => {
      const f = report[s.lib]?.[sc]?.frames
      if (!f) return ''
      const pf = mspf(s.lib, sc)
      return `<tr><td>${s.name}</td><td>${pf == null ? '—' : overMark(pf)}</td><td>${overMark(f.p50)}</td><td>${overMark(f.p90)}</td><td>${overMark(f.p99)}</td><td>${overMark(f.worst)}</td><td>${f.over}</td></tr>`
    }).join('')
    body.querySelector('.ftable').innerHTML = `<thead><tr><th>library</th><th>ms/frame</th><th>p50 ms</th><th>p90</th><th>p99</th><th>slowest</th><th class="nw">over 16.6 ms</th></tr></thead><tbody>${rows}</tbody>`
  }

  // A bar with a square end at the baseline and a 4 px rounded end at the value.
  const barPath = (x0, y0, w, h) => {
    const r = Math.min(4, w, h / 2)
    return `M${x0},${y0}h${w - r}a${r},${r} 0 0 1 ${r},${r}v${h - 2 * r}a${r},${r} 0 0 1 ${-r},${r}h${-(w - r)}z`
  }

  function memory(host, st) {
    const sc = st.sc
    const rows = SERIES.map((s) => ({ ...s, m: report[s.lib]?.[sc]?.memory })).filter((s) => s.m)
    if (!rows.length) { host.innerHTML = '<p class="meta">No memory pass in this result file. Run <code>pnpm bench:site</code>.</p>'; return }
    const mets = [['peak heap, MB', (m) => m.peakHeapMB, (v) => Math.round(v)], ['GC time, ms', (m) => m.gcMs, (v) => Math.round(v)], ['allocated per frame, MB', (m) => m.allocMBPerFrame, (v) => v.toFixed(2)]]
    host.innerHTML = `<div class="mults"></div>
      <p class="meta">From separate instrumented runs that don't count toward scores. <button type="button" class="linkbtn">${st.memTable ? 'hide' : 'show'} table</button></p>
      <div class="scroll"${st.memTable ? '' : ' hidden'}><table><thead><tr><th>library</th><th>peak heap MB</th><th>GC ms</th><th>GC % of run</th><th>alloc MB/frame</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${r.name}</td><td>${Math.round(r.m.peakHeapMB)}</td><td>${Math.round(r.m.gcMs)}</td><td>${(r.m.gcShare * 100).toFixed(1)}%</td><td>${r.m.allocMBPerFrame.toFixed(2)}</td></tr>`).join('')}</tbody></table></div>`
    const btn = host.querySelector('.linkbtn'), tw = host.querySelector('.scroll')
    btn.onclick = () => { st.memTable = tw.hidden; tw.hidden = !tw.hidden; btn.textContent = tw.hidden ? 'show table' : 'hide table' }
    const mults = host.querySelector('.mults')
    mets.forEach(([title, get, fmt], mi) => {
      const cell = document.createElement('div')
      cell.innerHTML = `<h5>${title}</h5>`
      mults.appendChild(cell)
      const W = 400, rh = 30, H = rows.length * rh + 4, lw = 76, vw = 56
      const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'msvg', role: 'img', 'aria-label': `${title}; values in the table` }, cell)
      const max = Math.max(...rows.map((r) => get(r.m))) || 1
      rows.forEach((r, i) => {
        const v = get(r.m), w = Math.max(1, v / max * (W - lw - vw)), yy = i * rh + 4
        el('text', { x: 0, y: yy + 15, class: 'ax' }, svg).textContent = r.name
        el('path', { d: barPath(lw, yy + 3, w, 16), style: `fill:${r.color}`, class: r.dash ? 'mbar base' : 'mbar' }, svg)
        el('text', { x: lw + w + 6, y: yy + 15, class: 'ax val' }, svg).textContent = fmt(v)
        const hit = el('rect', { x: 0, y: yy, width: W, height: rh, fill: 'transparent', tabindex: 0, class: 'mhit' }, svg)
        const b = (k, t) => k === mi ? `<b>${t}</b>` : t
        const show = () => {
          tip.innerHTML = `${swatch(r.color)}<b>${r.name}</b> · ${sc}<br>${b(0, `peak heap ${Math.round(r.m.peakHeapMB)} MB`)}<br>${b(1, `GC ${Math.round(r.m.gcMs)} ms (${(r.m.gcShare * 100).toFixed(1)}% of run)`)}<br>${b(2, `${r.m.allocMBPerFrame.toFixed(2)} MB allocated per frame`)}`
          const rr = hit.getBoundingClientRect()
          placeTip(rr.left, rr.bottom + 6)
        }
        hit.onpointerenter = hit.onfocus = show
        hit.onpointerleave = hit.onblur = () => { tip.hidden = true }
      })
      el('line', { x1: lw, x2: lw, y1: 0, y2: H, class: 'axl' }, svg)
    })
  }
  buildGame()
  if (hm) document.getElementById('frames').scrollIntoView()
  window.addEventListener('hashchange', () => {
    const h = location.hash.match(HASH)
    if (h && states[h[1]]) { ui.g = h[1]; ui.view = h[2] ? 'frames' : 'grouped'; buildGame() }
  })
  let rt, lastW = innerWidth
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (innerWidth !== lastW) { lastW = innerWidth; redraw() } }, 150) })
}).catch((e) => console.error(e))
