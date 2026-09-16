/**
 * End-to-end test of the persistent HOST half: import lib/index.js, mount it on
 * a fake Cordis context, then drive the registered route with fake req/res and
 * real upstream network calls.
 */
import { apply, QUOTES_PATH } from '../lib/index.js'

const registered = []
const ctx = {
  effect(callback, label) { registered.push({ label, dispose: callback() }); return () => {} },
  webServer: {
    register(route) { registered.push({ label: `route ${route.path}`, route }); return () => {} },
  },
}

apply(ctx)

const route = registered.find((r) => r.route !== undefined)
console.log('registered:', registered.map((r) => r.label).join(' | '))
if (!route) { console.log('FAIL: no route registered'); process.exit(1) }
console.log('route:', route.route.kind, route.route.path, '== QUOTES_PATH:', route.route.path === QUOTES_PATH)

/** Minimal ServerResponse stand-in capturing status, headers and body. */
function fakeRes() {
  const out = { status: 0, headers: null, body: '' }
  out.writeHead = (status, headers) => { out.status = status; out.headers = headers }
  out.end = (chunk) => { out.body += chunk === undefined ? '' : String(chunk) }
  return out
}

async function call(url) {
  const res = fakeRes()
  const t0 = Date.now()
  await route.route.handler({ url }, res)
  let parsed = null
  try { parsed = JSON.parse(res.body) } catch { /* leave null */ }
  return { res, parsed, ms: Date.now() - t0 }
}

// 1. The real route with the default symbol list (exercises Sina + GBK decode).
const a = await call(`${QUOTES_PATH}?symbols=${encodeURIComponent('USD/CNY,EUR/CNY,JPY/CNY,SH000001,BTCUSDT')}`)
console.log(`\n[1] ${a.res.status} in ${a.ms}ms  ok=${a.parsed && a.parsed.ok}  errors=${JSON.stringify(a.parsed && a.parsed.errors)}`)
for (const it of (a.parsed && a.parsed.items) || []) {
  const p = it.price === null ? '(none)' : it.price.toFixed(it.decimals)
  console.log(`    ${it.label}  ${p}  ${it.changePct === null ? '' : it.changePct + '%'}  [${it.kind}/${it.source}${it.scale > 1 ? ' x' + it.scale : ''}]`)
}

// 2. Cache: the same key inside the TTL must not re-hit the upstreams.
const b = await call(`${QUOTES_PATH}?symbols=${encodeURIComponent('USD/CNY,EUR/CNY,JPY/CNY,SH000001,BTCUSDT')}`)
console.log(`\n[2] cached repeat: ${b.ms}ms (was ${a.ms}ms) -> ${b.ms < a.ms ? 'cache served' : 'NOT CACHED'}`)
console.log(`    identical payload: ${b.res.body === a.res.body}`)

// 3. No query parameter must fall back to the built-in defaults.
const c = await call(QUOTES_PATH)
console.log(`\n[3] no ?symbols -> ${c.res.status} items=${c.parsed && c.parsed.items.length} ids=${(c.parsed && c.parsed.items || []).map((i) => i.id).join(',')}`)

// 4. A junk list must degrade, not throw.
const d = await call(`${QUOTES_PATH}?symbols=${encodeURIComponent('nonsense,USD/CNY')}`)
console.log(`\n[4] junk input -> ${d.res.status} items=${(d.parsed && d.parsed.items || []).map((i) => i.id + ':' + (i.price === null ? 'none' : 'ok')).join(',')}`)

// 5. Header contract the browser half relies on.
console.log('\n[5] content-type:', a.res.headers && a.res.headers['content-type'], '| cache-control:', a.res.headers && a.res.headers['cache-control'])

// 6. Disposal must remove the route.
for (const entry of registered) if (entry.dispose) entry.dispose()
console.log('\n[6] all disposers ran without throwing')
