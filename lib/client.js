/**
 * dsh-fx-marquee — browser half.
 *
 * Two surfaces over one set of module-scope stores:
 *   - `conversation.input.dock` — the scrolling strip above the composer
 *   - `settings.section`        — the settings page that owns the symbol list
 * Both read the same settings store, so an edit in either place is visible in
 * the other immediately, and a single poller (owned by the plugin fiber) feeds
 * both. Preferences persist in localStorage.
 */
window.__ModuleLoader__.load({
  id: 'dsh-fx-marquee',
  factory: (require) => {
    const React = require('react')
    const module = { exports: {} }
    const exports = module.exports
    const h = React.createElement

    const ROUTE = '/plugins/fx-marquee/quotes'
    const STORAGE_KEY = 'dsh-fx-marquee/settings/v1'
    const DEFAULT_SYMBOLS = ['USD/CNY', 'EUR/CNY', 'GBP/CNY', 'USD/JPY']
    /** 0 means "manual only": the ↻ button still refreshes. */
    const INTERVALS = [0, 5, 10, 20, 30, 60, 300]
    const INTERVAL_LABELS = { 0: '关闭自动更新', 5: '5 秒', 10: '10 秒', 20: '20 秒', 30: '30 秒', 60: '1 分钟', 300: '5 分钟' }
    /** Selectable FX sources; `auto` is the shipped default. */
    const FX_SOURCES = ['auto', 'sina', 'frankfurter', 'erapi']
    const FX_SOURCE_LABELS = {
      auto: '自动选择（推荐）',
      sina: '新浪财经 · 盘中即期',
      frankfurter: 'ECB · 每日参考价',
      erapi: 'ER-API · 166 个币种',
    }
    const FX_SOURCE_NOTES = {
      auto: '按「新浪财经 → ECB → ER-API」依次尝试，谁先给出该货币对就用谁。盘中价优先，取不到时自动退回每日参考价。',
      sina: '新浪财经的即期汇率，盘中更新，带当日涨跌幅。缺点是需要它自家的校验，偶尔会整个不可用（此时不会自动切换）。',
      frankfurter: '欧洲央行每个工作日的参考价，约北京时间 16:00–17:00 更新一次，没有当日涨跌幅。币种约 30 个（不含韩元、泰铢、越南盾）。',
      erapi: 'open.er-api.com 的每日牌价，覆盖 166 个币种，韩元/泰铢/台币/越南盾/卢布等都有。每日更新一次，没有当日涨跌幅。',
    }
    /** Short tag shown next to a quote so the number's origin is never a guess. */
    const SOURCE_TAGS = { sina: '新浪', frankfurter: 'ECB', erapi: 'ER-API', index: '东财', crypto: 'Binance' }
    /** Trend route the detail chart queries for one symbol at a chosen shape. */
    const TREND_PATH = '/plugins/fx-marquee/trend'
    /** Chart granularities; the Host reports which ones a given symbol can serve. */
    const CHART_UNITS = ['auto', 'hour', 'day', 'month']
    const CHART_UNIT_LABELS = { auto: '自动', hour: '小时', day: '天', month: '月' }
    /** Sample counts, every one a multiple of 7; the Host sends the authority. */
    const CHART_POINTS = [14, 21, 28, 35, 42, 49, 56]
    /** The pairs offered as checkboxes on the settings page. */
    const FX_PRESETS = [
      'USD/CNY', 'EUR/CNY', 'GBP/CNY', 'JPY/CNY', 'HKD/CNY', 'AUD/CNY',
      'CAD/CNY', 'SGD/CNY', 'CHF/CNY', 'NZD/CNY', 'EUR/USD', 'GBP/USD',
      'USD/JPY', 'USD/HKD', 'USD/SGD', 'USD/CHF', 'USD/CAD', 'AUD/USD', 'EUR/JPY',
    ]
    const MARKET_PRESETS = ['SH000001', 'SZ399001', 'SZ399006', 'SH000300', 'BTCUSDT', 'ETHUSDT']
    /**
     * The calculator's own catalog: the pairs it offers beyond whatever the
     * strip happens to carry. Kept within the Host's 24-symbol cap, and verified
     * to resolve on every FX source (Sina answers all 24 in one request).
     */
    const CALC_PAIRS = [
      'USD/CNY', 'EUR/CNY', 'GBP/CNY', 'JPY/CNY', 'HKD/CNY', 'AUD/CNY',
      'CAD/CNY', 'SGD/CNY', 'CHF/CNY', 'NZD/CNY',
      'EUR/USD', 'GBP/USD', 'USD/JPY', 'USD/HKD', 'USD/SGD', 'USD/CHF',
      'USD/CAD', 'AUD/USD', 'EUR/JPY', 'GBP/JPY', 'EUR/GBP',
      'USD/KRW', 'USD/THB', 'USD/TWD',
    ]

    const CSS = [
      '.fxm-bar{position:relative;display:flex;align-items:center;gap:10px;height:30px;padding:0 10px;',
      'border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);',
      'color:var(--dsw-alias-label-primary);font-size:12px;line-height:1;overflow:hidden;box-sizing:border-box}',
      '.fxm-viewport{flex:1 1 auto;overflow:hidden;position:relative}',
      '.fxm-track{display:flex;align-items:center;width:max-content;white-space:nowrap;animation-name:fxm-scroll;',
      'animation-timing-function:linear;animation-iteration-count:infinite}',
      '.fxm-track.fxm-static{animation:none;width:100%;justify-content:center}',
      '.fxm-track.fxm-paused,.fxm-bar:hover .fxm-track{animation-play-state:paused}',
      '.fxm-group{display:flex;align-items:center}',
      '@keyframes fxm-scroll{from{transform:translateX(0)}to{transform:translateX(-50%)}}',
      '.fxm-item{display:inline-flex;align-items:center;gap:6px;height:100%;padding:0 12px;cursor:pointer;',
      'border:0;border-right:1px solid var(--dsw-alias-border-l1);background:transparent;color:inherit;',
      'font:inherit;line-height:1;white-space:nowrap}',
      '.fxm-item:hover,.fxm-item.fxm-item-active{background:var(--dsw-alias-bg-layer-2)}',
      '.fxm-label{color:var(--dsw-alias-label-secondary)}',
      '.fxm-price{font-variant-numeric:tabular-nums;font-weight:600}',
      '.fxm-pct{font-variant-numeric:tabular-nums;font-size:11px}',
      '.fxm-spark{display:block;flex:0 0 auto;overflow:visible}',
      '.fxm-flat{color:var(--dsw-alias-label-secondary)}',
      '.fxm-up{color:var(--dsw-alias-state-error-primary)}',
      '.fxm-down{color:var(--dsw-alias-state-success-primary)}',
      '.fxm-us .fxm-up{color:var(--dsw-alias-state-success-primary)}',
      '.fxm-us .fxm-down{color:var(--dsw-alias-state-error-primary)}',
      '.fxm-nodata{color:var(--dsw-alias-label-secondary);opacity:.7}',
      '.fxm-tail{display:flex;align-items:center;gap:6px;flex:0 0 auto}',
      '.fxm-stamp{color:var(--dsw-alias-label-secondary);font-size:11px;font-variant-numeric:tabular-nums}',
      '.fxm-btn{display:inline-flex;align-items:center;justify-content:center;height:20px;min-width:20px;padding:0 5px;',
      'border:1px solid var(--dsw-alias-border-l1);border-radius:5px;background:transparent;cursor:pointer;',
      'color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1}',
      '.fxm-btn:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}',
      '.fxm-panel{position:fixed;z-index:9999;padding:12px;box-sizing:border-box;overflow-y:auto;',
      'overscroll-behavior:contain;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;',
      'background:var(--dsw-alias-bg-layer-1);box-shadow:0 10px 32px rgba(0,0,0,.28);',
      'color:var(--dsw-alias-label-primary);font-size:12px}',
      '.fxm-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center}',
      '.fxm-sec{margin-top:10px}',
      '.fxm-sec-title{color:var(--dsw-alias-label-secondary);margin-bottom:6px}',
      '.fxm-chip{display:inline-flex;align-items:center;gap:5px;padding:3px 7px;border-radius:6px;cursor:pointer;',
      'border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:inherit;font-size:11px}',
      '.fxm-chip:hover{border-color:var(--dsw-alias-brand-primary)}',
      '.fxm-chip-x{opacity:.6;font-size:11px}',
      '.fxm-input{flex:1 1 120px;height:26px;padding:0 8px;box-sizing:border-box;border-radius:6px;',
      'border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:inherit;font-size:12px}',
      '.fxm-note{color:var(--dsw-alias-label-secondary);font-size:11px;margin-top:8px;line-height:1.6}',
      '.fxm-err{color:var(--dsw-alias-state-warn-primary);font-size:11px}',
      '.fxm-sel{height:26px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);',
      'background:var(--dsw-alias-bg-base);color:inherit;font-size:12px}',
      // The detail chart's two selects, kept on one line under the header.
      '.fxm-chartctl{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:8px 0 2px}',
      '.fxm-ctl{display:inline-flex;align-items:center;gap:5px;color:var(--dsw-alias-label-secondary);font-size:11px}',
      '.fxm-ctl select{height:24px;padding:0 4px;border-radius:6px;font-size:11px;',
      'border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:inherit}',
      '.fxm-ctl select:disabled{opacity:.45}',
      '.fxm-detail-head{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}',
      '.fxm-detail-price{font-size:20px;font-weight:600;font-variant-numeric:tabular-nums}',
      '.fxm-chart{position:relative;margin:8px 0 4px}',
      '.fxm-grid{stroke:var(--dsw-alias-border-l1);stroke-width:1;stroke-dasharray:3 3}',
      '.fxm-axis{fill:var(--dsw-alias-label-secondary);font-size:9px;font-variant-numeric:tabular-nums}',
      '.fxm-cross{stroke:var(--dsw-alias-label-secondary);stroke-width:1;stroke-dasharray:2 2;opacity:.8}',
      '.fxm-tip{position:absolute;z-index:2;pointer-events:none;padding:3px 6px;border-radius:5px;',
      'white-space:nowrap;font-size:11px;line-height:1.35;border:1px solid var(--dsw-alias-border-l2);',
      'background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);',
      'box-shadow:0 2px 8px rgba(0,0,0,.18)}',
      '.fxm-tip b{font-variant-numeric:tabular-nums}',
      '.fxm-tip-x{color:var(--dsw-alias-label-secondary)}',
      '.fxm-session{display:flex;align-items:center;gap:6px;margin-top:9px;padding-top:8px;',
      'border-top:1px solid var(--dsw-alias-border-l1);font-size:12px}',
      '.fxm-session-sub{display:flex;justify-content:space-between;gap:10px;margin-top:2px;',
      'color:var(--dsw-alias-label-secondary);font-size:11px}',
      '.fxm-dot{width:7px;height:7px;border-radius:50%;flex:0 0 auto;background:currentColor}',
      '.fxm-off .fxm-dot{opacity:.75}',
      '.fxm-stats{display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;font-size:11px}',
      '.fxm-stat{display:flex;justify-content:space-between;gap:8px}',
      '.fxm-stat b{font-weight:600;font-variant-numeric:tabular-nums}',
      '.fxm-set{padding:2px 2px 28px;max-width:640px;color:var(--dsw-alias-label-primary)}',
      '.fxm-set h2{margin:0 0 6px;font-size:15px;font-weight:600}',
      '.fxm-set h3{margin:20px 0 8px;font-size:13px;font-weight:600}',
      '.fxm-set p{margin:0 0 8px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.7}',
      '.fxm-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(108px,1fr));gap:6px}',
      '.fxm-check{display:flex;align-items:center;gap:6px;padding:6px 8px;border-radius:6px;cursor:pointer;',
      'border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);font-size:12px;',
      'color:var(--dsw-alias-label-primary)}',
      '.fxm-check:hover{border-color:var(--dsw-alias-border-l2)}',
      '.fxm-check.fxm-on{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2)}',
      '.fxm-box{width:13px;height:13px;flex:0 0 auto;border-radius:3px;border:1px solid var(--dsw-alias-border-l2);',
      'display:inline-flex;align-items:center;justify-content:center;font-size:10px;line-height:1}',
      '.fxm-check.fxm-on .fxm-box{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
      '.fxm-preview{display:flex;flex-wrap:wrap;gap:14px;padding:10px;border-radius:8px;',
      'border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);font-size:12px}',
      '.fxm-preview .fxm-item{border-right:0;padding:0;height:auto}',
      '.fxm-empty{color:var(--dsw-alias-label-secondary);font-size:12px}',
      '.fxm-set select{height:28px}',
      '.fxm-set-switch{display:flex;align-items:center;justify-content:space-between;gap:12px;',
      'padding:12px 14px;margin:0 0 6px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;',
      'background:var(--dsw-alias-bg-layer-1)}',
      '.fxm-set-switch b{font-size:13px}',
      '.fxm-switch-btn{height:32px;padding:0 16px;border-radius:8px;cursor:pointer;font-size:13px;',
      'border:1px solid var(--dsw-alias-brand-primary);background:transparent;color:var(--dsw-alias-brand-primary)}',
      '.fxm-switch-btn:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.fxm-switch-btn.fxm-quiet{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}',
      '.fxm-calc{padding:22px 24px 28px;max-width:660px;margin:0 auto;color:var(--dsw-alias-label-primary)}',
      '.fxm-calc h2{margin:0 0 6px;font-size:16px;font-weight:600}',
      '.fxm-calc .fxm-sub{margin:0 0 16px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.7}',
      '.fxm-calc-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;',
      'background:var(--dsw-alias-bg-layer-1);padding:16px}',
      '.fxm-calc-row{display:flex;align-items:center;gap:10px}',
      '.fxm-calc-amount{flex:1 1 auto;height:46px;padding:0 12px;box-sizing:border-box;border-radius:8px;',
      'border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:inherit;',
      'font-size:20px;font-variant-numeric:tabular-nums;text-align:right}',
      '.fxm-calc-row-end{justify-content:flex-end}',
      '.fxm-calc-out{flex:1 1 auto;height:46px;display:flex;align-items:center;justify-content:flex-end;',
      'padding:0 12px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);font-size:20px;font-weight:600;',
      'font-variant-numeric:tabular-nums;overflow:hidden;white-space:nowrap}',
      '.fxm-calc-cur{width:76px;text-align:center;font-weight:600;font-size:13px}',
      '.fxm-calc-swap{width:34px;height:34px;margin:8px 0;border-radius:50%;cursor:pointer;',
      'border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:inherit;font-size:14px}',
      '.fxm-calc-swap:hover{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
      '.fxm-calc-meta{margin-top:14px;font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.9}',
      '.fxm-calc-meta b{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}',
      '.fxm-calc-actions{margin-top:14px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
      '.fxm-calc-btn{height:30px;padding:0 12px;border-radius:7px;cursor:pointer;font-size:12px;',
      'border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:inherit}',
      '.fxm-calc-btn:hover{border-color:var(--dsw-alias-brand-primary)}',
      '.fxm-calc-btn[disabled]{opacity:.55;cursor:default}',
      '.fxm-calc-sel{height:30px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1);',
      'background:var(--dsw-alias-bg-base);color:inherit;font-size:12px}',
      '.fxm-frozen{color:var(--dsw-alias-state-warn-primary)}',
    ].join('')

    /* ------------------------------------------------------------- stores */

    /** A tiny observable store: one value, many subscribers, optional persist. */
    function createStore(initial, persist) {
      let state = initial
      const listeners = new Set()
      return {
        get: () => state,
        set: (next) => {
          state = next
          if (persist) persist(next)
          for (const listener of [...listeners]) listener()
        },
        subscribe: (listener) => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
      }
    }

    const isSymbol = (v) => typeof v === 'string' && v.trim() !== ''

    /** Read persisted preferences, repairing anything malformed. */
    function readSettings() {
      const fallback = { symbols: DEFAULT_SYMBOLS.slice(), intervalSec: 20, scheme: 'cn', sparkline: true, fxSource: 'auto', enabled: true, chartUnit: 'auto', chartPoints: 28 }
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        if (raw === null) return fallback
        const parsed = JSON.parse(raw)
        const symbols = Array.isArray(parsed && parsed.symbols) ? parsed.symbols.filter(isSymbol).slice(0, 24) : []
        return {
          symbols: symbols.length > 0 ? symbols : fallback.symbols,
          intervalSec: INTERVALS.includes(parsed && parsed.intervalSec) ? parsed.intervalSec : fallback.intervalSec,
          scheme: parsed && parsed.scheme === 'us' ? 'us' : 'cn',
          sparkline: !(parsed && parsed.sparkline === false),
          fxSource: FX_SOURCES.includes(parsed && parsed.fxSource) ? parsed.fxSource : fallback.fxSource,
          enabled: !(parsed && parsed.enabled === false),
          chartUnit: CHART_UNITS.includes(parsed && parsed.chartUnit) ? parsed.chartUnit : fallback.chartUnit,
          chartPoints: CHART_POINTS.includes(parsed && parsed.chartPoints) ? parsed.chartPoints : fallback.chartPoints,
        }
      } catch {
        return fallback
      }
    }

    /** Persist preferences; a storage failure must never break rendering. */
    function persistSettings(next) {
      try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* quota/denied */ }
    }

    const settingsStore = createStore(readSettings(), persistSettings)
    const quotesStore = createStore({ items: [], series: {}, updatedAt: '', error: '', loading: false })

    /** Subscribe a component to a store. */
    function useStore(store) {
      return React.useSyncExternalStore(store.subscribe, store.get)
    }

    /* -------------------------------------------------------- sessions */

    /**
     * Market session models. Each is evaluated in its own market's time zone so
     * the answer never depends on where this machine sits; `zone` only shapes
     * the clock read, the arithmetic is plain minutes since midnight.
     */
    const SESSIONS = {
      crypto: {
        label: '加密货币',
        city: 'UTC',
        zone: 'UTC',
        schedule: '7×24 连续交易',
        isOpen: () => true,
      },
      index: {
        label: 'A 股',
        city: '北京',
        zone: 'Asia/Shanghai',
        schedule: '周一至周五 09:30–11:30、13:00–15:00（北京时间）',
        isOpen: (c) => c.weekday >= 1 && c.weekday <= 5
          && ((c.minutes >= 570 && c.minutes <= 690) || (c.minutes >= 780 && c.minutes <= 900)),
      },
      fx: {
        label: '全球外汇',
        city: '纽约',
        zone: 'America/New_York',
        schedule: '周日 17:00 – 周五 17:00（纽约时间），周末休市',
        isOpen: (c) => {
          if (c.weekday === 6) return false
          if (c.weekday === 0) return c.minutes >= 17 * 60
          if (c.weekday === 5) return c.minutes < 17 * 60
          return true
        },
      },
    }

    /** The wall clock in one zone, so the panel is meaningful from anywhere. */
    function zoneTimeText(timeMs, timeZone) {
      return new Intl.DateTimeFormat('en-GB', {
        timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      }).format(new Date(timeMs))
    }

    /** Weekday (0 = Sunday) and minutes since midnight, read in one zone. */
    function zoneClock(timeMs, timeZone) {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
      }).formatToParts(new Date(timeMs))
      const pick = (type) => {
        const hit = parts.find((p) => p.type === type)
        return hit === undefined ? '' : hit.value
      }
      const weekday = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[pick('weekday')]
      const hour = Number(pick('hour'))
      const minute = Number(pick('minute'))
      return {
        weekday: weekday === undefined ? 0 : weekday,
        minutes: (Number.isFinite(hour) ? hour % 24 : 0) * 60 + (Number.isFinite(minute) ? minute : 0),
      }
    }

    /** The next open↔closed flip, scanning a minute at a time for up to 8 days. */
    function nextFlip(model, timeMs) {
      const started = model.isOpen(zoneClock(timeMs, model.zone))
      const limit = timeMs + 8 * 86_400_000
      for (let t = timeMs + 60_000; t <= limit; t += 60_000) {
        if (model.isOpen(zoneClock(t, model.zone)) !== started) return { at: t, opens: !started }
      }
      return null
    }

    /** Human countdown to a session boundary. */
    function countdownText(ms) {
      const total = Math.max(0, Math.round(ms / 60_000))
      const days = Math.floor(total / 1440)
      const hours = Math.floor((total % 1440) / 60)
      if (days > 0) return `${days} 天 ${hours} 小时`
      if (hours > 0) return `${hours} 小时 ${total % 60} 分`
      return `${total} 分`
    }

    /**
     * Session status for one symbol kind at one instant.
     * @param kind - the quote kind ('fx' | 'index' | 'crypto').
     * @param timeMs - the instant to judge, normally the system clock.
     * @returns `{ label, schedule, open, countdown }`.
     */
    function sessionStatusFor(kind, timeMs) {
      const model = SESSIONS[kind] === undefined ? SESSIONS.fx : SESSIONS[kind]
      const open = model.isOpen(zoneClock(timeMs, model.zone))
      const flip = nextFlip(model, timeMs)
      return {
        label: model.label,
        city: model.city,
        zone: model.zone,
        schedule: model.schedule,
        open,
        countdown: flip === null ? '' : `${flip.opens ? '距开盘' : '距收盘'} ${countdownText(flip.at - timeMs)}`,
      }
    }

    /** A ticking system-clock reading, so the panel follows the machine. */
    function useNow(intervalMs) {
      const [now, setNow] = React.useState(() => Date.now())
      React.useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), intervalMs)
        return () => window.clearInterval(timer)
      }, [intervalMs])
      return now
    }

    /**
     * Fetch one symbol's series at a chosen granularity.
     *
     * The strip's poll only carries the per-kind `auto` shape for the whole watch
     * list, so a chart asking for hours or months needs its own request. It
     * re-issues whenever the symbol or either choice changes, and the previous
     * reply is kept while the next one is in flight so the panel never blanks.
     *
     * @param symbol - the symbol id, or null when nothing is open.
     * @param unit - `auto` | `hour` | `day` | `month`.
     * @param points - the requested sample count.
     * @returns `{ status, data, error }`; `data` is the Host's reply verbatim.
     */
    function useTrend(symbol, unit, points) {
      const [state, setState] = React.useState({ status: 'idle', data: null, error: '' })
      React.useEffect(() => {
        if (typeof symbol !== 'string' || symbol === '') return undefined
        let alive = true
        setState((prev) => ({ status: 'loading', data: prev.data, error: '' }))
        const url = `${TREND_PATH}?symbol=${encodeURIComponent(symbol)}`
          + `&unit=${encodeURIComponent(unit)}&points=${encodeURIComponent(String(points))}`
        fetch(url, { credentials: 'same-origin' })
          .then((res) => res.json())
          .then((data) => { if (alive) setState({ status: 'ready', data, error: '' }) })
          .catch((error) => {
            if (alive) setState({ status: 'error', data: null, error: String((error && error.message) || error) })
          })
        return () => { alive = false }
      }, [symbol, unit, points])
      return state
    }
    /**
     * Whether the shell is still showing the new-session Hero — whose composer
     * area squeezes a dock strip until the conversation actually starts.
     *
     * Mirrors the conversation package's own `conversationPhase()` rule, which
     * the shell evaluates as `session === undefined || conversation === undefined
     * ? 'blank' : conversationPhase(session, conversation)` and uses for "the
     * header, View ring, and composer layout". An absent prop pair reports false
     * so a shell change can never silently hide the strip everywhere.
     * @param session - SessionSnapshot from the slot's standard props.
     * @param conversation - ConversationSnapshot from those props.
     * @returns true while the Hero is on screen.
     */
    function isHeroPhase(session, conversation) {
      if (session === undefined || conversation === undefined) return false
      const targets = conversation.activeTargets
      const active = (targets !== undefined && targets.size > 0)
        || (session.blank !== true && session.awaitingFirstTurn !== true)
        || session.running === true
      return !active
    }

    /* ---------------------------------------------------------- data flow */

    /** Normalize one typed symbol the same way the Host does. */
    function normalizeSymbol(raw) {
      return String(raw || '').trim().toUpperCase().replace(/\s+/g, '')
    }

    /** Local clock label for the fetch time. */
    function stamp(iso) {
      if (!iso) return ''
      const d = new Date(iso)
      if (Number.isNaN(d.getTime())) return ''
      const p = (n) => String(n).padStart(2, '0')
      return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
    }

    /** Format one quote for display. */
    function formatItem(item) {
      const label = item.scale > 1 ? `${item.label}×${item.scale}` : item.label
      if (item.price === null || item.price === undefined) {
        return { label, price: '—', pct: '', tone: 'fxm-nodata' }
      }
      const price = Number(item.price).toFixed(Number.isFinite(item.decimals) ? item.decimals : 4)
      const pct = item.changePct === null || item.changePct === undefined
        ? ''
        : `${item.changePct > 0 ? '▲' : item.changePct < 0 ? '▼' : '·'}${Math.abs(item.changePct).toFixed(2)}%`
      const tone = item.changePct > 0 ? 'fxm-up' : item.changePct < 0 ? 'fxm-down' : 'fxm-flat'
      return { label, price, pct, tone }
    }

    /** Fetch once and publish into the quotes store. */
    async function refreshNow() {
      const { symbols, sparkline, fxSource } = settingsStore.get()
      if (symbols.length === 0) {
        quotesStore.set({ items: [], series: {}, updatedAt: '', error: '', loading: false })
        return
      }
      quotesStore.set({ ...quotesStore.get(), loading: true })
      try {
        const url = `${ROUTE}?symbols=${encodeURIComponent(symbols.join(','))}`
          + `&series=${sparkline ? 1 : 0}&fx=${encodeURIComponent(fxSource)}`
        const res = await fetch(url, { cache: 'no-store' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const body = await res.json()
        quotesStore.set({
          items: Array.isArray(body.items) ? body.items : [],
          series: body.series && typeof body.series === 'object' ? body.series : {},
          updatedAt: body.updatedAt || '',
          error: Array.isArray(body.errors) && body.errors.length > 0 ? body.errors.join('; ') : '',
          loading: false,
        })
      } catch (error) {
        quotesStore.set({ ...quotesStore.get(), error: String((error && error.message) || error), loading: false })
      }
    }

    /**
     * The one poller for the page. Re-reads the interval on every settings
     * change, refreshes immediately when the symbol list changes, and stops
     * entirely while the interval is 0.
     * @returns a disposer owned by the plugin fiber.
     */
    function startPoller() {
      let stopped = false
      let timer
      /** Everything that changes what the next request must ask for. */
      const queryKey = () => {
        const { symbols, fxSource, sparkline, enabled } = settingsStore.get()
        return `${enabled ? 1 : 0}|${symbols.join(',')}|${fxSource}|${sparkline ? 1 : 0}`
      }
      let lastKey = queryKey()
      const schedule = () => {
        if (stopped) return
        if (timer !== undefined) { window.clearTimeout(timer); timer = undefined }
        const { intervalSec, enabled } = settingsStore.get()
        // A hidden strip polls nothing: the calculator fetches for itself.
        if (enabled && intervalSec > 0) {
          timer = window.setTimeout(() => { void refreshNow().then(schedule) }, intervalSec * 1000)
        }
      }
      const onSettings = () => {
        const key = queryKey()
        const { enabled } = settingsStore.get()
        if (key !== lastKey) {
          lastKey = key
          // Turning the strip back on should show fresh numbers right away.
          if (enabled) void refreshNow().then(schedule)
          else schedule()
        } else {
          schedule()
        }
      }
      const unsubscribe = settingsStore.subscribe(onSettings)
      void refreshNow().then(schedule)
      return () => {
        stopped = true
        unsubscribe()
        if (timer !== undefined) window.clearTimeout(timer)
      }
    }

    /* ---------------------------------------------------------- anchoring */

    /**
     * Anchor a popover to the strip without trusting ancestor overflow: the
     * panel is `position: fixed`, and this reports viewport offsets for the
     * bar's top-right corner, re-measured on resize and on any scroll.
     * @param ref - ref to the bar element.
     * @param open - whether a popover is showing.
     * @returns inline style for the panel, or null while unanchored.
     */
    function usePanelStyle(ref, open) {
      const [style, setStyle] = React.useState(null)
      React.useEffect(() => {
        if (!open) { setStyle(null); return }
        const measure = () => {
          const el = ref.current
          if (el === null) return
          const rect = el.getBoundingClientRect()
          setStyle({
            width: `${Math.max(260, Math.min(360, window.innerWidth - 24))}px`,
            right: `${Math.max(8, window.innerWidth - rect.right)}px`,
            bottom: `${Math.max(8, window.innerHeight - rect.top + 6)}px`,
            maxHeight: `${Math.max(140, rect.top - 12)}px`,
          })
        }
        measure()
        window.addEventListener('resize', measure)
        window.addEventListener('scroll', measure, true)
        return () => {
          window.removeEventListener('resize', measure)
          window.removeEventListener('scroll', measure, true)
        }
      }, [open, ref])
      return style
    }

    /* --------------------------------------------------------- components */

    /** An inline SVG sparkline; the tone class supplies currentColor. */
    function Sparkline(props) {
      const { points, width, height, tone, fill } = props
      const nums = Array.isArray(points) ? points.filter((v) => Number.isFinite(v)) : []
      if (nums.length < 2) return null
      let min = Math.min(...nums)
      let max = Math.max(...nums)
      if (max - min < 1e-12) { max = min + 1; min = min - 1 }
      const stepX = width / (nums.length - 1)
      const scaleY = (v) => height - 1.5 - ((v - min) / (max - min)) * (height - 3)
      let d = ''
      nums.forEach((v, i) => { d += `${i === 0 ? 'M' : 'L'}${(i * stepX).toFixed(2)},${scaleY(v).toFixed(2)}` })
      return h('svg', {
        className: `fxm-spark ${tone}`,
        width,
        height,
        viewBox: `0 0 ${width} ${height}`,
        preserveAspectRatio: 'none',
        focusable: 'false',
        'aria-hidden': 'true',
      },
        fill ? h('path', { d: `${d}L${width},${height}L0,${height}Z`, fill: 'currentColor', opacity: 0.13, stroke: 'none' }) : null,
        h('path', { d, fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round', strokeLinecap: 'round' }),
      )
    }

    /**
     * The detail chart: the cell sparkline's line, plus a value axis, the time
     * endpoints, and a hover readout naming the sample under the pointer. Only
     * the detail surface gets this — a 14px cell sparkline has no room for an
     * axis, and the numbers would be unreadable.
     */
    function TrendChart(props) {
      const { points, labels, decimals, tone, width, height, muted } = props
      const W = Number.isFinite(width) ? width : 314
      const H = Number.isFinite(height) ? height : 96
      const PAD = { top: 8, right: 46, bottom: 15, left: 2 }
      const plotW = W - PAD.left - PAD.right
      const plotH = H - PAD.top - PAD.bottom
      const [hover, setHover] = React.useState(null)

      const nums = Array.isArray(points) ? points.filter((v) => Number.isFinite(v)) : []
      if (nums.length < 2) return null
      const marks = Array.isArray(labels) ? labels : []
      let min = Math.min(...nums)
      let max = Math.max(...nums)
      if (max - min < 1e-12) { max = min + 1; min = min - 1 }
      const span = max - min
      const xAt = (i) => PAD.left + (i * plotW) / (nums.length - 1)
      const yAt = (v) => PAD.top + plotH - ((v - min) / span) * plotH

      let line = ''
      nums.forEach((v, i) => { line += `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(2)},${yAt(v).toFixed(2)}` })
      const base = (PAD.top + plotH).toFixed(2)

      /** Nearest sample to the pointer, in viewBox coordinates. */
      const onMove = (event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        if (rect.width === 0) return
        const local = ((event.clientX - rect.left) / rect.width) * W
        const index = Math.round(((local - PAD.left) / plotW) * (nums.length - 1))
        setHover(Math.max(0, Math.min(nums.length - 1, index)))
      }

      const hoverX = hover === null ? 0 : xAt(hover)
      const hoverY = hover === null ? 0 : yAt(nums[hover])
      const flip = hoverX > PAD.left + plotW * 0.6
      const tipStyle = hover === null ? null : {
        top: `${hoverY.toFixed(1)}px`,
        left: `${(flip ? hoverX - 8 : hoverX + 8).toFixed(1)}px`,
        transform: flip ? 'translate(-100%, -50%)' : 'translateY(-50%)',
      }

      return h('div', { className: 'fxm-chart', style: { width: `${W}px`, maxWidth: '100%' } },
        h('svg', {
          // A closed market draws grey: the line is history, not a live price.
          className: muted === true ? 'fxm-flat' : tone,
          width: W,
          height: H,
          viewBox: `0 0 ${W} ${H}`,
          onMouseMove: onMove,
          onMouseLeave: () => setHover(null),
          'aria-hidden': 'true',
        },
          [max, (max + min) / 2, min].map((tick, i) => h('g', { key: `tick${i}` },
            h('line', {
              className: 'fxm-grid',
              x1: PAD.left, x2: PAD.left + plotW,
              y1: yAt(tick).toFixed(1), y2: yAt(tick).toFixed(1),
            }),
            h('text', {
              className: 'fxm-axis',
              x: W - 2, y: (yAt(tick) + 3).toFixed(1), textAnchor: 'end',
            }, num(tick, decimals)),
          )),
          h('text', { className: 'fxm-axis', x: PAD.left, y: H - 4, textAnchor: 'start' },
            marks.length > 0 ? marks[0] : ''),
          h('text', { className: 'fxm-axis', x: PAD.left + plotW, y: H - 4, textAnchor: 'end' },
            marks.length > 1 ? marks[marks.length - 1] : ''),
          h('path', {
            d: `${line}L${(PAD.left + plotW).toFixed(2)},${base}L${PAD.left},${base}Z`,
            fill: 'currentColor', opacity: 0.13, stroke: 'none',
          }),
          h('path', {
            d: line, fill: 'none', stroke: 'currentColor',
            strokeWidth: 1.4, strokeLinejoin: 'round', strokeLinecap: 'round',
          }),
          hover === null ? null : h('g', null,
            h('line', {
              className: 'fxm-cross',
              x1: hoverX.toFixed(1), x2: hoverX.toFixed(1),
              y1: PAD.top, y2: base,
            }),
            h('circle', {
              cx: hoverX.toFixed(1), cy: hoverY.toFixed(1), r: 3,
              fill: 'currentColor', stroke: 'var(--dsw-alias-bg-layer-1)', strokeWidth: 1.5,
            }),
          ),
        ),
        hover === null ? null : h('div', { className: 'fxm-tip', style: tipStyle },
          h('b', null, num(nums[hover], decimals)),
          marks[hover] === undefined || marks[hover] === ''
            ? null
            : h('span', { className: 'fxm-tip-x' }, ` ${marks[hover]}`),
        ),
      )
    }

    /** Range statistics for the detail panel. */
    function statsOf(points) {
      const nums = Array.isArray(points) ? points.filter((v) => Number.isFinite(v)) : []
      if (nums.length < 2) return null
      const first = nums[0]
      const last = nums[nums.length - 1]
      return {
        min: Math.min(...nums),
        max: Math.max(...nums),
        first,
        last,
        changePct: first === 0 ? null : ((last - first) / first) * 100,
        count: nums.length,
      }
    }

    /** Prettify a stat value at the quote's own precision. */
    function num(value, decimals) {
      return Number.isFinite(value) ? value.toFixed(decimals) : '—'
    }

    /** One marquee cell: label, price, change, optional sparkline. */
    function Cell(props) {
      const { item, series, showSparkline, active, onClick } = props
      const view = formatItem(item)
      const entry = series && series[item.id]
      const points = entry && Array.isArray(entry.points) ? entry.points : null
      return h('button', {
        type: 'button',
        className: `fxm-item${active ? ' fxm-item-active' : ''}`,
        onClick,
        title: item.error ? `${item.id}：${item.error}` : `${item.id}　点击查看走势`,
      },
        h('span', { className: 'fxm-label' }, view.label),
        h('span', { className: 'fxm-price' }, view.price),
        view.pct === '' ? null : h('span', { className: `fxm-pct ${view.tone}` }, view.pct),
        showSparkline && points !== null ? h(Sparkline, { points, width: 46, height: 14, tone: view.tone }) : null,
      )
    }

    /** The click-through chart for one symbol. */
    /**
     * The detail panel: price, chart, range stats and market session, plus the
     * two chart controls — X-axis granularity and how many samples to draw.
     *
     * The strip's poll only carries the `auto` shape, so any other shape comes
     * from the trend route; the polled series stands in until that reply lands.
     * Both choices persist, and a unit the symbol cannot serve is offered as a
     * disabled option rather than dropped, so the control never changes shape.
     */
    function DetailPopover(props) {
      const { item, series, onClose, style } = props
      const settings = useStore(settingsStore)
      const now = useNow(1000)
      const trend = useTrend(item.id, settings.chartUnit, settings.chartPoints)
      const meta = trend.data
      const fetched = meta !== null && Array.isArray(meta.values) && meta.values.length > 1
        ? { points: meta.values, labels: meta.labels, label: meta.label, range: meta.range, unit: meta.unit }
        : null
      const entry = fetched === null ? (series && series[item.id]) : fetched
      const points = entry && Array.isArray(entry.points) ? entry.points : []
      const stat = statsOf(points)
      const decimals = Number.isFinite(item.decimals) ? item.decimals : 4
      const tone = formatItem(item).tone === 'fxm-nodata' ? 'fxm-flat' : formatItem(item).tone
      const view = formatItem(item)
      const market = sessionStatusFor(item.kind, now)
      const clock = new Date(now)
      const pad = (n) => String(n).padStart(2, '0')
      const localTime = `${pad(clock.getHours())}:${pad(clock.getMinutes())}:${pad(clock.getSeconds())}`
      /** Units the Host says this symbol can serve; null until the first reply. */
      const available = meta !== null && Array.isArray(meta.availableUnits) ? meta.availableUnits : null
      const pointOptions = meta !== null && Array.isArray(meta.pointOptions) ? meta.pointOptions : CHART_POINTS
      /** The requested shape was unavailable and the Host served a different one. */
      const servedUnit = entry && entry.unit !== undefined ? entry.unit : settings.chartUnit
      const degraded = settings.chartUnit !== 'auto' && servedUnit !== settings.chartUnit
      // An index's `auto` view is the whole intraday session, which has no
      // meaningful sample count; every other pairing honours the control.
      const countLocked = settings.chartUnit === 'auto' && item.kind === 'index'
      const headline = degraded
        ? `「${CHART_UNIT_LABELS[servedUnit] || servedUnit}」`
        : `${CHART_UNIT_LABELS[settings.chartUnit] || settings.chartUnit}`
      return h('div', { className: 'fxm-panel', style, onMouseDown: (e) => e.stopPropagation() },
        h('div', { className: 'fxm-detail-head' },
          h('strong', null, view.label),
          h('span', { className: `fxm-detail-price ${tone}` }, view.price),
          view.pct === '' ? null : h('span', { className: `fxm-pct ${tone}` }, view.pct),
          h('span', { style: { flex: '1 1 auto' } }),
          h('button', { className: 'fxm-btn', onClick: onClose, title: '关闭' }, '✕'),
        ),
        h('div', { className: 'fxm-chartctl' },
          h('label', { className: 'fxm-ctl' },
            h('span', null, 'X 轴单位'),
            h('select', {
              className: 'fxm-sel',
              value: settings.chartUnit,
              title: '每个取样点代表的时间跨度',
              onChange: (e) => settingsStore.set({ ...settings, chartUnit: e.target.value }),
            }, CHART_UNITS.map((u) => h('option', {
              key: u,
              value: u,
              // Kept visible but unselectable: a hidden option would make the
              // control jump between one and three entries per symbol.
              disabled: available !== null && !available.includes(u),
            }, CHART_UNIT_LABELS[u]))),
          ),
          h('label', { className: 'fxm-ctl' },
            h('span', null, '数据组数'),
            h('select', {
              className: 'fxm-sel',
              value: String(settings.chartPoints),
              disabled: countLocked,
              title: countLocked
                ? '「自动」档位下指数显示全天分时线，组数不适用；切到小时 / 天 / 月即可调整'
                : '走势图上画多少个取样点',
              onChange: (e) => settingsStore.set({ ...settings, chartPoints: Number(e.target.value) }),
            }, pointOptions.map((n) => h('option', { key: n, value: String(n) }, `${n} 组`))),
          ),
          trend.status === 'loading' ? h('span', { className: 'fxm-tip-x' }, '加载中…') : null,
        ),
        stat === null
          ? h('div', { className: 'fxm-note' }, item.error ? `暂无走势数据（${item.error}）` : '正在加载走势数据…')
          : h('div', null,
              h(TrendChart, {
                points,
                labels: entry && entry.labels,
                decimals,
                tone,
                muted: !market.open,
                width: 314,
                height: 96,
              }),
              h('div', { className: 'fxm-stats' },
                h('span', { className: 'fxm-stat' }, h('span', null, '区间最高'), h('b', null, num(stat.max, decimals))),
                h('span', { className: 'fxm-stat' }, h('span', null, '区间最低'), h('b', null, num(stat.min, decimals))),
                h('span', { className: 'fxm-stat' }, h('span', null, '区间涨跌'),
                  h('b', { className: stat.changePct !== null && stat.changePct < 0 ? 'fxm-down' : 'fxm-up' },
                    stat.changePct === null ? '—' : `${stat.changePct > 0 ? '+' : ''}${stat.changePct.toFixed(2)}%`)),
                h('span', { className: 'fxm-stat' }, h('span', null, '取样点'), h('b', null, String(stat.count))),
                h('span', { className: 'fxm-stat' }, h('span', null, '信源'),
                  h('b', null, SOURCE_TAGS[item.source] || item.source || '—')),
              ),
            ),
        h('div', { className: `fxm-session${market.open ? '' : ' fxm-off'}` },
          // The dot carries the day's direction while the market trades, and
          // goes grey the moment it stops — "open" is not itself a colour.
          h('span', { className: `fxm-dot ${market.open ? tone : 'fxm-flat'}` }),
          h('b', null, `${market.label} · ${market.open ? '交易中' : '休市'}`),
          h('span', { style: { flex: '1 1 auto' } }),
          h('span', { className: 'fxm-tip-x' },
            `${market.city} ${zoneTimeText(now, market.zone)}`,
            // The market clock is the one that matters; the machine clock only
            // earns space when the two disagree (travelling, or a foreign box).
            zoneTimeText(now, market.zone) === localTime ? '' : ` · 本机 ${localTime}`),
        ),
        h('div', { className: 'fxm-session-sub' },
          h('span', null, market.schedule),
          market.countdown === '' ? null : h('span', null, market.countdown),
        ),
        h('div', { className: 'fxm-note' },
          // Never let a fallback masquerade as the requested granularity: say
          // plainly which one is on screen and why the other is missing.
          degraded
            ? h('div', { className: 'fxm-err' },
                `「${CHART_UNIT_LABELS[settings.chartUnit]}」该标的暂无数据源，已按 ${headline} 显示`)
            : null,
          entry && entry.label ? `${entry.label}${entry.range ? `　${entry.range}` : ''}` : '',
          item.scale > 1 ? h('div', null, `单位按 ×${item.scale} 展示`) : null,
        ),
      )
    }

    /** The dock strip: marquee, timestamp, refresh, and the detail popover. */
    function TickerBar(props) {
      const settings = useStore(settingsStore)
      const quotes = useStore(quotesStore)
      // Both hooks arrive through the slot's standard props. They are called
      // behind a presence check because the harness's own probe harnesses mount
      // this component without them; the shell's prop set never varies within a
      // mount, so the hook order stays stable.
      const session = props !== null && typeof props.useSession === 'function' ? props.useSession((s) => s) : undefined
      const conversation = props !== null && typeof props.useConversation === 'function' ? props.useConversation((s) => s) : undefined
      const hero = isHeroPhase(session, conversation)
      const [detailId, setDetailId] = React.useState(null)
      const barRef = React.useRef(null)
      const viewportRef = React.useRef(null)
      const groupRef = React.useRef(null)
      const [scrolls, setScrolls] = React.useState(false)
      const popoverOpen = detailId !== null
      const panelStyle = usePanelStyle(barRef, popoverOpen)

      // Measure ONE group: the marquee duplicates it only when the content
      // genuinely overflows, so a strip that fits never shows cells twice.
      React.useEffect(() => {
        const viewport = viewportRef.current
        const group = groupRef.current
        if (viewport === null || group === null) return
        setScrolls(group.scrollWidth > viewport.clientWidth + 8)
      }, [quotes.items, quotes.series, settings.symbols, settings.sparkline])

      // Escape closes, and a click outside the strip dismisses.
      React.useEffect(() => {
        if (!popoverOpen) return
        const onKey = (event) => {
          if (event.key === 'Escape') setDetailId(null)
        }
        const onDown = (event) => {
          const bar = barRef.current
          if (bar !== null && !bar.contains(event.target)) setDetailId(null)
        }
        window.addEventListener('keydown', onKey)
        window.addEventListener('mousedown', onDown)
        return () => {
          window.removeEventListener('keydown', onKey)
          window.removeEventListener('mousedown', onDown)
        }
      }, [popoverOpen])

      const cells = quotes.items.map((item) => h(Cell, {
        key: item.id,
        item,
        series: quotes.series,
        showSparkline: settings.sparkline,
        active: detailId === item.id,
        onClick: () => setDetailId(detailId === item.id ? null : item.id),
      }))
      const groupWidth = groupRef.current === null ? 0 : groupRef.current.scrollWidth
      const duration = scrolls && groupWidth > 0 ? `${Math.max(18, Math.round(groupWidth / 26))}s` : undefined
      const detailItem = detailId === null ? null : (quotes.items.find((i) => i.id === detailId) || null)

      // The settings page's one-click switch takes the strip out of the dock
      // entirely, and the new-session Hero has no room for it. Hooks above have
      // already run, so these early returns are safe.
      if (!settings.enabled) return null
      if (hero) return null

      return h('div', {
        className: settings.scheme === 'us' ? 'fxm-bar fxm-us' : 'fxm-bar',
        ref: barRef,
      },
        h('div', { className: 'fxm-viewport', ref: viewportRef },
          h('div', {
            className: `fxm-track${scrolls ? '' : ' fxm-static'}${popoverOpen ? ' fxm-paused' : ''}`,
            style: duration ? { animationDuration: duration } : undefined,
          },
            h('div', { className: 'fxm-group', ref: groupRef },
              cells.length > 0 ? cells : h('span', { className: 'fxm-item fxm-nodata' }, '加载中…')),
            // The second copy exists only to make the -50% loop seamless.
            scrolls ? h('div', { className: 'fxm-group', 'aria-hidden': 'true' }, cells) : null,
          ),
        ),
        h('div', { className: 'fxm-tail' },
          quotes.error === '' ? null : h('span', { className: 'fxm-err', title: quotes.error }, '⚠'),
          h('span', { className: 'fxm-stamp', title: '设置见「设置 → 汇率跑马灯」' }, stamp(quotes.updatedAt)),
          h('button', {
            className: 'fxm-btn',
            title: '立即刷新',
            onClick: () => { void refreshNow() },
          }, '↻'),
        ),
        detailItem === null || panelStyle === null ? null : h(DetailPopover, {
          item: detailItem,
          series: quotes.series,
          onClose: () => setDetailId(null),
          style: panelStyle,
        }),
      )
    }

    /** The settings page: symbol selection, cadence, display, live preview. */
    function SettingsSection() {
      const settings = useStore(settingsStore)
      const quotes = useStore(quotesStore)
      const [draft, setDraft] = React.useState('')
      const set = settingsStore.set

      const toggle = (id) => {
        set(settings.symbols.includes(id)
          ? { ...settings, symbols: settings.symbols.filter((s) => s !== id) }
          : { ...settings, symbols: settings.symbols.concat(id).slice(0, 24) })
      }
      const add = (raw) => {
        const id = normalizeSymbol(raw)
        if (id === '' || settings.symbols.includes(id)) return
        set({ ...settings, symbols: settings.symbols.concat(id).slice(0, 24) })
      }
      const submit = () => { add(draft); setDraft('') }
      const preview = quotes.items.filter((item) => settings.symbols.includes(item.id))

      /** One checkbox tile. */
      const tile = (id, kind) => {
        const on = settings.symbols.includes(id)
        return h('span', {
          key: `${kind}:${id}`,
          className: `fxm-check${on ? ' fxm-on' : ''}`,
          onClick: () => toggle(id),
          role: 'checkbox',
          'aria-checked': on ? 'true' : 'false',
        }, h('span', { className: 'fxm-box' }, on ? '✓' : ''), id)
      }

      return h('div', { className: 'fxm-set' },
        h('h2', null, '汇率跑马灯'),
        h('p', null, '会话输入框上方的行情条。这里的改动立即生效，并保存在本机浏览器里。'),

        h('div', { className: 'fxm-set-switch' },
          h('span', null,
            h('b', null, settings.enabled ? '跑马灯正在显示' : '跑马灯已关闭'),
            h('div', { className: 'fxm-note', style: { margin: '2px 0 0' } },
              settings.enabled
                ? '关闭后输入框上方的行情条会消失，后台轮询也会停止。新会话在开始聊天前本来就不显示。'
                : '已从输入框上方移除，且不再请求行情。汇率计算器不受影响。'),
          ),
          h('button', {
            className: `fxm-switch-btn${settings.enabled ? ' fxm-quiet' : ''}`,
            onClick: () => set({ ...settings, enabled: !settings.enabled }),
          }, settings.enabled ? '关闭跑马灯' : '开启跑马灯'),
        ),

        h('h3', null, `显示的汇率（已选 ${settings.symbols.length}）`),
        settings.symbols.length === 0
          ? h('p', { className: 'fxm-empty' }, '还没有选择任何标的，跑马灯不会显示内容。')
          : h('div', { className: 'fxm-row' },
              settings.symbols.map((s) => h('span', {
                key: s, className: 'fxm-chip', onClick: () => toggle(s), title: '点击移除',
              }, s, h('span', { className: 'fxm-chip-x' }, '✕'))),
            ),

        h('h3', null, '常用货币对'),
        h('div', { className: 'fxm-grid' }, FX_PRESETS.map((id) => tile(id, 'fx'))),

        h('h3', null, '指数与加密货币'),
        h('div', { className: 'fxm-grid' }, MARKET_PRESETS.map((id) => tile(id, 'mkt'))),

        h('h3', null, '自定义标的'),
        h('div', { className: 'fxm-row', style: { maxWidth: '420px' } },
          h('input', {
            className: 'fxm-input',
            value: draft,
            placeholder: '如 USD/KRW、SH000905、SOLUSDT',
            onChange: (e) => setDraft(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') submit() },
          }),
          h('button', { className: 'fxm-btn', style: { height: '26px' }, onClick: submit }, '添加'),
        ),
        h('p', { className: 'fxm-note' },
          '货币对写三字母代码对（USD/CNY），指数写 SH/SZ 加 6 位代码（SH000001），加密货币写交易对（BTCUSDT）。最多 24 个。'),

        h('h3', null, '汇率信源'),
        h('div', { className: 'fxm-row' },
          h('select', {
            className: 'fxm-sel',
            value: settings.fxSource,
            onChange: (e) => set({ ...settings, fxSource: e.target.value }),
          }, FX_SOURCES.map((id) => h('option', { key: id, value: id }, FX_SOURCE_LABELS[id]))),
          h('span', { className: 'fxm-note', style: { margin: 0 } }, '默认自动选择'),
        ),
        h('p', { className: 'fxm-note' }, FX_SOURCE_NOTES[settings.fxSource]),
        (() => {
          const used = [...new Set(quotes.items
            .filter((i) => i.kind === 'fx' && i.price !== null)
            .map((i) => SOURCE_TAGS[i.source] || i.source))]
          return used.length === 0
            ? null
            : h('p', { className: 'fxm-note' }, `当前实际取数：${used.join('、')}`)
        })(),

        h('h3', null, '自动更新'),
        h('div', { className: 'fxm-row' },
          h('select', {
            className: 'fxm-sel',
            value: String(settings.intervalSec),
            onChange: (e) => set({ ...settings, intervalSec: Number(e.target.value) }),
          }, INTERVALS.map((n) => h('option', { key: n, value: String(n) }, INTERVAL_LABELS[n]))),
          h('span', { className: 'fxm-note', style: { margin: 0 } },
            settings.intervalSec === 0
              ? '已关闭：只有点跑马灯上的 ↻ 才会刷新。'
              : `每 ${INTERVAL_LABELS[settings.intervalSec]}自动拉取一次（宿主机侧有 25 秒缓存）。`),
        ),

        h('h3', null, '显示'),
        h('div', { className: 'fxm-row' },
          h('label', {
            className: `fxm-check${settings.sparkline ? ' fxm-on' : ''}`,
            onClick: (e) => { e.preventDefault(); set({ ...settings, sparkline: !settings.sparkline }) },
          },
            h('span', { className: 'fxm-box' }, settings.sparkline ? '✓' : ''), '在每个标的后显示走势图'),
          h('span', { className: 'fxm-row', style: { gap: '6px' } },
            h('span', { className: 'fxm-note', style: { margin: 0 } }, '涨跌配色'),
            h('select', {
              className: 'fxm-sel',
              value: settings.scheme,
              onChange: (e) => set({ ...settings, scheme: e.target.value }),
            }, [
              h('option', { key: 'cn', value: 'cn' }, '红涨绿跌'),
              h('option', { key: 'us', value: 'us' }, '绿涨红跌'),
            ]),
          ),
        ),
        h('p', { className: 'fxm-note' },
          '走势图数据：货币对为 ECB 每日参考价（近 30 个交易日），指数为当日分时，加密货币为近 48 小时。点击跑马灯上的任一标的可放大查看。'),

        h('h3', null, '预览'),
        preview.length === 0
          ? h('p', { className: 'fxm-empty' }, '（暂无数据）')
          : h('div', { className: settings.scheme === 'us' ? 'fxm-preview fxm-us' : 'fxm-preview' },
              preview.map((item) => h(Cell, {
                key: item.id,
                item,
                series: quotes.series,
                showSparkline: settings.sparkline,
                active: false,
                onClick: () => {},
              })),
            ),

        h('h3', null, '其它'),
        h('div', { className: 'fxm-row' },
          h('button', {
            className: 'fxm-btn',
            style: { height: '26px' },
            onClick: () => set({ ...settings, symbols: DEFAULT_SYMBOLS.slice() }),
          }, '恢复默认标的'),
          h('button', {
            className: 'fxm-btn',
            style: { height: '26px' },
            onClick: () => { void refreshNow() },
          }, '立即刷新'),
        ),
        h('p', { className: 'fxm-note' },
          '汇率来自新浪财经盘中价，失败时回退 ECB 每日参考价；指数走东方财富，加密货币走 Binance。数据仅供个人参考，不构成投资建议。'),
      )
    }

    /* ------------------------------------------------------- calculator */

    /**
     * The conversation-view tab: a two-currency converter whose rate is frozen
     * to whatever the strip showed when the tab was opened. Nothing except the
     * 刷新汇率 button changes it, so a figure being read cannot move mid-sum.
     *
     * Conversion uses the pair's per-ONE-unit rate (`raw`), never the displayed
     * `price`, which for pairs like JPY/CNY is quoted per 100 units.
     */
    function CalculatorView() {
      const [snapshot, setSnapshot] = React.useState(() => quotesStore.get())
      const [extra, setExtra] = React.useState([])
      const [pairId, setPairId] = React.useState(null)
      const [amount, setAmount] = React.useState('100')
      const [reversed, setReversed] = React.useState(false)
      const [busy, setBusy] = React.useState(false)

      /** Ask the Host for the whole catalog — the strip only carries a few. */
      const loadCatalog = async () => {
        const { fxSource } = settingsStore.get()
        const url = `${ROUTE}?symbols=${encodeURIComponent(CALC_PAIRS.join(','))}`
          + `&series=0&fx=${encodeURIComponent(fxSource)}`
        const res = await fetch(url, { cache: 'no-store' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const body = await res.json()
        return Array.isArray(body.items) ? body.items : []
      }

      React.useEffect(() => {
        let alive = true
        void loadCatalog().then((items) => { if (alive) setExtra(items) }).catch(() => { /* strip pairs still work */ })
        return () => { alive = false }
      }, [])

      /** Only a real currency pair with a usable per-1 rate can be converted. */
      const usable = (it) => it.kind === 'fx' && Number.isFinite(it.raw) && it.raw > 0
      const fromStrip = snapshot.items.filter(usable)
      const carried = new Set(fromStrip.map((it) => it.id))
      const beyond = extra.filter((it) => usable(it) && !carried.has(it.id))
      const pairs = fromStrip.concat(beyond)
      const active = pairs.find((p) => p.id === pairId) || pairs[0] || null

      const refresh = async () => {
        setBusy(true)
        try { await refreshNow() } catch { /* keep the frozen strip values */ }
        try { setExtra(await loadCatalog()) } catch { /* keep the frozen catalog */ }
        setSnapshot(quotesStore.get())
        setBusy(false)
      }

      if (active === null) {
        return h('div', { className: 'fxm-calc' },
          h('h2', null, '汇率计算器'),
          h('p', { className: 'fxm-sub' }, '正在取汇率…若长时间空白，请检查「设置 → 汇率跑马灯」里的信源设置。'),
        )
      }

      const parts = active.id.split('/')
      const from = reversed ? parts[1] : parts[0]
      const to = reversed ? parts[0] : parts[1]
      const unit = reversed ? 1 / active.raw : active.raw

      const trimmed = String(amount).trim()
      const typed = trimmed === '' ? Number.NaN : Number(trimmed.replace(/[,\s]/g, ''))
      const result = Number.isFinite(typed) ? typed * unit : null
      const money = (value) => value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      const exact = active.raw.toPrecision(6)
      const rateText = reversed
        ? `1 ${parts[1]} = ${(1 / active.raw).toPrecision(6)} ${parts[0]}`
        : `1 ${parts[0]} = ${exact} ${parts[1]}`

      return h('div', { className: 'fxm-calc' },
        h('h2', null, '汇率计算器'),
        h('p', { className: 'fxm-sub' },
          '汇率取「打开本页时跑马灯上的值」，之后不会自己变化——只有点「刷新汇率」才会更新，免得你正在算的数字跳走。'),

        h('div', { className: 'fxm-calc-card' },
          h('div', { className: 'fxm-calc-row' },
            h('input', {
              className: 'fxm-calc-amount',
              value: amount,
              inputMode: 'decimal',
              'aria-label': '金额',
              onChange: (e) => setAmount(e.target.value),
            }),
            h('span', { className: 'fxm-calc-cur' }, from),
          ),
          h('div', { className: 'fxm-calc-row fxm-calc-row-end' },
            h('button', {
              className: 'fxm-calc-swap',
              title: '调换换算方向',
              onClick: () => setReversed((v) => !v),
            }, '⇅'),
          ),
          h('div', { className: 'fxm-calc-row' },
            h('div', { className: 'fxm-calc-out' }, result === null ? '—' : money(result)),
            h('span', { className: 'fxm-calc-cur' }, to),
          ),

          h('div', { className: 'fxm-calc-meta' },
            h('div', null, '汇率 ', h('b', null, rateText), '　',
              h('span', null, SOURCE_TAGS[active.source] || active.source || '—')),
            active.time === ''
              ? null
              : h('div', null, '上游报价时间 ', h('b', null, active.time), active.date === '' ? '' : `（${active.date}）`),
            h('div', null, '本页取数时刻 ', h('b', null, stamp(snapshot.updatedAt)), '　结果保留两位小数'),
            active.scale > 1
              ? h('div', { className: 'fxm-frozen' },
                  `注意：跑马灯上「${active.label}」按每 ${active.scale} 单位报价，此处换算用 1 ${parts[0]} = ${exact} ${parts[1]}`)
              : null,
          ),

          h('div', { className: 'fxm-calc-actions' },
            h('select', {
              className: 'fxm-calc-sel',
              value: active.id,
              'aria-label': '货币对',
              onChange: (e) => { setPairId(e.target.value); setReversed(false) },
            }, [
              h('optgroup', { key: 'strip', label: `跑马灯上的（${fromStrip.length}）` },
                fromStrip.map((p) => h('option', { key: p.id, value: p.id }, `${p.label}（${p.id}）`))),
              beyond.length === 0
                ? null
                : h('optgroup', { key: 'more', label: `更多货币对（${beyond.length}）` },
                    beyond.map((p) => h('option', { key: p.id, value: p.id }, `${p.label}（${p.id}）`))),
            ]),
            h('button', {
              className: 'fxm-calc-btn',
              disabled: busy,
              onClick: () => { void refresh() },
            }, busy ? '刷新中…' : '刷新汇率'),
          ),
          h('div', { className: 'fxm-calc-meta' },
            `可选 ${pairs.length} 个货币对：${fromStrip.length} 个来自跑马灯，${beyond.length} 个来自内置清单。`),
        ),
      )
    }

    /* ------------------------------------------------------------- plugin */

    /** Own the stylesheet for exactly as long as the plugin is mounted. */
    function mountStyles() {
      const tagId = 'dsh-fx-marquee/styles'
      const selector = 'style[data-plugin-css="' + tagId + '"]'
      if (document.querySelector(selector) === null) {
        const tag = document.createElement('style')
        tag.dataset.plugin = 'dsh-fx-marquee'
        tag.dataset.pluginCss = tagId
        tag.textContent = CSS
        document.head.appendChild(tag)
      }
      return () => {
        const tag = document.querySelector(selector)
        if (tag !== null) tag.remove()
      }
    }

    exports.inject = ['slots']
    exports.apply = function apply(ctx) {
      ctx.effect(mountStyles, 'fx-marquee: styles')
      ctx.effect(startPoller, 'fx-marquee: poller')
      ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
        name: 'conversation.input.dock',
        id: 'fx-marquee',
        order: 15,
      }, TickerBar))
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'fx-marquee',
        order: 45,
        label: '汇率跑马灯',
      }, SettingsSection))
      ctx.slots.inject('conversation.view', () => ctx.slots.register({
        name: 'conversation.view',
        id: 'fx-calc',
        order: 30,
        label: '汇率计算器',
      }, CalculatorView))
    }
    exports.TickerBar = TickerBar
    exports.SettingsSection = SettingsSection
    exports.CalculatorView = CalculatorView
    exports.DetailPopover = DetailPopover
    exports.TREND_PATH = TREND_PATH
    exports.CHART_POINTS = CHART_POINTS
    exports.TrendChart = TrendChart
    exports.Sparkline = Sparkline
    exports.sessionStatusFor = sessionStatusFor
    exports.zoneTimeText = zoneTimeText
    return module.exports
  },
})
