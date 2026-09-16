// Verify the sparkline series for all three kinds, then the route payload shape.
import { loadSeries } from '../lib/quotes.js'
import { apply, QUOTES_PATH } from '../lib/index.js'

function nativeGetText(url, opts = {}) {
  return (async () => {
    const headers = { 'user-agent': 'Mozilla/5.0' }
    if (opts.referer) headers.referer = 'https://finance.sina.com.cn'
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) })
    const buf = Buffer.from(await res.arrayBuffer())
    return { status: res.status, text: opts.gbk ? new TextDecoder('gbk').decode(buf) : buf.toString('utf8') }
  })()
}

const symbols = ['USD/CNY', 'EUR/CNY', 'JPY/CNY', 'SH000001', 'SZ399006', 'BTCUSDT']

console.log('=== [A] loadSeries (cold) ===')
const t0 = Date.now()
const a = await loadSeries(symbols, nativeGetText)
console.log(`cold in ${Date.now() - t0}ms, errors=${JSON.stringify(a.errors)}`)
let labelProblems = 0
for (const [id, s] of Object.entries(a.series)) {
  const pts = s.points
  const min = Math.min(...pts)
  const max = Math.max(...pts)
  const aligned = Array.isArray(s.labels) && s.labels.length === pts.length
  if (!aligned) labelProblems++
  console.log(`  ${id.padEnd(9)} ${String(pts.length).padStart(3)} pts  ${s.label.padEnd(14)} ${min} … ${max}  [${s.range}]`)
  console.log(`     labels aligned=${aligned}  first="${(s.labels || [])[0]}"  last="${(s.labels || []).slice(-1)[0]}"  mid="${(s.labels || [])[Math.floor((s.labels || []).length / 2)]}"`)
}
console.log('missing:', symbols.filter((s) => !(s in a.series)).join(',') || '(none)')
console.log('label alignment problems:', labelProblems)

console.log('\n=== [B] loadSeries (warm cache) ===')
const t1 = Date.now()
const b = await loadSeries(symbols, nativeGetText)
console.log(`warm in ${Date.now() - t1}ms, same ids: ${Object.keys(b.series).join(',') === Object.keys(a.series).join(',')}`)

// --- route payload ---------------------------------------------------------
const registered = []
const ctx = {
  effect(cb, label) { registered.push({ label, dispose: cb() }); return () => {} },
  webServer: { register(route) { registered.push({ label: route.path, route }); return () => {} } },
}
apply(ctx)
const route = registered.find((r) => r.route !== undefined)

function fakeRes() {
  const out = { status: 0, body: '' }
  out.writeHead = (s) => { out.status = s }
  out.end = (c) => { out.body += c === undefined ? '' : String(c) }
  return out
}
async function call(url) {
  const res = fakeRes()
  const started = Date.now()
  await route.route.handler({ url }, res)
  return { status: res.status, ms: Date.now() - started, json: JSON.parse(res.body) }
}

console.log('\n=== [C] route with series ===')
const c = await call(`${QUOTES_PATH}?symbols=${encodeURIComponent(symbols.join(','))}`)
console.log(`HTTP ${c.status} in ${c.ms}ms  bytes=${JSON.stringify(c.json).length}`)
console.log(`items=${c.json.items.length} seriesKeys=${Object.keys(c.json.series || {}).join(',')} errors=${JSON.stringify(c.json.errors)}`)
console.log(`payload MB=${(JSON.stringify(c.json).length / 1024).toFixed(1)} KB for ${symbols.length} symbols`)

console.log('\n=== [D] route with series=0 (client opted out) ===')
const d = await call(`${QUOTES_PATH}?symbols=${encodeURIComponent(symbols.join(','))}&series=0`)
console.log(`HTTP ${d.status}  hasSeries=${d.json.series !== undefined}  bytes=${JSON.stringify(d.json).length}`)

for (const e of registered) if (e.dispose) e.dispose()
