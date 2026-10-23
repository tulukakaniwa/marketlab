import { instant } from './impactChartTime.js'

const INTERVALS = Object.freeze({ '5m': 300000, '1h': 3600000 })
const MAX_ROWS = 1000
const ENDPOINT = 'https://data-api.binance.vision'
const timestamp = (value) => Number.isSafeInteger(value) && value > 0 && value < 8640000000000000
const fail = (reason) => {
  throw new Error(reason)
}
const ensure = (condition, reason) => condition || fail(reason)
const time = (value) => typeof value === 'string' && /Z$/.test(value) && instant(value)

function validateMetadata(bundle) {
  ensure(
    bundle?.schemaVersion === 1 &&
      bundle.kind === 'eth-market-snapshot' &&
      bundle.source === 'binance' &&
      bundle.symbol === 'ETHUSDT' &&
      bundle.baseAsset === 'ETH' &&
      bundle.quoteAsset === 'USDT' &&
      bundle.timeZone === 'UTC' &&
      Boolean(INTERVALS[bundle.interval]) &&
      INTERVALS[bundle.interval] === bundle.intervalMs,
    'invalid-market-bundle-schema',
  )
  const provenance = bundle.provenance
  ensure(
    provenance?.scope === 'local-research' &&
      provenance.publicDataOnly === true &&
      provenance.licenseScope === 'local-personal-research' &&
      provenance.endpoint === ENDPOINT &&
      provenance.production === true &&
      provenance.historicalBackfill === true &&
      provenance.historicalRevisionAudit === 'not-performed' &&
      provenance.candleAvailabilityBasis === 'exchange-close-time-plus-one-ms' &&
      provenance.closureBasis === 'closeTime-before-serverTime-read-before-klines' &&
      provenance.executionAuthority === 'none',
    'invalid-market-provenance',
  )
  const started = time(bundle.collectionStartedAt)
  const collected = time(bundle.collectedAt)
  const available = time(bundle.availableAt)
  ensure(
    started &&
      collected &&
      available &&
      timestamp(bundle.serverTime) &&
      collected >= started &&
      available === Math.max(collected, bundle.serverTime),
    'invalid-market-capture-time',
  )
  const requested = provenance.requested
  ensure(
    requested?.symbol === bundle.symbol &&
      requested.interval === bundle.interval &&
      requested.timeZone === '0' &&
      timestamp(requested.startTime) &&
      timestamp(requested.endTime) &&
      requested.startTime % bundle.intervalMs === 0 &&
      (requested.endTime + 1) % bundle.intervalMs === 0 &&
      requested.startTime < requested.endTime &&
      requested.endTime < bundle.serverTime &&
      Number.isInteger(requested.limit) &&
      requested.limit > 0 &&
      requested.limit <= MAX_ROWS &&
      (requested.endTime + 1 - requested.startTime) / bundle.intervalMs <= requested.limit,
    'invalid-market-request-range',
  )
  ensure(Array.isArray(provenance.requests) && provenance.requests.length === 2, 'invalid-market-request-audit')
  let previous = started
  for (const [index, request] of provenance.requests.entries()) {
    const start = time(request.requestStartedAt)
    const end = time(request.responseReceivedAt)
    ensure(
      request.path === ['/api/v3/time', '/api/v3/klines'][index] &&
        start &&
        end &&
        start >= previous &&
        end >= start &&
        end <= collected &&
        /^[a-f0-9]{64}$/.test(request.responseSha256),
      'invalid-market-request-audit',
    )
    if (index === 1)
      ensure(
        Object.keys(requested).every((key) => request.params?.[key] === requested[key]),
        'market-request-audit-mismatch',
      )
    if (index === 0)
      ensure(bundle.serverTime >= start - 30000 && bundle.serverTime <= end + 30000, 'market-server-clock-mismatch')
    previous = end
  }
  return requested
}

function parseRawCandle(row, intervalMs) {
  ensure(
    Array.isArray(row) &&
      row.length === 12 &&
      timestamp(row[0]) &&
      timestamp(row[6]) &&
      row[0] % intervalMs === 0 &&
      row[6] === row[0] + intervalMs - 1 &&
      Number.isSafeInteger(row[8]) &&
      row[8] >= 0 &&
      [1, 2, 3, 4, 5, 7, 9, 10, 11].every((i) => typeof row[i] === 'string' && /^\d+(?:\.\d+)?$/.test(row[i])),
    'invalid-market-kline-shape-or-time',
  )
  const values = [1, 2, 3, 4, 5, 7, 9, 10].map((i) => Number(row[i]))
  const [open, high, low, close, volume, quoteVolume, takerVolume, takerQuoteVolume] = values
  ensure(
    values.every(Number.isFinite) &&
      Math.min(open, high, low, close) > 0 &&
      low <= Math.min(open, close) &&
      high >= Math.max(open, close) &&
      takerVolume <= volume &&
      takerQuoteVolume <= quoteVolume,
    'invalid-market-ohlcv',
  )
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

/** Pure validation of an imported historical exchange capture. Per-candle
 * availability follows the exchange close; it does not claim a vintage audit. */
export function analyzeEthMarketBundle(bundle) {
  const boundary = { executionAuthority: 'none', futureRowsUsed: false, historicalRevisionAudit: 'not-performed' }
  try {
    const requested = validateMetadata(bundle)
    ensure(
      Array.isArray(bundle.rawKlines) && bundle.rawKlines.length > 0 && bundle.rawKlines.length <= requested.limit,
      'invalid-or-unbounded-market-klines',
    )
    const parsed = bundle.rawKlines.map((row) => parseRawCandle(row, bundle.intervalMs))
    ensure(
      parsed.every((row, i) => !i || row.openTime > parsed[i - 1].closeTime),
      'unordered-or-overlapping-market-klines',
    )
    const candles = parsed.filter(
      (row) =>
        row.openTime >= requested.startTime && row.closeTime <= requested.endTime && row.closeTime < bundle.serverTime,
    )
    ensure(candles.length > 0, 'no-closed-market-candles')
    if (bundle.candles !== undefined) {
      ensure(Array.isArray(bundle.candles) && bundle.candles.length === candles.length, 'market-candles-mismatch')
      candles.forEach((row, index) =>
        ensure(
          Object.keys(row).every((key) => bundle.candles[index]?.[key] === row[key]),
          'market-candles-mismatch',
        ),
      )
    }
    const gaps = candles.filter((row, i) => i > 0 && row.openTime !== candles[i - 1].closeTime + 1)
    const expectedCount = (requested.endTime + 1 - requested.startTime) / bundle.intervalMs
    const issues = [
      ...(candles.length !== expectedCount ? ['incomplete-requested-range'] : []),
      ...(gaps.length ? ['missing-candle-intervals'] : []),
      ...(parsed.length !== candles.length ? ['discarded-out-of-range-or-unclosed-candles'] : []),
    ]
    return {
      ...boundary,
      status: 'ready',
      issues,
      source: {
        type: 'research-market',
        symbol: 'ETHUSDT',
        name: 'ETH / USDT · Binance',
        label: 'ETH 对齐研究行情',
        baseAsset: 'ETH',
        quoteCurrency: 'USDT',
        timeframe: bundle.interval,
        interval: bundle.interval,
        provider: 'Binance',
        timeZone: 'UTC',
        dataOrigin: 'public-exchange-history',
        historicalBackfill: true,
        historicalRevisionAudit: 'not-performed',
      },
      rows: candles.map((row) => ({
        date: new Date(row.openTime).toISOString(),
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        volume: row.volume,
        closeTime: row.closeTime,
        completedAt: row.availableAt,
        availableAt: row.availableAt,
        isClosed: true,
      })),
      capturedAt: bundle.collectedAt,
      availableAt: bundle.availableAt,
      serverTime: bundle.serverTime,
      intervalMs: bundle.intervalMs,
      candleAvailabilityBasis: 'exchange-close-time-plus-one-ms',
      provenance: bundle.provenance,
    }
  } catch (error) {
    return {
      ...boundary,
      status: 'blocked',
      source: null,
      rows: [],
      issues: [error.message || 'invalid-market-bundle'],
    }
  }
}
