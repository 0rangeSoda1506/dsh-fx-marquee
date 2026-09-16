// Verify FX source selection: each named source, exotic pairs, and cache keying.
import { loadQuotes, FX_SOURCES } from '../lib/quotes.js'
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

/** Sina denied, to prove `auto` walks down the chain. */
function denySina(url, opts = {}) {
  if (opts.referer) return Promise.resolve({ status: 403, text: 'Forbidden' })
  return nativeGetText(url, opts)
}

console.log('FX_SOURCES =', JSON.stringify(FX_SOURCES))

const pairs = ['USD/CNY', 'EUR/CNY', 'USD/JPY']
console.log('\n=== [A] each named source for USD/CNY, EUR/CNY, USD/JPY ===')
for (const src of FX_SOURCES) {
  const t0 = Date.now()
  const r = await loadQuotes(pairs, nativeGetText, { fxSource: src })
  const row = r.items.map((i) => `${i.id}=${i.price === null ? 'none' : i.price}(${i.source})`).join('  ')
  console.log(`  ${src.padEnd(12)} ${String(Date.now() - t0).padStart(5)}ms  ${row}`)
  if (r.errors.length > 0) console.log(`      errors: ${r.errors.join(' | ')}`)
}

console.log('\n=== [B] pairs only ER-API covers (ECB publishes none of these) ===')
const exotic = ['USD/KRW', 'USD/THB', 'USD/TWD', 'USD/VND', 'JPY/CNY']
for (const src of ['frankfurter', 'erapi']) {
  const r = await loadQuotes(exotic, nativeGetText, { fxSource: src })
  const row = r.items.map((i) => `${i.id}=${i.price === null ? 'NO DATA' : i.price.toPrecision(6)}`).join('  ')
  console.log(`  ${src.padEnd(12)} ${row}`)
}

console.log('\n=== [C] auto with Sina blocked must fall through to a daily table ===')
const autoFallback = await loadQuotes(pairs, denySina, { fxSource: 'auto' })
console.log('  ' + autoFallback.items.map((i) => `${i.id}=${i.price === null ? 'none' : i.price}(${i.source})`).join('  '))
console.log('  errors:', JSON.stringify(autoFallback.errors))

// --- route level -----------------------------------------------------------
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
async function call(qs) {
  const res = fakeRes()
  const t0 = Date.now()
  await route.route.handler({ url: `${QUOTES_PATH}?${qs}` }, res)
  return { status: res.status, ms: Date.now() - t0, json: JSON.parse(res.body) }
}

const list = encodeURIComponent(pairs.join(','))
console.log('\n=== [D] route: same symbols, different fx -> cache must NOT cross sources ===')
const s1 = await call(`symbols=${list}&fx=sina&series=0`)
const s2 = await call(`symbols=${list}&fx=erapi&series=0`)
const s3 = await call(`symbols=${list}&fx=sina&series=0`)
const src = (r) => r.json.items.map((i) => i.source).join(',')
console.log(`  fx=sina  -> ${src(s1)}  (${s1.ms}ms)  fxSource=${s1.json.fxSource}`)
console.log(`  fx=erapi -> ${src(s2)}  (${s2.ms}ms)  fxSource=${s2.json.fxSource}`)
console.log(`  fx=sina  -> ${src(s3)}  (${s3.ms}ms)  cached=${s3.ms < 50}`)
console.log(`  distinct results: ${src(s1) !== src(s2) ? 'PASS' : 'FAIL — cache leaked across sources'}`)

console.log('\n=== [E] unknown fx value falls back to auto ===')
const e = await call(`symbols=${list}&fx=bogus&series=0`)
console.log(`  fx=bogus -> fxSource=${e.json.fxSource} sources=${src(e)}`)

console.log('\n=== [F] no fx parameter at all ===')
const f = await call(`symbols=${list}&series=0`)
console.log(`  -> fxSource=${f.json.fxSource} sources=${src(f)}`)

for (const entry of registered) if (entry.dispose) entry.dispose()
