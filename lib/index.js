/**
 * dsh-fx-marquee — Host half.
 *
 * Registers one same-origin JSON route the browser half polls. Fetching lives
 * here because Sina rejects cross-origin/XHR callers without a Referer and
 * answers in GBK; the browser cannot do either. A short in-process cache keeps
 * several open sessions from multiplying upstream traffic.
 * @module dsh-fx-marquee
 */

import { DEFAULT_SYMBOLS, FX_SOURCES, loadQuotes, loadSeries } from './quotes.js'

export const name = 'dsh-fx-marquee'

/** The HTTP carrier this route needs; without it the browser half has no data. */
export const inject = ['webServer']

/** Exact route the client half polls. */
export const QUOTES_PATH = '/plugins/fx-marquee/quotes'

const CACHE_TTL_MS = 25_000
const CACHE_MAX_ENTRIES = 64
const FETCH_TIMEOUT_MS = 12_000

/** symbol-key -> { at, payload } */
const cache = new Map()

/**
 * Fetch one upstream URL as text.
 * @param url - absolute upstream URL.
 * @param opts - `gbk` decodes a GBK body; `referer` adds Sina's required Referer.
 * @returns the status and decoded body.
 */
async function getText(url, opts = {}) {
  const headers = { 'user-agent': 'Mozilla/5.0' }
  if (opts.referer) headers.referer = 'https://finance.sina.com.cn'
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  const buf = Buffer.from(await res.arrayBuffer())
  const text = opts.gbk ? new TextDecoder('gbk').decode(buf) : buf.toString('utf8')
  return { status: res.status, text }
}

/**
 * Resolve the requested symbol list, serving a recent cache entry when hot.
 * The FX source is part of the key: switching sources must not serve the
 * previous source's numbers.
 * @param symbols - the requested symbols.
 * @param fxSource - one of the selectable FX sources.
 * @returns the quotes payload.
 */
async function resolveQuotes(symbols, fxSource) {
  const key = `${fxSource}|${symbols.join(',')}`
  const now = Date.now()
  const hit = cache.get(key)
  if (hit !== undefined && now - hit.at < CACHE_TTL_MS) return hit.payload
  const payload = await loadQuotes(symbols, getText, { fxSource })
  if (cache.size >= CACHE_MAX_ENTRIES) cache.clear()
  cache.set(key, { at: now, payload })
  return payload
}

/**
 * Serve `GET <QUOTES_PATH>[?symbols=a,b&fx=auto&series=1]`.
 * @param req - the incoming request.
 * @param res - the response to own.
 */
async function handleQuotes(req, res) {
  try {
    const query = String(req.url || '').split('?')[1] || ''
    const params = new URLSearchParams(query)
    const raw = params.get('symbols')
    const symbols = raw === null || raw.trim() === ''
      ? DEFAULT_SYMBOLS
      : raw.split(',').map((s) => s.trim()).filter((s) => s !== '')
    // Sparklines cost extra upstream calls, so the client opts in explicitly.
    const wantsSeries = params.get('series') !== '0'
    const requestedSource = params.get('fx')
    const fxSource = FX_SOURCES.includes(requestedSource) ? requestedSource : 'auto'
    const payload = await resolveQuotes(symbols, fxSource)
    let merged = { ...payload, fxSource }
    if (wantsSeries) {
      const { series, errors } = await loadSeries(symbols, getText)
      merged = {
        ...merged,
        series,
        errors: errors.length === 0 ? payload.errors : payload.errors.concat(errors),
      }
    }
    const body = JSON.stringify(merged)
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(body)
  } catch (error) {
    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ ok: false, items: [], errors: [String((error && error.message) || error)] }))
  }
}

/**
 * Register the quote route for as long as this fiber lives.
 * @param ctx - Host context carrying the web server.
 */
export function apply(ctx) {
  ctx.effect(
    () => ctx.webServer.register({ kind: 'exact', path: QUOTES_PATH, handler: handleQuotes }),
    'fx-marquee: quotes route',
  )
}
