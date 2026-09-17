// Exercise the unit × points matrix against the real upstreams.
//
// Expectations encode today's source reality: eastmoney's FX kline endpoint is
// being refused, so EUR/USD falls back to ECB daily and USD/CNH (which ECB does
// not quote at all) has no series. Those cases assert the FALLBACK is reported
// honestly rather than mislabelled as the requested unit.
import {
  SERIES_HOUR_POINT_OPTIONS,
  SERIES_POINT_OPTIONS,
  availableUnitsFor,
  loadSeries,
  normalizePoints,
} from '../lib/quotes.js'

function nativeGetText(url, opts = {}) {
  return (async () => {
    const headers = { 'user-agent': 'Mozilla/5.0' }
    if (opts.referer) headers.referer = 'https://finance.sina.com.cn'
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(30000) })
    const buf = Buffer.from(await res.arrayBuffer())
    return { status: res.status, text: opts.gbk ? new TextDecoder('gbk').decode(buf) : buf.toString('utf8') }
  })()
}

let bad = 0
const check = (ok, label) => { if (!ok) bad++; return ok ? '✅' : '❌' }

console.log('=== 档位必须是 7 的倍数 ===')
console.log(`  ${SERIES_POINT_OPTIONS.join(', ')}  ${check(SERIES_POINT_OPTIONS.every((n) => n % 7 === 0) && SERIES_POINT_OPTIONS[0] === 14 && SERIES_POINT_OPTIONS[SERIES_POINT_OPTIONS.length - 1] === 56, '')}`)

console.log('\n=== 各品种声明支持的档位（小时档已暂停 → 全线只有 自动/天/月）===')
for (const [id, kind] of [['USD/CNY', 'fx'], ['USD/CNH', 'fx'], ['EUR/USD', 'fx'], ['SH000001', 'index'], ['BTCUSDT', 'crypto']]) {
  console.log(`  ${id.padEnd(9)} ${kind.padEnd(7)} → ${availableUnitsFor(id, kind).join(', ')}`)
}

// [symbol, requested unit, points, expectation]
//   expectation: { unit } exact served unit, or 'missing' when no source can serve it
const cases = [
  ['BTCUSDT', 'hour', 12, { unit: 'day', note: '小时档已暂停 → 日线' }],
  ['BTCUSDT', 'hour', 60, { unit: 'day', note: '小时档已暂停 → 日线' }],
  ['BTCUSDT', 'hour', 28, { unit: 'day', points: 24, note: '28 非 12 的倍数 → 收敛 24，再回退日线' }],
  ['BTCUSDT', 'day', 21, { unit: 'day' }],
  ['BTCUSDT', 'month', 56, { unit: 'month' }],
  ['BTCUSDT', 'auto', 28, { any: true }],
  ['SH000001', 'hour', 48, { unit: 'day', note: '小时档已暂停 → 日线' }],
  ['SH000001', 'day', 14, { unit: 'day' }],
  ['SH000001', 'month', 35, { unit: 'month' }],
  ['SH000001', 'auto', 28, { unit: 'auto' }],
  ['USD/CNY', 'hour', 12, { unit: 'day', note: '无小时源 → 回退日线' }],
  ['USD/CNY', 'day', 14, { unit: 'day' }],
  ['USD/CNY', 'month', 21, { unit: 'month' }],
  ['EUR/USD', 'hour', 24, { unit: 'day', note: '东财K线被限流 → 回退 ECB 日线' }],
  ['EUR/USD', 'day', 28, { unit: 'day' }],
  ['USD/CNH', 'hour', 28, { missing: true, note: '唯一源被限流且 ECB 无 CNH' }],
]

console.log('\n=== 单元 × 档位 实测 ===')
for (const [id, unit, points, want] of cases) {
  const t0 = Date.now()
  let line
  try {
    const r = await loadSeries([id], nativeGetText, { unit, points })
    const wantCount = want.points === undefined ? points : want.points
    const s = r.series[id]
    if (s === undefined) {
      line = want.missing
        ? `${check(true, '')} 无数据（符合预期：${want.note || ''}）`
        : `${check(false, '')} 无数据（errors=${r.errors.join(';') || '无'}）`
    } else if (want.missing) {
      line = `${check(false, '')} 本应无数据却返回了 unit=${s.unit} ${s.points.length} 点`
    } else {
      const aligned = Array.isArray(s.labels) && s.labels.length === s.points.length
      const countOk = unit === 'auto' ? true : s.points.length === wantCount
      const unitOk = want.any ? true : s.unit === want.unit
      line = `${check(aligned && countOk && unitOk, '')} unit=${s.unit} 点数=${s.points.length}/${wantCount} 对齐=${aligned}` +
        `  [${s.labels[0]} … ${s.labels[s.labels.length - 1]}]  ${s.label}` +
        (want.note ? `  ← ${want.note}` : '') + `  ${Date.now() - t0}ms`
    }
  } catch (e) { line = `${check(false, '')} 抛错: ${String(e.message).slice(0, 60)}` }
  console.log(`  ${id.padEnd(9)} ${unit.padEnd(6)} ${String(points).padStart(2)}  ${line}`)
}

console.log('\n=== 小时档的组数规则（12 的倍数，上限 60）===')
console.log('  小时档可选:', SERIES_HOUR_POINT_OPTIONS.join(', '),
  check(SERIES_HOUR_POINT_OPTIONS.every((n) => n % 12 === 0) && Math.max(...SERIES_HOUR_POINT_OPTIONS) === 60, ''))
console.log('  天/月/自动档可选:', SERIES_POINT_OPTIONS.join(', '), '（7 的倍数，不受影响）')
for (const [requested, expected] of [[12, 12], [24, 24], [60, 60], [28, 24], [14, 24], [72, 24], [0, 24]]) {
  const got = normalizePoints('hour', requested)
  console.log(`  normalizePoints('hour', ${String(requested).padStart(2)}) → ${String(got).padStart(2)}`,
    check(got === expected && SERIES_HOUR_POINT_OPTIONS.includes(got), ''))
}
console.log(`  normalizePoints('day', 12) → ${normalizePoints('day', 12)}`, check(normalizePoints('day', 12) === 28, ''))

console.log('\n=== 非法输入应被规整到默认值 ===')
const r1 = await loadSeries(['BTCUSDT'], nativeGetText, { unit: 'bogus', points: 999 })
const s1 = r1.series['BTCUSDT']
console.log(`  unit=bogus/points=999 → unit=${s1.unit}（期望 auto）点数=${s1.points.length}（回落到默认 28）` +
  `  ${check(s1.unit === 'auto' && s1.points.length === 28, '')}`)
const r2 = await loadSeries(['BTCUSDT'], nativeGetText, { unit: 'day', points: 999 })
const s2 = r2.series['BTCUSDT']
console.log(`  unit=day/points=999 → unit=${s2.unit} 点数=${s2.points.length}（期望 day / 28）` +
  `  ${check(s2.unit === 'day' && s2.points.length === 28, '')}`)

// The `auto` unit must honour the count too, or the control would look broken
// on the default setting. An index is exempt: its auto view is the session line.
console.log('\n=== auto 档是否听从组数 ===')
for (const [id, want] of [['BTCUSDT', 'count'], ['USD/CNY', 'count'], ['SH000001', 'fixed']]) {
  const a = await loadSeries([id], nativeGetText, { unit: 'auto', points: 14 })
  const b = await loadSeries([id], nativeGetText, { unit: 'auto', points: 56 })
  const na = a.series[id] ? a.series[id].points.length : 0
  const nb = b.series[id] ? b.series[id].points.length : 0
  const ok = want === 'count' ? (na === 14 && nb === 56) : (na === nb && na > 2)
  console.log(`  ${id.padEnd(9)} auto+14 → ${String(na).padStart(3)} 点   auto+56 → ${String(nb).padStart(3)} 点` +
    `  ${check(ok, '')} ${want === 'fixed' ? '（指数：固定全天分时，不随组数变化）' : ''}`)
}

console.log(`\n${bad === 0 ? '全部通过 ✅' : bad + ' 项异常 ❌'}`)
process.exitCode = bad === 0 ? 0 : 1
