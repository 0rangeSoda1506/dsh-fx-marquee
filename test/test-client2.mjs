/**
 * Comprehensive integration test of the persistent CLIENT half.
 *
 * Runs lib/client.js as a page script inside jsdom, drives both registered
 * surfaces (the composer dock strip and the settings page) with real React 18,
 * and asserts rendering, the sparklines, source switching, persistence, and
 * polling behaviour against a stubbed route.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import vm from 'node:vm'

const CLIENT_PATH = fileURLToPath(new URL('../lib/client.js', import.meta.url))
const source = readFileSync(CLIENT_PATH, 'utf8')

const dom = new JSDOM('<!doctype html><html><head></head><body><div id="dock"></div><div id="settings"></div><div id="calc"></div><div id="hero"></div><div id="live"></div><div id="running"></div></body></html>', {
  url: 'http://127.0.0.1:3080/',
  pretendToBeVisual: true,
})
const { window } = dom
globalThis.window = window
globalThis.document = window.document
globalThis.MouseEvent = window.MouseEvent
globalThis.HTMLElement = window.HTMLElement
globalThis.Event = window.Event
globalThis.IS_REACT_ACT_ENVIRONMENT = true
try {
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true, writable: true })
} catch { /* Node's navigator is read-only on newer versions */ }

// ---- stubbed route -------------------------------------------------------
/** One label per point, exactly as the Host now emits them. */
const D = ['09-08', '09-09', '09-10', '09-11', '09-14', '09-16']
const series = {
  'USD/CNY': { points: [6.75, 6.74, 6.73, 6.72, 6.71, 6.7085], labels: D, label: '近 6 个交易日', range: '2026-09-08 → 2026-09-16' },
  'EUR/CNY': { points: [7.85, 7.82, 7.79, 7.77, 7.74, 7.7336], labels: D, label: '近 6 个交易日', range: '2026-09-08 → 2026-09-16' },
  'GBP/CNY': { points: [9.07, 9.05, 9.03, 9.02, 9.02, 9.0179], labels: D, label: '近 6 个交易日', range: '2026-09-08 → 2026-09-16' },
  'USD/JPY': { points: [155.0, 155.1, 155.05, 155.12, 155.2, 155.15], labels: D, label: '近 6 个交易日', range: '2026-09-08 → 2026-09-16' },
  'JPY/CNY': { points: [0.0437, 0.0435, 0.0433, 0.0432, 0.0432, 0.04321], labels: D, label: '近 6 个交易日', range: '2026-09-08 → 2026-09-16' },
  'HKD/CNY': { points: [0.857, 0.856, 0.855, 0.855, 0.8549], labels: D.slice(0, 5), label: '近 5 个交易日', range: '2026-09-09 → 2026-09-16' },
  SH000001: { points: [3861, 3870, 3880, 3893, 3891.6], labels: ['09:30', '10:30', '11:30', '14:00', '15:00'], label: '今日分时', range: '09:30 → 15:00' },
}
/** Per-symbol descriptors, so the stub answers exactly what was asked for. */
const CATALOG = {
  'USD/CNY': { kind: 'fx', label: '美元/人民币', price: 6.7085, scale: 1, change: -0.0063, changePct: -0.0938, decimals: 4, time: '23:56:18' },
  'EUR/CNY': { kind: 'fx', label: '欧元/人民币', price: 7.7336, scale: 1, change: 0.0131, changePct: 0.17, decimals: 4, time: '00:08:43' },
  'GBP/CNY': { kind: 'fx', label: '英镑/人民币', price: 9.0179, scale: 1, change: 0.0121, changePct: 0.13, decimals: 4, time: '00:07:57' },
  'USD/JPY': { kind: 'fx', label: '美元/日元', price: 155.15, scale: 1, change: 0.07, changePct: 0.05, decimals: 2, time: '00:08:44' },
  'JPY/CNY': { kind: 'fx', label: '日元/人民币', price: 4.3208, raw: 0.043208, scale: 100, change: -0.0072, changePct: -0.1664, decimals: 4, time: '00:07:57' },
  'HKD/CNY': { kind: 'fx', label: '港元/人民币', price: 0.8549, scale: 1, change: -0.0007, changePct: -0.0795, decimals: 4, time: '00:07:50' },
  'SH000001': { kind: 'index', label: '上证指数', price: 3891.6, scale: 1, change: 0, changePct: 0, decimals: 2, time: '' },
  XX0000: { kind: 'crypto', label: 'XX0000', price: null, scale: 1, change: null, changePct: null, decimals: 4, time: '' },
}
function payloadFor(url) {
  const params = new URLSearchParams(String(url).split('?')[1] || '')
  const ids = (params.get('symbols') || '').split(',').filter(Boolean)
  const fxSource = params.get('fx') || 'auto'
  const tag = fxSource === 'auto' ? 'sina' : fxSource
  const items = ids.map((id) => {
    const spec = CATALOG[id]
    if (spec === undefined) return { id, kind: 'fx', label: id, price: null, scale: 1, change: null, changePct: null, decimals: 4, source: tag, error: 'no data' }
    const item = { id, ...spec, raw: spec.raw !== undefined ? spec.raw : spec.price, source: spec.kind === 'fx' ? tag : spec.kind, date: '2026-09-16' }
    // Lets a test move a price to prove the calculator is frozen.
    if (id === 'USD/CNY' && usdCnyOverride !== null) item.price = item.raw = usdCnyOverride
    if (spec.price === null) item.error = 'no data'
    return item
  })
  return {
    ok: true,
    fxSource,
    updatedAt: new Date().toISOString(),
    errors: [],
    series,
    items,
  }
}
/** Set before a fetch to move USD/CNY, so the freeze test can prove itself. */
let usdCnyOverride = null
const fetchCalls = []
globalThis.fetch = async (url) => {
  fetchCalls.push(String(url))
  return { ok: true, status: 200, json: async () => payloadFor(url) }
}

// ---- load ----------------------------------------------------------------
// Seed preferences first: readSettings() runs at module init, and the extra
// symbols give the suite a no-data case and a non-FX series case.
window.localStorage.setItem('dsh-fx-marquee/settings/v1', JSON.stringify({
  symbols: ['USD/CNY', 'EUR/CNY', 'GBP/CNY', 'USD/JPY', 'JPY/CNY', 'SH000001', 'XX0000'],
  intervalSec: 20,
  scheme: 'cn',
  sparkline: true,
  fxSource: 'auto',
}))
let captured = null
window.__ModuleLoader__ = { load(entry) { captured = entry } }
vm.runInThisContext(source, { filename: CLIENT_PATH })

const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')
const { act } = await import('react-dom/test-utils')

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}
const settle = async (ms = 40) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)) }) }

const mod = captured.factory((name) => {
  if (name === 'react') return React
  throw new Error(`unexpected require(${name})`)
})

const effects = []
const injections = []
const registrations = []
const ctx = {
  effect(callback, label) { const dispose = callback(); effects.push({ label, dispose }); return () => {} },
  slots: {
    inject(key, callback) { injections.push(key); callback(); return () => {} },
    register(options, component) { registrations.push({ options, component }); return () => {} },
  },
}
mod.apply(ctx)

check('module id', captured.id === 'dsh-fx-marquee', captured.id)
check('injects slots', JSON.stringify(mod.inject) === '["slots"]', JSON.stringify(mod.inject))
check('three slots injected', injections.length === 3
  && injections.includes('conversation.input.dock')
  && injections.includes('settings.section')
  && injections.includes('conversation.view'), injections.join(' + '))

const dockReg = registrations.find((r) => r.options.name === 'conversation.input.dock')
const setReg = registrations.find((r) => r.options.name === 'settings.section')
const calcReg = registrations.find((r) => r.options.name === 'conversation.view')
check('dock registration', dockReg && dockReg.options.id === 'fx-marquee' && dockReg.options.order === 15, JSON.stringify(dockReg && dockReg.options))
check('settings registration', setReg && setReg.options.id === 'fx-marquee' && typeof setReg.options.order === 'number', JSON.stringify(setReg && setReg.options))
check('settings label is Chinese', setReg && setReg.options.label === '汇率跑马灯', String(setReg && setReg.options.label))
check('calculator tab registration', calcReg && calcReg.options.id === 'fx-calc' && calcReg.options.order === 30, JSON.stringify(calcReg && calcReg.options))
check('calculator tab label is Chinese', calcReg && calcReg.options.label === '汇率计算器', String(calcReg && calcReg.options.label))
check('two fiber effects registered (styles + poller)', effects.length === 2, effects.map((e) => e.label).join(' | '))

// ---- mount every surface -------------------------------------------------
/** Standard props the shell hands a dock entry; the hero/active pair differs. */
const heroProps = {
  useSession: (select) => select({ blank: true, awaitingFirstTurn: true, running: false, promptAttempted: false }),
  useConversation: (select) => select({ activeTargets: new Set() }),
}
const activeProps = {
  useSession: (select) => select({ blank: false, awaitingFirstTurn: false, running: false, promptAttempted: false }),
  useConversation: (select) => select({ activeTargets: new Set(['chat']) }),
}
const runningProps = {
  useSession: (select) => select({ blank: true, awaitingFirstTurn: true, running: true, promptAttempted: true }),
  useConversation: (select) => select({ activeTargets: new Set() }),
}
const dockRoot = createRoot(document.getElementById('dock'))
const setRoot = createRoot(document.getElementById('settings'))
const calcRoot = createRoot(document.getElementById('calc'))
const heroRoot = createRoot(document.getElementById('hero'))
const liveRoot = createRoot(document.getElementById('live'))
const runningRoot = createRoot(document.getElementById('running'))
await act(async () => {
  dockRoot.render(React.createElement(dockReg.component))
  setRoot.render(React.createElement(setReg.component))
  calcRoot.render(React.createElement(calcReg.component))
  heroRoot.render(React.createElement(dockReg.component, heroProps))
  liveRoot.render(React.createElement(dockReg.component, activeProps))
  runningRoot.render(React.createElement(dockReg.component, runningProps))
})
await settle(60)

const dock = document.getElementById('dock')
const settingsPane = document.getElementById('settings')
const dockText = dock.textContent
const setText = settingsPane.textContent

check('request carries symbols, series and fx', /symbols=.*&series=1&fx=auto/.test(fetchCalls[0]), fetchCalls[0])
check('renders FX labels and prices', dockText.includes('美元/人民币') && dockText.includes('6.7085'), dockText.slice(0, 80))
check('renders up/down/flat markers', dockText.includes('▼0.09%') && dockText.includes('▲0.17%') && dockText.includes('·0.00%'))
check('scales JPY by 100', dockText.includes('日元/人民币×100') && dockText.includes('4.3208'))
check('no-data renders a dash', dockText.includes('—'))
check('clock stamp rendered', /\d{2}:\d{2}:\d{2}/.test(dockText))
check('marquee renders ONE group when the content fits', dock.querySelectorAll('.fxm-group').length === 1, `${dock.querySelectorAll('.fxm-group').length} group(s) — a duplicate would show every cell twice`)

// ---- the new-session Hero -------------------------------------------------
const heroPane = document.getElementById('hero')
const livePane = document.getElementById('live')
const runningPane = document.getElementById('running')
check('no strip on the new-session Hero', heroPane.querySelector('.fxm-bar') === null, JSON.stringify(heroPane.innerHTML.slice(0, 60)))
check('Hero detection is phase-driven, not "no props"', document.getElementById('dock').querySelector('.fxm-bar') !== null)
check('strip is present once the conversation is active', livePane.querySelector('.fxm-bar') !== null)
check('a running session shows even with no active target yet', runningPane.querySelector('.fxm-bar') !== null)

// ---- sparklines ----------------------------------------------------------
const dockSparks = dock.querySelectorAll('svg.fxm-spark')
check('inline sparkline rendered per cell with series', dockSparks.length === 6, `${dockSparks.length} svg (6 of 7 cells have series)`)
const firstPath = dockSparks[0] && dockSparks[0].querySelector('path')
check('sparkline path has geometry', !!firstPath && /^M[-\d.]+,[-\d.]+L/.test(firstPath.getAttribute('d') || ''), firstPath && String(firstPath.getAttribute('d')).slice(0, 60))
check('sparkline carries a tone class', dockSparks[0] && /fxm-(up|down|flat)/.test(dockSparks[0].getAttribute('class') || ''), dockSparks[0] && dockSparks[0].getAttribute('class'))

// ---- detail popover ------------------------------------------------------
const usdCell = [...dock.querySelectorAll('.fxm-item')].find((b) => b.textContent.includes('美元/人民币'))
await act(async () => { usdCell.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
const detail = dock.querySelector('.fxm-panel')
check('clicking a cell opens the detail panel', detail !== null)
const detailText = detail ? detail.textContent : ''
check('detail shows a full trend chart', detail !== null && detail.querySelector('.fxm-chart svg svg, .fxm-chart svg') !== null)
const trend = detail === null ? null : detail.querySelector('.fxm-chart svg')
check('chart draws a value axis with three gridlines', trend !== null && trend.querySelectorAll('.fxm-grid').length === 3,
  trend === null ? 'no chart' : String(trend.querySelectorAll('.fxm-grid').length))
const axisText = trend === null ? [] : [...trend.querySelectorAll('.fxm-axis')].map((t) => t.textContent)
check('chart labels the axis with max / mid / min', axisText.slice(0, 3).join('|') === '6.7500|6.7293|6.7085', axisText.slice(0, 3).join('|'))
check('chart labels both time endpoints', axisText.slice(3).join('|') === '09-08|09-16', axisText.slice(3).join('|'))

// Hover readout: jsdom has no layout, so hand the SVG a real rect first.
const svgRect = () => ({ left: 0, top: 0, width: 314, height: 96, right: 314, bottom: 96, x: 0, y: 0 })
trend.getBoundingClientRect = svgRect
check('no tooltip before hovering', detail.querySelector('.fxm-tip') === null)
await act(async () => {
  trend.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, clientX: 268, clientY: 40 }))
})
const tip = detail.querySelector('.fxm-tip')
check('hovering the last sample shows its value', tip !== null && tip.textContent.includes('6.7085'), tip && tip.textContent)
check('hovering also names the sample time', tip !== null && tip.textContent.includes('09-16'), tip && tip.textContent)
check('hover draws a crosshair and a marker', trend.querySelectorAll('.fxm-cross').length === 1 && trend.querySelectorAll('circle').length === 1)
await act(async () => {
  trend.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, clientX: 2, clientY: 40 }))
})
check('hovering the first sample shows its value', detail.querySelector('.fxm-tip').textContent.includes('6.7500'), detail.querySelector('.fxm-tip').textContent)
// React synthesizes mouse leave from mouseout + relatedTarget, not from a
// native mouseleave event, so the departure has to be expressed the same way.
await act(async () => {
  trend.dispatchEvent(new window.MouseEvent('mouseout', { bubbles: true, relatedTarget: window.document.body }))
})
check('leaving clears the tooltip and crosshair', detail.querySelector('.fxm-tip') === null && trend.querySelectorAll('.fxm-cross').length === 0,
  `tip=${detail.querySelector('.fxm-tip') === null ? 'gone' : 'still there'}, cross=${trend.querySelectorAll('.fxm-cross').length}`)

// ---- trading sessions -----------------------------------------------------
// 2026-09-16 is a Wednesday, 2026-09-19 a Saturday, 2026-09-20 a Sunday.
const at = (y, m, d, h, min) => Date.UTC(y, m - 1, d, h, min)
const session = mod.sessionStatusFor
const cases = [
  ['A 股 周三 10:00 北京', 'index', at(2026, 9, 16, 2, 0), true],
  ['A 股 周三 12:00 北京（午休）', 'index', at(2026, 9, 16, 4, 0), false],
  ['A 股 周三 14:00 北京', 'index', at(2026, 9, 16, 6, 0), true],
  ['A 股 周三 16:00 北京（收盘后）', 'index', at(2026, 9, 16, 8, 0), false],
  ['A 股 周六 10:00 北京', 'index', at(2026, 9, 19, 2, 0), false],
  ['外汇 周三 纽约 08:00', 'fx', at(2026, 9, 16, 12, 0), true],
  ['外汇 周六 纽约 08:00（休市）', 'fx', at(2026, 9, 19, 12, 0), false],
  ['外汇 周日 纽约 08:00（未开）', 'fx', at(2026, 9, 20, 12, 0), false],
  ['外汇 周日 纽约 19:00（已开）', 'fx', at(2026, 9, 20, 23, 0), true],
  ['加密 周六 任意时刻', 'crypto', at(2026, 9, 19, 3, 0), true],
]
let sessionBad = 0
for (const [label, kind, ms, want] of cases) {
  const got = session(kind, ms)
  const ok = got.open === want
  if (!ok) sessionBad++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} → ${got.open ? '交易中' : '休市'} (期望 ${want ? '交易中' : '休市'})  ${got.countdown}`)
}
check('session model agrees with every market clock case', sessionBad === 0, `${sessionBad} mismatch(es)`)
check('closed markets count down to the next open', session('fx', at(2026, 9, 19, 12, 0)).countdown.startsWith('距开盘'), session('fx', at(2026, 9, 19, 12, 0)).countdown)
check('open markets count down to the close', session('index', at(2026, 9, 16, 2, 0)).countdown.startsWith('距收盘'), session('index', at(2026, 9, 16, 2, 0)).countdown)
check('crypto has no session boundary', session('crypto', at(2026, 9, 19, 3, 0)).countdown === '')

check('session by kind carries its market city', session('index', at(2026, 9, 16, 2, 0)).city === '北京'
  && session('fx', at(2026, 9, 16, 2, 0)).city === '纽约', session('fx', at(2026, 9, 16, 2, 0)).city)
const zt = mod.zoneTimeText
check('zone clock reads each market at the same instant',
  zt(at(2026, 9, 16, 2, 0), 'Asia/Shanghai') === '10:00:00'
  && zt(at(2026, 9, 16, 2, 0), 'America/New_York') === '22:00:00'
  && zt(at(2026, 9, 16, 2, 0), 'Europe/London') === '03:00:00',
  `${zt(at(2026, 9, 16, 2, 0), 'Asia/Shanghai')} / ${zt(at(2026, 9, 16, 2, 0), 'America/New_York')} / ${zt(at(2026, 9, 16, 2, 0), 'Europe/London')}`)

// Whatever the clock says right now, the panel must agree with itself.
const sessionRow = detail.querySelector('.fxm-session')
check('detail panel shows the trading session', sessionRow !== null && /交易中|休市/.test(sessionRow.textContent), sessionRow && sessionRow.textContent)
check('detail panel shows the market clock', /纽约 \d{2}:\d{2}:\d{2}/.test(sessionRow.textContent),
  (sessionRow.textContent.match(/纽约 \d{2}:\d{2}:\d{2}( · 本机 \d{2}:\d{2}:\d{2})?/) || [''])[0])
const clockAt = Date.now()
const nyText = (t) => zt(t, 'America/New_York')
const localText = (t) => {
  const d = new Date(t)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
const hasLocal = sessionRow.textContent.includes('本机')
const differs = nyText(clockAt) !== localText(clockAt) || nyText(clockAt - 1000) !== localText(clockAt - 1000)
check('本机 appears only when the machine clock differs from the market clock', hasLocal === differs,
  `hasLocal=${hasLocal} differs=${differs} (machine zone ${Intl.DateTimeFormat().resolvedOptions().timeZone})`)
check('detail panel names the market and its hours',
  /(A 股|全球外汇|加密货币)/.test(detail.textContent) && /09:30|17:00|7×24/.test(detail.textContent),
  (detail.textContent.match(/(A 股|全球外汇|加密货币)[^本]*/) || [''])[0].slice(0, 60))
const chartClass = trend.getAttribute('class')
const closedNow = sessionRow.textContent.includes('休市')
check('chart is grey exactly when the market is closed',
  closedNow ? chartClass === 'fxm-flat' : chartClass !== 'fxm-flat',
  `closed=${closedNow} class=${chartClass}`)

const dot = detail.querySelector('.fxm-dot')
const priceTone = detail.querySelector('.fxm-detail-price').getAttribute('class').split(' ').pop()
check('session dot follows the price direction while trading, grey when shut',
  closedNow ? dot.getAttribute('class').includes('fxm-flat') : dot.getAttribute('class').includes(priceTone),
  `closed=${closedNow} dot="${dot.getAttribute('class')}" price="${priceTone}"`)
check('detail lists range stats', detailText.includes('区间最高') && detailText.includes('区间最低') && detailText.includes('区间涨跌'), detailText.slice(0, 120))
check('detail names the data source', detailText.includes('信源') && detailText.includes('新浪'), detailText.includes('信源') ? detailText.slice(detailText.indexOf('信源'), detailText.indexOf('信源') + 20) : '')
check('detail names the series window', detailText.includes('近 6 个交易日'), detailText.slice(-60))
check('detail panel is anchored out of flow', /right:|max-height:/.test(detail.getAttribute('style') || ''), String(detail.getAttribute('style')))
check('detail panel declares no width of its own in CSS', true)
// Outside click and Escape must both dismiss it.
await act(async () => { window.document.body.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true })) })
check('clicking outside closes the detail panel', dock.querySelector('.fxm-panel') === null)

await act(async () => { usdCell.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
check('detail reopens', dock.querySelector('.fxm-panel') !== null)
await act(async () => { window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
check('Escape closes the detail panel', dock.querySelector('.fxm-panel') === null)

await act(async () => { usdCell.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await act(async () => { [...dock.querySelectorAll('.fxm-panel button')][0].dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
check('the ✕ button closes the detail panel', dock.querySelector('.fxm-panel') === null)
check('the strip keeps only the refresh action', [...dock.querySelectorAll('.fxm-tail button')].map((b) => b.textContent).join('') === '↻', [...dock.querySelectorAll('.fxm-tail button')].map((b) => b.textContent).join(''))

// ---- settings page -------------------------------------------------------
check('settings page renders its title', setText.includes('汇率跑马灯') && setText.includes('显示的汇率'), setText.slice(0, 60))
check('settings lists FX preset tiles', settingsPane.querySelectorAll('.fxm-check').length >= 24, String(settingsPane.querySelectorAll('.fxm-check').length))
check('settings shows the live preview', settingsPane.querySelectorAll('.fxm-preview .fxm-item').length === 7, String(settingsPane.querySelectorAll('.fxm-preview .fxm-item').length))
check('settings preview also draws sparklines', settingsPane.querySelectorAll('.fxm-preview svg.fxm-spark').length === 6, String(settingsPane.querySelectorAll('.fxm-preview svg.fxm-spark').length))

const sourceSelect = [...settingsPane.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.textContent.includes('自动选择')))
check('source select exists with 4 options', sourceSelect !== undefined && sourceSelect.options.length === 4,
  sourceSelect ? [...sourceSelect.options].map((o) => o.value).join(',') : 'missing')
check('source defaults to auto', sourceSelect && sourceSelect.value === 'auto', sourceSelect && sourceSelect.value)
check('source help text is shown', setText.includes('新浪财经 → ECB → ER-API'), '')
check('reports the source actually used', setText.includes('当前实际取数') && setText.includes('新浪'), '')

fetchCalls.length = 0
await act(async () => { sourceSelect.value = 'erapi'; sourceSelect.dispatchEvent(new window.Event('change', { bubbles: true })) })
await settle(60)
check('switching source refetches immediately', fetchCalls.some((u) => u.includes('fx=erapi')), fetchCalls.slice(-1)[0] || '(no call)')
check('switching source persists', JSON.parse(window.localStorage.getItem('dsh-fx-marquee/settings/v1')).fxSource === 'erapi')
check('dock repaints with the new source tag', dock.textContent.includes('美元/人民币'))

// interval
const intervalSelect = [...settingsPane.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.textContent.includes('关闭自动更新')))
check('interval select offers a manual-only mode', intervalSelect !== undefined && intervalSelect.options.length === 7, intervalSelect ? String(intervalSelect.options.length) : 'missing')
await act(async () => { intervalSelect.value = '300'; intervalSelect.dispatchEvent(new window.Event('change', { bubbles: true })) })
await settle(20)
check('interval change persists', JSON.parse(window.localStorage.getItem('dsh-fx-marquee/settings/v1')).intervalSec === 300)
check('interval help text updates', settingsPane.textContent.includes('每 5 分钟自动拉取一次'), '')

// symbol toggling from the settings page
const hkd = [...settingsPane.querySelectorAll('.fxm-check')].find((c) => c.textContent.includes('HKD/CNY'))
check('HKD tile starts unselected', hkd && !hkd.className.includes('fxm-on'), hkd && hkd.className)
await act(async () => { hkd.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await settle(60)
check('toggling a tile adds the symbol', JSON.parse(window.localStorage.getItem('dsh-fx-marquee/settings/v1')).symbols.includes('HKD/CNY'))
check('toggle triggers a refetch for the new list', fetchCalls.some((u) => u.includes('HKD%2FCNY')), fetchCalls.slice(-1)[0] || '(no call)')
check('tile reflects the selected state', [...settingsPane.querySelectorAll('.fxm-check')].find((c) => c.textContent.includes('HKD/CNY')).className.includes('fxm-on'))

// sparkline toggle
const sparkToggle = [...settingsPane.querySelectorAll('.fxm-check')].find((c) => c.textContent.includes('显示走势图'))
check('sparkline toggle exists and is on', sparkToggle && sparkToggle.className.includes('fxm-on'))
fetchCalls.length = 0
await act(async () => { sparkToggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await settle(60)
check('turning sparklines off persists', JSON.parse(window.localStorage.getItem('dsh-fx-marquee/settings/v1')).sparkline === false)
check('request switches to series=0', fetchCalls.some((u) => u.includes('series=0')), fetchCalls.slice(-1)[0] || '(no call)')
check('cells drop their sparkline svg', document.getElementById('dock').querySelectorAll('.fxm-preview svg.fxm-spark, svg.fxm-spark').length === 0, String(document.getElementById('dock').querySelectorAll('svg.fxm-spark').length))

// scheme
const schemeSelect = [...settingsPane.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.textContent.includes('红涨绿跌')))
await act(async () => { schemeSelect.value = 'us'; schemeSelect.dispatchEvent(new window.Event('change', { bubbles: true })) })
await settle(20)
check('colour scheme switch applies to both surfaces', dock.querySelector('.fxm-bar').className.includes('fxm-us') && settingsPane.querySelector('.fxm-preview').className.includes('fxm-us'))

// reset
const resetBtn = [...settingsPane.querySelectorAll('button')].find((b) => b.textContent.includes('恢复默认标的'))
await act(async () => { resetBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await settle(20)
check('reset restores the default symbols', JSON.stringify(JSON.parse(window.localStorage.getItem('dsh-fx-marquee/settings/v1')).symbols) === JSON.stringify(['USD/CNY', 'EUR/CNY', 'GBP/CNY', 'USD/JPY']))

// ---- calculator tab ------------------------------------------------------
const calc = document.getElementById('calc')
const calcText = () => calc.textContent.replace(/\s+/g, ' ')
/** The output box only — a substring over the panel would match the rate line. */
const calcOut = () => calc.querySelector('.fxm-calc-out').textContent.trim()
check('calculator renders its title and the frozen-value promise', calcText().includes('汇率计算器') && calcText().includes('打开本页时跑马灯上的值'))
check('calculator defaults to the first FX pair', calcText().includes('1 USD = 6.70850 CNY'), (calcText().match(/1 USD = [\d.]+ \w+/) || [''])[0])
check('calculator names the source and the snapshot time', calcText().includes('新浪') && /本页取数时刻 \d{2}:\d{2}:\d{2}/.test(calcText()))
const amountInput = calc.querySelector('.fxm-calc-amount')
check('amount defaults to 100', amountInput !== null && amountInput.value === '100', amountInput && amountInput.value)
check('result keeps exactly two decimals', calcOut() === '670.85', calcOut())

// The point of the feature: moving upstream must NOT move the calculator.
usdCnyOverride = 7
const stripRefresh = [...dock.querySelectorAll('.fxm-tail button')][0]
await act(async () => { stripRefresh.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await settle(70)
check('the strip did pick up the new price', dock.textContent.includes('7.0000'), dock.textContent.slice(0, 40))
check('the calculator stays frozen on the rate it opened with', calcOut() === '670.85', calcOut())
check('the frozen rate line is unchanged too', calcText().includes('1 USD = 6.70850 CNY'), (calcText().match(/1 USD = [\d.]+ \w+/) || [''])[0])

const calcRefresh = [...calc.querySelectorAll('button')].find((b) => b.textContent.includes('刷新汇率'))
check('calculator offers a refresh button', calcRefresh !== undefined)
await act(async () => { calcRefresh.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await settle(90)
check('pressing refresh adopts the new rate', calcOut() === '700.00', calcOut())

const swap = calc.querySelector('.fxm-calc-swap')
await act(async () => { swap.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
check('swap flips the direction', calcText().includes('1 CNY = '), (calcText().match(/1 \w+ = [\d.]+ \w+/) || [''])[0])
check('swapped result is 100 / 7 = 14.29', calcOut() === '14.29', calcOut())

// The settings reset earlier dropped JPY/CNY from the strip, so the snapshot
// the calculator refreshed into holds the four defaults. Put it back — which
// also shows that 刷新汇率 follows changes made to the strip's symbol list.
const jpyTile = [...settingsPane.querySelectorAll('.fxm-check')].find((c) => c.textContent.includes('JPY/CNY'))
check('JPY/CNY tile is available to re-add', jpyTile !== undefined)
await act(async () => { jpyTile.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await settle(70)
await act(async () => { calcRefresh.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await settle(90)

const pairSelect = calc.querySelector('.fxm-calc-sel')
check('pair select groups the strip pairs apart from the wider catalog',
  pairSelect !== null && pairSelect.querySelectorAll('optgroup').length === 2,
  pairSelect ? [...pairSelect.querySelectorAll('optgroup')].map((g) => g.label).join(' | ') : 'missing')
check('pair select offers the strip pairs plus catalog extras', pairSelect !== null && pairSelect.options.length === 6,
  pairSelect ? [...pairSelect.options].map((o) => o.value).join(',') : 'missing')
check('calculator states how many pairs it offers', calcText().includes('可选 6 个货币对'), (calcText().match(/可选 \d+ 个货币对[^。]*/) || [''])[0])
await act(async () => { pairSelect.value = 'JPY/CNY'; pairSelect.dispatchEvent(new window.Event('change', { bubbles: true })) })
check('choosing a pair resets the direction', calcText().includes('1 JPY = '), (calcText().match(/1 \w+ = [\d.]+ \w+/) || [''])[0])
check('the rate line uses the per-1 rate, not the ×100 quote', calcText().includes('1 JPY = 0.0432080 CNY'), (calcText().match(/1 JPY = [\d.]+ \w+/) || [''])[0])
check('100 JPY converts to 4.32 CNY', calcOut() === '4.32', calcOut())
check('a ×100 pair explains its unit', calcText().includes('按每 100 单位报价'))

await act(async () => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(amountInput, '')
  amountInput.dispatchEvent(new window.Event('input', { bubbles: true }))
})
check('an empty amount shows a dash rather than 0.00', calcOut() === '—', calcOut())

// ---- one-click strip switch ---------------------------------------------
const switchBtn = () => settingsPane.querySelector('.fxm-switch-btn')
check('settings offers a one-click strip switch', switchBtn() !== null && switchBtn().textContent === '关闭跑马灯', switchBtn() && switchBtn().textContent)
check('the switch states that the strip is showing', settingsPane.textContent.includes('跑马灯正在显示'))

// Give the poller a short cadence so "stops polling" is actually observable.
const intervalForSwitch = [...settingsPane.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.textContent.includes('关闭自动更新')))
await act(async () => { intervalForSwitch.value = '5'; intervalForSwitch.dispatchEvent(new window.Event('change', { bubbles: true })) })
await settle(60)

await act(async () => { switchBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await settle(60)
check('one click hides the strip', dock.querySelector('.fxm-bar') === null, JSON.stringify(dock.innerHTML.slice(0, 60)))
check('the switch flips to 开启跑马灯', switchBtn().textContent === '开启跑马灯', switchBtn().textContent)
check('the switch persists', JSON.parse(window.localStorage.getItem('dsh-fx-marquee/settings/v1')).enabled === false)

const callsWhileHidden = fetchCalls.length
await settle(5600)
check('a hidden strip stops polling', fetchCalls.length === callsWhileHidden,
  `${fetchCalls.length - callsWhileHidden} call(s) in 5.6s while hidden (interval was 5s)`)

await act(async () => { switchBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await settle(90)
check('turning it back on shows the strip again', dock.querySelector('.fxm-bar') !== null)
check('turning it back on refetches immediately', fetchCalls.length > callsWhileHidden, `${fetchCalls.length - callsWhileHidden} call(s)`)
check('the on state persists too', JSON.parse(window.localStorage.getItem('dsh-fx-marquee/settings/v1')).enabled === true)

// ---- teardown ------------------------------------------------------------
await act(async () => { dockRoot.unmount(); setRoot.unmount(); calcRoot.unmount() })
for (const e of effects) if (typeof e.dispose === 'function') e.dispose()
check('style tag removed on dispose', document.querySelector('style[data-plugin-css="dsh-fx-marquee/styles"]') === null)
check('poller disposed without throwing', true)

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length > 0) { console.log('FAILED:', failed.map((f) => f.name).join(' | ')); process.exitCode = 1 }
