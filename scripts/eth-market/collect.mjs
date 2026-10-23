import { createHash } from 'node:crypto'
import { readBoundedResponseText } from '../research-response.mjs'

export const BINANCE_MARKET_BASE = 'https://data-api.binance.vision'
export const MARKET_INTERVAL_MS = Object.freeze({ '5m': 300000, '1h': 3600000 })
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024
const positiveTimestamp = (value) => Number.isSafeInteger(value) && value > 0
const digest = (text) => createHash('sha256').update(text).digest('hex')

function parseCandle(row, intervalMs) {
  if (
    !Array.isArray(row) ||
    row.length !== 12 ||
    !positiveTimestamp(row[0]) ||
    !positiveTimestamp(row[6]) ||
    row[0] % intervalMs !== 0 ||
    row[6] !== row[0] + intervalMs - 1 ||
    !Number.isSafeInteger(row[8]) ||
    row[8] < 0 ||
    [1, 2, 3, 4, 5, 7, 9, 10, 11].some((i) => typeof row[i] !== 'string' || !/^\d+(?:\.\d+)?$/.test(row[i]))
  )
    throw new Error('Invalid Binance kline shape or time interval')
  const [open, high, low, close, volume, quoteVolume, takerVolume, takerQuoteVolume] = [1, 2, 3, 4, 5, 7, 9, 10].map(
    (i) => Number(row[i]),
  )
  if (
    [open, high, low, close, volume, quoteVolume, takerVolume, takerQuoteVolume].some((x) => !Number.isFinite(x)) ||
    Math.min(open, high, low, close) <= 0 ||
    low > Math.min(open, close) ||
    high < Math.max(open, close) ||
    takerVolume > volume ||
    takerQuoteVolume > quoteVolume
  )
    throw new Error('Invalid Binance OHLCV values')
  return {
    openTime: row[0],
    closeTime: row[6],
    open,
    high,
    low,
    close,
    volume,
    quoteVolume,
    tradeCount: row[8],
    takerVolume,
    takerQuoteVolume,
    closed: true,
    availableAt: new Date(row[6] + 1).toISOString(),
  }
}

/** Historical public exchange candles, not a synthesized series. The server
 * clock is read first; later requests can never expand that closure cutoff. */
export async function collectEthMarketSnapshot({
  interval = '5m',
  startTime,
  endTime,
  limit = 288,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  timeoutMs = 15000,
} = {}) {
  const intervalMs = MARKET_INTERVAL_MS[interval]
  if (!intervalMs) throw new Error('interval must be 5m or 1h')
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('limit must be in [1, 1000]')
  if (startTime !== undefined && !positiveTimestamp(startTime)) throw new Error('Invalid startTime')
  if (endTime !== undefined && !positiveTimestamp(endTime)) throw new Error('Invalid endTime')
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 20000) throw new Error('Invalid timeoutMs')
  const collectionStartedAt = new Date(now()).toISOString()
  const requests = []
  async function get(path, params = {}) {
    const url = new URL(path, BINANCE_MARKET_BASE)
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value))
    const requestStartedAt = new Date(now()).toISOString()
    const response = await fetchImpl(url.href, {
      method: 'GET',
      redirect: 'error',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) throw new Error(`Binance HTTP ${response.status}`)
    const raw = await readBoundedResponseText(response, { maxBytes: MAX_RESPONSE_BYTES, errorPrefix: 'Binance' })
    const payload = JSON.parse(raw)
    const responseReceivedAt = new Date(now()).toISOString()
    if (Date.parse(responseReceivedAt) < Date.parse(requestStartedAt))
      throw new Error('Collection clock moved backwards')
    requests.push({ path, params, requestStartedAt, responseReceivedAt, responseSha256: digest(raw) })
    return payload
  }
  const timeResponse = await get('/api/v3/time')
  const serverTime = timeResponse?.serverTime
  if (!positiveTimestamp(serverTime)) throw new Error('Invalid Binance serverTime')
  const cutoff = Math.min(endTime ?? serverTime - 1, serverTime - 1)
  const lastClosedOpen = Math.floor((cutoff + 1) / intervalMs) * intervalMs - intervalMs
  const requestedStart =
    startTime === undefined ? lastClosedOpen - (limit - 1) * intervalMs : Math.ceil(startTime / intervalMs) * intervalMs
  const requestedEnd = lastClosedOpen + intervalMs - 1
  if (requestedStart <= 0 || requestedStart > requestedEnd) throw new Error('No closed candles in requested range')
  const expectedCount = Math.floor((lastClosedOpen - requestedStart) / intervalMs) + 1
  if (expectedCount > limit) throw new Error('Requested range exceeds candle limit; narrow start/end or raise limit')
  const params = { symbol: 'ETHUSDT', interval, startTime: requestedStart, endTime: requestedEnd, timeZone: '0', limit }
  const rawKlines = await get('/api/v3/klines', params)
  if (!Array.isArray(rawKlines) || rawKlines.length > limit)
    throw new Error('Invalid or oversized Binance kline response')
  const parsed = rawKlines.map((row) => parseCandle(row, intervalMs))
  if (parsed.some((row, i) => i > 0 && row.openTime <= parsed[i - 1].openTime)) {
    throw new Error('Binance candles must be unique and ascending')
  }
  const candles = parsed.filter(
    (row) => row.openTime >= requestedStart && row.closeTime <= requestedEnd && row.closeTime < serverTime,
  )
  if (!candles.length) throw new Error('Binance returned no closed candles')
  const collectedAt = new Date(now()).toISOString()
  if (Date.parse(collectedAt) < Date.parse(collectionStartedAt)) throw new Error('Collection clock moved backwards')
  const gaps = candles.flatMap((row, i) =>
    i > 0 && row.openTime !== candles[i - 1].closeTime + 1
      ? [{ afterCloseTime: candles[i - 1].closeTime, beforeOpenTime: row.openTime }]
      : [],
  )
  const issues = [
    ...(candles.length !== expectedCount ? ['incomplete-requested-range'] : []),
    ...(gaps.length ? ['missing-candle-intervals'] : []),
    ...(parsed.length !== candles.length ? ['discarded-out-of-range-or-unclosed-candles'] : []),
  ]
  return {
    schemaVersion: 1,
    kind: 'eth-market-snapshot',
    source: 'binance',
    symbol: 'ETHUSDT',
    baseAsset: 'ETH',
    quoteAsset: 'USDT',
    interval,
    intervalMs,
    timeZone: 'UTC',
    collectionStartedAt,
    collectedAt,
    serverTime,
    availableAt: new Date(Math.max(Date.parse(collectedAt), serverTime)).toISOString(),
    rawKlines,
    candles,
    provenance: {
      scope: 'local-research',
      publicDataOnly: true,
      licenseScope: 'local-personal-research',
      endpoint: BINANCE_MARKET_BASE,
      production: true,
      historicalBackfill: true,
      candleAvailabilityBasis: 'exchange-close-time-plus-one-ms',
      historicalRevisionAudit: 'not-performed',
      closureBasis: 'closeTime-before-serverTime-read-before-klines',
      requested: params,
      expectedCount,
      returnedCount: rawKlines.length,
      retainedCount: candles.length,
      gaps,
      quality: { status: issues.length ? 'partial' : 'observed', issues },
      requests,
      executionAuthority: 'none',
    },
  }
}
