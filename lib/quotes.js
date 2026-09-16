/**
 * dsh-fx-marquee — shared quote loader.
 *
 * Pure logic, no DSH/Cordis imports: the persistent Host half injects a native
 * `getText(url, opts)` adapter, and the dynamic Host half injects one built on
 * `ctx.web`. Both therefore run this exact parsing path.
 *
 * Upstreams (all keyless):
 *   FX        Sina  hq.sinajs.cn  fx_s<base><quote>   intraday, GBK, needs Referer
 *   FX backup Frankfurter         api.frankfurter.dev ECB daily reference rates
 *   Index     eastmoney           push2.eastmoney.com
 *   Crypto    Binance             data-api.binance.vision
 */

/** Human labels for the FX pairs Sina/Frankfurter serve. */
export const FX_LABELS = {
  'USD/CNY': '美元/人民币', 'EUR/CNY': '欧元/人民币', 'GBP/CNY': '英镑/人民币',
  'JPY/CNY': '日元/人民币', 'HKD/CNY': '港元/人民币', 'AUD/CNY': '澳元/人民币',
  'CAD/CNY': '加元/人民币', 'SGD/CNY': '新加坡元/人民币', 'CHF/CNY': '瑞士法郎/人民币',
  'NZD/CNY': '新西兰元/人民币', 'EUR/GBP': '欧元/英镑', 'EUR/JPY': '欧元/日元',
  'USD/JPY': '美元/日元', 'EUR/USD': '欧元/美元', 'GBP/USD': '英镑/美元',
  'USD/HKD': '美元/港元', 'USD/SGD': '美元/新加坡元', 'USD/CHF': '美元/瑞士法郎',
  'USD/CAD': '美元/加元', 'USD/AUD': '美元/澳元', 'AUD/USD': '澳元/美元',
  'GBP/JPY': '英镑/日元', 'USD/KRW': '美元/韩元', 'USD/THB': '美元/泰铢',
}

/** Pairs conventionally quoted per 100 units rather than per 1. */
export const FX_SCALE = { 'JPY/CNY': 100 }

/** Eastmoney index ids: market 1 = Shanghai, 0 = Shenzhen. */
export const INDEX_SECIDS = {
  SH000001: '1.000001', SZ399001: '0.399001', SZ399006: '0.399006',
  SH000300: '1.000300', SH000688: '1.000688', SH000905: '1.000905',
  SZ399005: '0.399005',
}

/** Index labels, used when eastmoney's own name is unavailable. */
export const INDEX_LABELS = {
  SH000001: '上证指数', SZ399001: '深证成指', SZ399006: '创业板指',
  SH000300: '沪深300', SH000688: '科创50', SH000905: '中证500', SZ399005: '中小100',
}

/** Crypto display shorthand; unknown pairs fall back to the raw symbol. */
export const CRYPTO_LABELS = {
  BTCUSDT: '比特币', ETHUSDT: '以太坊', SOLUSDT: 'Solana', BNBUSDT: 'BNB',
  XRPUSDT: 'XRP', DOGEUSDT: '狗狗币', ADAUSDT: 'ADA', TONUSDT: 'Toncoin',
}

/** Symbols a fresh install shows: the FX pairs a Chinese user checks first. */
export const DEFAULT_SYMBOLS = ['USD/CNY', 'EUR/CNY', 'GBP/CNY', 'USD/JPY']

/**
 * Selectable FX sources. `auto` walks {@link FX_ORDER} until every requested
 * pair is answered; a named source is used alone so the user can tell which
 * number they are looking at.
 */
export const FX_SOURCES = ['auto', 'sina', 'frankfurter', 'erapi']

/** `auto` fills gaps in this order: intraday first, then the widest daily table. */
export const FX_ORDER = {
  auto: ['sina', 'frankfurter', 'erapi'],
  sina: ['sina'],
  frankfurter: ['frankfurter'],
  erapi: ['erapi'],
}

/** Symbols offered as one-click chips in the editor. */
export const SUGGESTED_SYMBOLS = [
  'USD/CNY', 'EUR/CNY', 'GBP/CNY', 'JPY/CNY', 'HKD/CNY', 'AUD/CNY', 'CAD/CNY', 'SGD/CNY',
  'USD/JPY', 'EUR/USD', 'GBP/USD', 'USD/HKD', 'USD/SGD', 'USD/CHF',
  'SH000001', 'SZ399001', 'SZ399006', 'SH000300',
  'BTCUSDT', 'ETHUSDT',
]

const MAX_SYMBOLS = 24
const SINA_FX_URL = 'https://hq.sinajs.cn/list='
const FRANKFURTER_URL = 'https://api.frankfurter.dev/v1/latest'
const FRANKFURTER_RANGE_URL = 'https://api.frankfurter.dev/v1'
const ER_API_URL = 'https://open.er-api.com/v6/latest'
const EASTMONEY_URL = 'https://push2.eastmoney.com/api/qt/ulist.np/get'
const EASTMONEY_TRENDS_URL = 'https://push2his.eastmoney.com/api/qt/stock/trends2/get'
const BINANCE_URL = 'https://data-api.binance.vision/api/v3/ticker/24hr'
const BINANCE_KLINES_URL = 'https://data-api.binance.vision/api/v3/klines'
const SERIES_LOOKBACK_DAYS = 45
const SERIES_MAX_POINTS = 120
/** How long one cached sparkline stays fresh, per kind (daily FX barely moves). */
const SERIES_TTL_MS = { fx: 1_800_000, index: 180_000, crypto: 300_000 }
/** id -> { at, ttl, points, label, range } */
const seriesCache = new Map()

/**
 * Classify one user symbol.
 * @param raw - the raw symbol text.
 * @returns the kind, or null when the syntax matches nothing supported.
 */
export function classifySymbol(raw) {
  const s = String(raw == null ? '' : raw).trim().toUpperCase().replace(/\s+/g, '')
  if (/^[A-Z]{3}\/[A-Z]{3}$/.test(s)) return { kind: 'fx', id: s, base: s.slice(0, 3), quote: s.slice(4) }
  if (/^(SH|SZ)\d{6}$/.test(s)) return INDEX_SECIDS[s] ? { kind: 'index', id: s, secid: INDEX_SECIDS[s] } : null
  // A crypto pair must end in a real quote asset: a typo like "NONSENSE" would
  // otherwise be sent to Binance, whose 400 would fail the whole batch.
  if (/^[A-Z0-9]{2,10}(USDT|USDC|FDUSD|TUSD|BTC|ETH|BNB|SOL)$/.test(s)) return { kind: 'crypto', id: s }
  return null
}

/**
 * Normalize, de-duplicate, and cap a symbol list.
 * @param symbols - raw user symbols.
 * @returns parsed symbol descriptors in input order.
 */
export function parseSymbols(symbols) {
  const out = []
  const seen = new Set()
  for (const raw of Array.isArray(symbols) ? symbols : []) {
    const parsed = classifySymbol(raw)
    if (!parsed || seen.has(parsed.id)) continue
    seen.add(parsed.id)
    out.push(parsed)
    if (out.length >= MAX_SYMBOLS) break
  }
  return out
}

/** Default decimals for a value, so the marquee stays readable across scales. */
function decimalsFor(value, fallback) {
  if (!Number.isFinite(value) || value === 0) return fallback
  const abs = Math.abs(value)
  if (abs >= 1000) return 2
  if (abs >= 100) return 2
  if (abs >= 1) return 4
  if (abs >= 0.01) return 4
  return 6
}

/** Sina's `var hq_str_x="..."` lines into a code → payload map. */
function parseSinaVariables(text) {
  const out = new Map()
  const re = /var\s+hq_str_([A-Za-z0-9_]+)\s*=\s*"([^"]*)"/g
  let m
  while ((m = re.exec(text)) !== null) out.set(m[1].toLowerCase(), m[2])
  return out
}

/**
 * Parse one Sina FX payload.
 * Field layout: 0 time, 3 prevClose, 6 high, 7 low, 8 last, 9 name,
 * 10 change percent, 11 change amount, last non-empty field = date.
 * @param raw - the quoted payload.
 * @returns the parsed quote, or null when the payload is unusable.
 */
function parseSinaFxPayload(raw) {
  const f = String(raw).split(',')
  if (f.length < 12) return null
  const price = Number(f[8])
  const change = Number(f[11])
  const pct = Number(f[10])
  if (!Number.isFinite(price) || price === 0) return null
  let date = ''
  for (let i = f.length - 1; i >= 0; i--) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(f[i].trim())) { date = f[i].trim(); break }
  }
  return {
    price,
    change: Number.isFinite(change) ? change : null,
    changePct: Number.isFinite(pct) ? pct : null,
    time: (f[0] || '').trim(),
    date,
  }
}

/** One FX batch over Sina; resolves a Map of id → quote for whatever answered. */
async function loadSinaFx(parsed, getText) {
  const codes = parsed.map((p) => `fx_s${p.base.toLowerCase()}${p.quote.toLowerCase()}`)
  const { status, text } = await getText(SINA_FX_URL + codes.join(','), { gbk: true, referer: true })
  if (status !== 200) throw new Error(`sina HTTP ${status}`)
  const vars = parseSinaVariables(text)
  const out = new Map()
  parsed.forEach((p, i) => {
    const payload = vars.get(codes[i])
    if (payload === undefined) return
    const quote = parseSinaFxPayload(payload)
    if (quote === null) return
    out.set(p.id, quote)
  })
  return out
}

/** One FX batch over Frankfurter (ECB daily reference rates), grouped by base. */
async function loadFrankfurterFx(parsed, getText) {
  const byBase = new Map()
  for (const p of parsed) {
    if (!byBase.has(p.base)) byBase.set(p.base, new Set())
    byBase.get(p.base).add(p.quote)
  }
  const out = new Map()
  for (const [base, quotes] of byBase) {
    const url = `${FRANKFURTER_URL}?base=${base}&symbols=${[...quotes].join(',')}`
    const { status, text } = await getText(url)
    if (status !== 200) continue
    let body
    try { body = JSON.parse(text) } catch { continue }
    const rates = body && body.rates ? body.rates : {}
    for (const quote of quotes) {
      const rate = rates[quote]
      if (typeof rate !== 'number') continue
      out.set(`${base}/${quote}`, { price: rate, change: null, changePct: null, time: '', date: String(body.date || '') })
    }
  }
  return out
}

/**
 * One FX batch over open.er-api.com, grouped by base. Its table covers ~166
 * currencies — the pairs ECB does not publish (KRW, THB, TWD, VND, RUB…) come
 * from here — but it is a once-a-day snapshot with no change figure.
 */
async function loadErApiFx(parsed, getText) {
  const byBase = new Map()
  for (const p of parsed) {
    if (!byBase.has(p.base)) byBase.set(p.base, new Set())
    byBase.get(p.base).add(p.quote)
  }
  const out = new Map()
  for (const [base, quotes] of byBase) {
    const { status, text } = await getText(`${ER_API_URL}/${base}`)
    if (status !== 200) continue
    let body
    try { body = JSON.parse(text) } catch { continue }
    if (!body || body.result !== 'success') continue
    const rates = body.rates || {}
    const date = typeof body.time_last_update_utc === 'string'
      ? body.time_last_update_utc.slice(5, 16)
      : ''
    for (const quote of quotes) {
      const rate = rates[quote]
      if (typeof rate !== 'number') continue
      out.set(`${base}/${quote}`, { price: rate, change: null, changePct: null, time: '', date })
    }
  }
  return out
}

/** The loader for each named FX source. */
const FX_LOADERS = {
  sina: loadSinaFx,
  frankfurter: loadFrankfurterFx,
  erapi: loadErApiFx,
}

/**
 * Fill every requested pair from the chosen source, or — for `auto` — from each
 * source in turn until nothing is missing.
 * @param parsed - the `kind: 'fx'` descriptors to resolve.
 * @param getText - the text adapter.
 * @param requested - one of {@link FX_SOURCES}.
 * @returns `{ quotes, sourceOf, errors }`, where `sourceOf` names the source
 *   that actually answered each pair.
 */
async function resolveFx(parsed, getText, requested) {
  const order = FX_ORDER[requested] || FX_ORDER.auto
  const quotes = new Map()
  const sourceOf = new Map()
  const errors = []
  for (const name of order) {
    const missing = parsed.filter((p) => !quotes.has(p.id))
    if (missing.length === 0) break
    try {
      const batch = await FX_LOADERS[name](missing, getText)
      for (const [id, quote] of batch) {
        quotes.set(id, quote)
        sourceOf.set(id, name)
      }
    } catch (e) {
      errors.push(`fx/${name}: ${String((e && e.message) || e)}`)
    }
  }
  // A named source that answered nothing is worth reporting explicitly.
  if (quotes.size === 0 && order.length === 1) {
    errors.push(`fx/${order[0]}: no rates returned`)
  }
  return { quotes, sourceOf, errors }
}

/** One index batch over eastmoney's ulist endpoint. */
async function loadIndices(parsed, getText) {
  const url = `${EASTMONEY_URL}?fltt=2&secids=${encodeURIComponent(parsed.map((p) => p.secid).join(','))}`
    + '&fields=f1,f2,f3,f4,f12,f13,f14'
  const { status, text } = await getText(url)
  if (status !== 200) throw new Error(`eastmoney HTTP ${status}`)
  let body
  try { body = JSON.parse(text) } catch { throw new Error('eastmoney: not JSON') }
  const diff = body && body.data && Array.isArray(body.data.diff) ? body.data.diff : []
  const byKey = new Map(diff.map((d) => [`${d.f13}.${d.f12}`, d]))
  const out = new Map()
  for (const p of parsed) {
    const d = byKey.get(p.secid)
    if (!d || typeof d.f2 !== 'number') continue
    out.set(p.id, {
      price: d.f2,
      change: typeof d.f4 === 'number' ? d.f4 : null,
      changePct: typeof d.f3 === 'number' ? d.f3 : null,
      name: typeof d.f14 === 'string' ? d.f14 : '',
      time: '',
      date: '',
    })
  }
  return out
}

/** One crypto batch over Binance's 24h ticker, degrading to per-symbol calls. */
async function loadCrypto(parsed, getText) {
  const symbols = parsed.map((p) => `"${p.id}"`).join(',')
  const url = `${BINANCE_URL}?symbols=${encodeURIComponent(`[${symbols}]`)}`
  const out = new Map()

  /** Fold one Binance 24h row into the result map. */
  const absorb = (row) => {
    if (!row || typeof row !== 'object') return
    const id = String(row.symbol || '').toUpperCase()
    const price = Number(row.lastPrice)
    if (!id || !Number.isFinite(price)) return
    const pct = Number(row.priceChangePercent)
    const change = Number(row.priceChange)
    out.set(id, {
      price,
      change: Number.isFinite(change) ? change : null,
      changePct: Number.isFinite(pct) ? pct : null,
      name: '',
      time: '',
      date: '',
    })
  }

  const { status, text } = await getText(url)
  if (status === 200) {
    let body
    try { body = JSON.parse(text) } catch { throw new Error('binance: not JSON') }
    if (Array.isArray(body)) body.forEach(absorb)
    if (out.size === parsed.length) return out
  }
  // One bad symbol poisons the whole batch: retry the survivors individually.
  for (const p of parsed) {
    if (out.has(p.id)) continue
    try {
      const one = await getText(`${BINANCE_URL}?symbol=${encodeURIComponent(p.id)}`)
      if (one.status !== 200) continue
      absorb(JSON.parse(one.text))
    } catch { /* unknown pair: leave it out, the caller reports no data */ }
  }
  return out
}

/** Display label: known map first, the upstream's own name, then the raw id. */
function labelFor(parsed, quote, upstreamName) {
  if (parsed.kind === 'fx') return FX_LABELS[parsed.id] || parsed.id
  if (parsed.kind === 'index') return INDEX_LABELS[parsed.id] || upstreamName || parsed.id
  if (parsed.kind === 'crypto') return CRYPTO_LABELS[parsed.id] || parsed.id
  return parsed.id
}

/**
 * Load quotes for one symbol list.
 * @param symbols - raw user symbols.
 * @param getText - adapter `(url, opts) => Promise<{status, text}>`; `opts.gbk`
 *   asks for GBK decoding and `opts.referer` for a Sina-acceptable Referer.
 * @param options - `fxSource` selects the FX table (see {@link FX_SOURCES});
 *   defaults to `'auto'`.
 * @returns `{ ok, updatedAt, items, errors }` — never throws for upstream trouble.
 */
export async function loadQuotes(symbols, getText, options = {}) {
  const fxSource = FX_SOURCES.includes(options.fxSource) ? options.fxSource : 'auto'
  const parsed = parseSymbols(symbols)
  const items = []
  const errors = []
  const fx = parsed.filter((p) => p.kind === 'fx')
  const index = parsed.filter((p) => p.kind === 'index')
  const crypto = parsed.filter((p) => p.kind === 'crypto')

  const fxResolution = fx.length > 0
    ? await resolveFx(fx, getText, fxSource)
    : { quotes: new Map(), sourceOf: new Map(), errors: [] }
  const fxQuotes = fxResolution.quotes
  for (const message of fxResolution.errors) errors.push(message)

  const batches = [
    ['index', index, loadIndices],
    ['crypto', crypto, loadCrypto],
  ]
  const extra = new Map()
  for (const [kind, group, loader] of batches) {
    if (group.length === 0) continue
    try {
      const got = await loader(group, getText)
      for (const [id, quote] of got) extra.set(id, quote)
    } catch (e) {
      errors.push(`${kind}: ${String((e && e.message) || e)}`)
    }
  }

  for (const p of parsed) {
    const quote = p.kind === 'fx' ? fxQuotes.get(p.id) : extra.get(p.id)
    if (!quote) {
      items.push({
        id: p.id, kind: p.kind, label: labelFor(p, null, ''), price: null, raw: null,
        scale: 1, change: null, changePct: null, decimals: 4,
        source: p.kind, time: '', date: '', error: 'no data',
      })
      continue
    }
    const scale = p.kind === 'fx' ? (FX_SCALE[p.id] || 1) : 1
    const scaled = quote.price * scale
    items.push({
      id: p.id,
      kind: p.kind,
      label: labelFor(p, quote, quote.name),
      price: scaled,
      raw: quote.price,
      scale,
      change: quote.change === null ? null : quote.change * scale,
      changePct: quote.changePct,
      decimals: decimalsFor(scaled, p.kind === 'crypto' ? 2 : 4),
      source: p.kind === 'fx' ? (fxResolution.sourceOf.get(p.id) || fxSource) : p.kind,
      time: quote.time || '',
      date: quote.date || '',
    })
  }

  return {
    ok: items.some((it) => it.price !== null),
    updatedAt: new Date().toISOString(),
    items,
    errors,
  }
}

/* ------------------------------------------------------------------ series */

/** Round hard for transport: a sparkline's shape survives 6 significant digits. */
function slim(value) {
  const n = Number(value)
  return Number.isFinite(n) ? Number(n.toPrecision(6)) : null
}

/**
 * Keep the newest samples, evenly thinned, so the payload stays bounded.
 * Labels are thinned in lockstep — one label per surviving point.
 * @param points - sample values.
 * @param labels - per-sample labels, aligned with `points`.
 * @param max - upper bound on the returned sample count.
 * @returns aligned `{ points, labels }`.
 */
function thinSeries(points, labels, max) {
  const kept = []
  for (let i = 0; i < points.length; i++) {
    if (!Number.isFinite(points[i])) continue
    kept.push({ point: points[i], label: labels[i] === undefined ? '' : String(labels[i]) })
  }
  if (kept.length <= max) return { points: kept.map((k) => k.point), labels: kept.map((k) => k.label) }
  const step = Math.ceil(kept.length / max)
  const out = []
  for (let i = 0; i < kept.length; i += step) out.push(kept[i])
  const last = kept[kept.length - 1]
  if (out[out.length - 1] !== last) out.push(last)
  return { points: out.map((k) => k.point), labels: out.map((k) => k.label) }
}

/** FX series: Frankfurter's daily reference series, one request per base. */
async function loadFrankfurterSeries(parsed, getText) {
  const byBase = new Map()
  for (const p of parsed) {
    if (!byBase.has(p.base)) byBase.set(p.base, new Set())
    byBase.get(p.base).add(p.quote)
  }
  const today = new Date()
  const start = new Date(today.getTime() - SERIES_LOOKBACK_DAYS * 86_400_000)
  const iso = (d) => d.toISOString().slice(0, 10)
  const out = new Map()
  for (const [base, quotes] of byBase) {
    const url = `${FRANKFURTER_RANGE_URL}/${iso(start)}..${iso(today)}?base=${base}&symbols=${[...quotes].join(',')}`
    const { status, text } = await getText(url)
    if (status !== 200) continue
    let body
    try { body = JSON.parse(text) } catch { continue }
    const rates = body && body.rates ? body.rates : {}
    const dates = Object.keys(rates).sort()
    for (const quote of quotes) {
      const points = []
      const labels = []
      for (const date of dates) {
        const row = rates[date]
        if (row && typeof row[quote] === 'number') {
          points.push(slim(row[quote]))
          labels.push(date.slice(5))
        }
      }
      if (points.length < 2) continue
      // Keep every FX point: a 45-day window is only ~31 business days, so the
      // label can name the real plotted count rather than a thinning target.
      const kept = thinSeries(points, labels, 32)
      out.set(`${base}/${quote}`, {
        points: kept.points,
        labels: kept.labels,
        label: `近 ${kept.points.length} 个交易日`,
        range: dates.length > 0 ? `${dates[0]} → ${dates[dates.length - 1]}` : '',
      })
    }
  }
  return out
}

/** Index series: eastmoney's intraday minute line, one request per index. */
async function loadEastmoneySeries(parsed, getText) {
  const out = new Map()
  for (const p of parsed) {
    const url = `${EASTMONEY_TRENDS_URL}?secid=${encodeURIComponent(p.secid)}`
      + '&fields1=f1,f2,f3,f4&fields2=f51,f53&iscr=0&ndays=1'
    const { status, text } = await getText(url)
    if (status !== 200) continue
    let body
    try { body = JSON.parse(text) } catch { continue }
    const rows = body && body.data && Array.isArray(body.data.trends) ? body.data.trends : []
    const points = []
    const labels = []
    let first = ''
    let last = ''
    for (const row of rows) {
      const comma = String(row).indexOf(',')
      if (comma < 0) continue
      const value = Number(String(row).slice(comma + 1))
      if (!Number.isFinite(value)) continue
      const stamp = String(row).slice(0, comma)
      if (first === '') first = stamp
      last = stamp
      points.push(slim(value))
      labels.push(stamp.slice(11) || stamp)
    }
    if (points.length < 2) continue
    const kept = thinSeries(points, labels, SERIES_MAX_POINTS)
    out.set(p.id, {
      points: kept.points,
      labels: kept.labels,
      label: '今日分时',
      range: `${first} → ${last}`,
    })
  }
  return out
}

/** Crypto series: Binance 1h closes, one request per symbol. */
async function loadBinanceSeries(parsed, getText) {
  const out = new Map()
  for (const p of parsed) {
    const url = `${BINANCE_KLINES_URL}?symbol=${encodeURIComponent(p.id)}&interval=1h&limit=48`
    const { status, text } = await getText(url)
    if (status !== 200) continue
    let body
    try { body = JSON.parse(text) } catch { continue }
    if (!Array.isArray(body)) continue
    const points = []
    const labels = []
    for (const row of body) {
      if (!Array.isArray(row)) continue
      const value = slim(row[4])
      if (value === null) continue
      points.push(value)
      labels.push(new Date(row[0]).toISOString().slice(5, 16).replace('T', ' '))
    }
    if (points.length < 2) continue
    const kept = thinSeries(points, labels, 48)
    out.set(p.id, {
      points: kept.points,
      labels: kept.labels,
      label: '近 48 小时',
      range: `${labels[0]} → ${labels[labels.length - 1]}`,
    })
  }
  return out
}

/**
 * Sparkline points per symbol, cached per kind so the marquee's fast poll does
 * not re-pull daily history.
 * @param symbols - the requested symbols.
 * @param getText - the same text adapter `loadQuotes` uses.
 * @returns `{ series: { [id]: { points, labels, label, range } }, errors }`.
 */
export async function loadSeries(symbols, getText) {
  const parsed = parseSymbols(symbols)
  const errors = []
  const now = Date.now()
  const stale = parsed.filter((p) => {
    const hit = seriesCache.get(p.id)
    return hit === undefined || now - hit.at >= hit.ttl
  })
  const groups = [
    ['fx', stale.filter((p) => p.kind === 'fx'), loadFrankfurterSeries],
    ['index', stale.filter((p) => p.kind === 'index'), loadEastmoneySeries],
    ['crypto', stale.filter((p) => p.kind === 'crypto'), loadBinanceSeries],
  ]
  for (const [kind, group, loader] of groups) {
    if (group.length === 0) continue
    try {
      const got = await loader(group, getText)
      for (const [id, entry] of got) {
        seriesCache.set(id, {
          at: now,
          ttl: SERIES_TTL_MS[kind],
          points: entry.points,
          labels: entry.labels,
          label: entry.label,
          range: entry.range,
        })
      }
    } catch (e) {
      errors.push(`series/${kind}: ${String((e && e.message) || e)}`)
    }
  }
  if (seriesCache.size > 256) seriesCache.clear()
  const series = {}
  for (const p of parsed) {
    const hit = seriesCache.get(p.id)
    if (hit === undefined) continue
    series[p.id] = { points: hit.points, labels: hit.labels === undefined ? [] : hit.labels, label: hit.label, range: hit.range }
  }
  return { series, errors }
}
