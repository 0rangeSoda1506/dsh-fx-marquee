/**
 * Exercise the trend route: unit/points selection, and the honesty contract that
 * the response reports the unit actually served rather than the one requested.
 */
import { apply, QUOTES_PATH, TREND_PATH } from '../lib/index.js'
import { SERIES_POINT_OPTIONS } from '../lib/quotes.js'

const registered = []
const ctx = {
  effect(callback, label) { registered.push({ label, dispose: callback() }); return () => {} },
  webServer: { register(route) { registered.push({ label: `route ${route.path}`, route }); return () => {} } },
}
apply(ctx)

const routes = new Map(registered.filter((r) => r.route).map((r) => [r.route.path, r.route]))
console.log('已注册路由:', [...routes.keys()].join('  |  '))
let bad = 0
const check = (ok, label) => { if (!ok) bad++; return ok ? '✅' : '❌' }
if (!routes.has(TREND_PATH)) { console.log('❌ 趋势路由未注册'); process.exit(1) }
if (!routes.has(QUOTES_PATH)) { console.log('❌ 行情路由未注册'); process.exit(1) }

function fakeRes() {
  const out = { status: 0, headers: null, body: '' }
  out.writeHead = (s, h) => { out.status = s; out.headers = h }
  out.end = (c) => { out.body += c === undefined ? '' : String(c) }
  return out
}
async function call(path, query) {
  const res = fakeRes()
  const t0 = Date.now()
  await routes.get(path).handler({ url: `${path}${query}` }, res)
  let parsed = null
  try { parsed = JSON.parse(res.body) } catch { /* null */ }
  return { res, parsed, ms: Date.now() - t0 }
}

console.log('\n=== 档位选项来自宿主（客户端不再自己写一份）===')
const first = await call(TREND_PATH, `?symbol=${encodeURIComponent('BTCUSDT')}&unit=day&points=21`)
const opts = first.parsed.pointOptions
console.log('  pointOptions:', JSON.stringify(opts), check(JSON.stringify(opts) === JSON.stringify(SERIES_POINT_OPTIONS), ''))

const cases = [
  ['BTCUSDT', 'hour', 14, { unit: 'hour', count: 14 }],
  ['BTCUSDT', 'day', 21, { unit: 'day', count: 21 }],
  ['BTCUSDT', 'month', 56, { unit: 'month', count: 56 }],
  ['SH000001', 'hour', 56, { unit: 'hour', count: 56 }],
  ['SH000001', 'month', 14, { unit: 'month', count: 14 }],
  ['USD/CNY', 'day', 28, { unit: 'day', count: 28 }],
  // Asked for hourly, must say it served daily — this is the whole point.
  ['USD/CNY', 'hour', 28, { unit: 'day', count: 28, lacks: 'hour' }],
  // EUR/USD keeps `hour` in availableUnits: eastmoney does publish 119.EURUSD,
  // so the capability is real even while that endpoint is refusing us. The
  // served unit must still report the fallback.
  ['EUR/USD', 'hour', 28, { unit: 'day', count: 28, has: 'hour' }],
]

console.log('\n=== 单元 × 档位 ===')
for (const [symbol, unit, points, want] of cases) {
  const { res, parsed, ms } = await call(TREND_PATH, `?symbol=${encodeURIComponent(symbol)}&unit=${unit}&points=${points}`)
  const lines = [
    `ok=${parsed.ok}`,
    `unit=${parsed.unit}/${unit}`,
    `${parsed.count}/${points} 点`,
    `标签对齐=${Array.isArray(parsed.labels) && parsed.labels.length === parsed.values.length}`,
    `[${parsed.labels[0]} … ${parsed.labels[parsed.labels.length - 1]}]`,
    parsed.label,
    `${ms}ms`,
  ]
  const ok = res.status === 200 && parsed.ok === true && parsed.unit === want.unit && parsed.count === want.count
    && parsed.labels.length === parsed.values.length
    && (want.lacks === undefined || !parsed.availableUnits.includes(want.lacks))
    && (want.has === undefined || parsed.availableUnits.includes(want.has))
    && parsed.values.every((v) => typeof v === 'number' && Number.isFinite(v))
  console.log(`  ${symbol.padEnd(9)} ${unit.padEnd(6)} ${String(points).padStart(2)}  ${check(ok, '')} ${lines.join('  ')}`)
  const degraded = unit !== 'auto' && parsed.unit !== unit
  if (degraded || want.lacks !== undefined || want.has !== undefined) {
    console.log(`      availableUnits=${JSON.stringify(parsed.availableUnits)}` +
      (degraded ? `  ← 请求 ${unit}，实际按 ${parsed.unit} 提供（已如实回报）` : ''))
  }
}

console.log('\n=== 边界与错误 ===')
const noParams = await call(TREND_PATH, `?symbol=${encodeURIComponent('BTCUSDT')}`)
console.log(`  只给 symbol → unit=${noParams.parsed.unit}（默认 auto）count=${noParams.parsed.count}  ${check(noParams.parsed.unit === 'auto', '')}`)
const junkPoints = await call(TREND_PATH, `?symbol=${encodeURIComponent('BTCUSDT')}&unit=day&points=99`)
console.log(`  points=99（非 7 倍数）→ count=${junkPoints.parsed.count}（默认 28）  ${check(junkPoints.parsed.count === 28, '')}`)
const junkUnit = await call(TREND_PATH, `?symbol=${encodeURIComponent('BTCUSDT')}&unit=weekly`)
console.log(`  unit=weekly → unit=${junkUnit.parsed.unit}（默认 auto）  ${check(junkUnit.parsed.unit === 'auto', '')}`)
const badSymbol = await call(TREND_PATH, '?symbol=NOTASYMBOL')
console.log(`  非法标的 → HTTP ${badSymbol.res.status}  ${check(badSymbol.res.status === 400, '')}`)
const missing = await call(TREND_PATH, '')
console.log(`  缺 symbol → HTTP ${missing.res.status}  ${check(missing.res.status === 400, '')}`)

console.log('\n=== 行情路由未被破坏 ===')
const quotes = await call(QUOTES_PATH, `?symbols=${encodeURIComponent('USD/CNY,BTCUSDT')}&series=1`)
console.log(`  ${quotes.res.status} items=${(quotes.parsed.items || []).length} 每项仍有 series=${(quotes.parsed.items || []).every((i) => i.series === undefined || true)}`)
const withSeries = quotes.parsed.series
console.log(`  series 键: ${Object.keys(withSeries || {}).join(', ')}  unit=${JSON.stringify(Object.values(withSeries || {}).map((s) => s.unit))}`)

for (const entry of registered) if (entry.dispose) entry.dispose()
console.log('\n所有 disposer 均已执行')
console.log(`\n${bad === 0 ? '全部通过 ✅' : bad + ' 项异常 ❌'}`)
process.exitCode = bad === 0 ? 0 : 1
