const DAY_MS = 86400000

/** Require an explicit time zone; a local browser zone must never shift evidence. */
export function instant(value) {
  if (typeof value === 'number')
    return Number.isSafeInteger(value) && value > 0 && value <= 8640000000000000 ? value : null
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d.*(?:Z|[+-]\d\d:\d\d)$/.test(value)) return null
  if (dateStart(value.slice(0, 10)) === null) return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : null
}

export function chartIdentity(source) {
  const symbol = String(source?.symbol ?? '')
    .toUpperCase()
    .trim()
  const pair = /^(WETH|ETH)[/_-]?(USDC|USDT|USD)$/.exec(symbol)
  const base = source?.baseAsset ?? source?.baseCurrency ?? pair?.[1]
  const quote = source?.quoteCurrency ?? source?.quoteAsset ?? pair?.[2]
  const baseAsset = typeof base === 'string' ? base.toUpperCase() : null
  const quoteCurrency = typeof quote === 'string' ? quote.toUpperCase() : null
  let reason = null
  if (!['ETH', 'WETH'].includes(baseAsset)) reason = 'asset-mismatch'
  else if (!quoteCurrency) reason = 'unknown-quote-currency'
  else if (pair && pair[2] !== quoteCurrency) reason = 'conflicting-asset-identity'
  else if (!pair && symbol && !['ETH', 'WETH'].includes(symbol)) reason = 'asset-mismatch'
  return { baseAsset, quoteCurrency, reason }
}

export function completedBarTime(row, source) {
  const fail = (reason) => ({ time: null, reason })
  if (row?.isClosed === false || row?.closed === false) return fail('unclosed-session')
  if (typeof row?.date !== 'string') return fail('missing-session-date')
  if (!Number.isFinite(row.close) || row.close <= 0) return fail('invalid-close-price')
  const dailyDate = /^\d{4}-\d\d-\d\d$/.test(row.date)
  const start = dailyDate ? dateStart(row.date) : instant(row.date)
  if (start === null) return fail('invalid-session-date')
  const timeframe = source?.timeframe ?? source?.interval
  const dailyTimeframe = !timeframe || ['1d', '1D', 'D', 'day', 'daily', '1日'].includes(timeframe)
  const times = ['completedAt', 'closeTime', 'endTime', 'closedAt'].filter((key) => row[key] !== undefined)
  if (times.length) {
    const parsed = times.map((key) => instant(row[key]))
    if (parsed.some((time) => time === null)) return fail('invalid-completion-time')
    if (parsed.some((time) => time <= start)) return fail('completion-before-session-end')
    // UTC daily dates cannot be relabelled with a later day's close. The one
    // millisecond allowance supports exchange end timestamps such as 23:59:59.999.
    if (dailyDate && dailyTimeframe && parsed.some((time) => time < start + DAY_MS - 1 || time > start + DAY_MS))
      return fail('completion-outside-daily-session')
    // More than one explicit timestamp cannot select an earlier interpretation.
    return { time: Math.max(...parsed), reason: null }
  }
  // The workbench imports completed UTC daily candles. A date denotes the
  // session start, so its close is next midnight, never that day's open. An
  // intraday timestamp requires an explicit close rather than a guessed period.
  if (!dailyDate || !dailyTimeframe) return fail('missing-completion-time')
  return { time: start + DAY_MS, reason: null }
}

function dateStart(value) {
  const start = Date.parse(`${value}T00:00:00.000Z`)
  return Number.isFinite(start) && new Date(start).toISOString().slice(0, 10) === value ? start : null
}
