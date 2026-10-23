import { createDeribitClient } from './rpc.mjs'

const MAX_INSTRUMENTS = 5000
const OPTION_NAME = /^ETH-[A-Z0-9.]+-[0-9.]+-[CP]$/
function optionName(value) {
  return typeof value === 'string' && value.length <= 80 && OPTION_NAME.test(value)
}
function timestamp(value) {
  return Number.isSafeInteger(value) && value > 0
}

/** A bounded, non-atomic observation. Tickers describe collection time, never
 * the historical time of the recent trades. This is not a full trade history. */
export async function collectEthOptionsSnapshot({
  tradeCount = 30,
  maxTickers = 12,
  fetchImpl,
  now = Date.now,
  onProgress = () => {},
  retryDelayMs,
} = {}) {
  if (!Number.isInteger(tradeCount) || tradeCount < 1 || tradeCount > 30)
    throw new Error('tradeCount must be in [1, 30]')
  if (!Number.isInteger(maxTickers) || maxTickers < 1 || maxTickers > 12)
    throw new Error('maxTickers must be in [1, 12]')
  const collectionStartedAt = new Date(now()).toISOString()
  const client = createDeribitClient({ fetchImpl, now, retryDelayMs })
  onProgress({ phase: 'instruments' })
  const instruments = await client.call('public/get_instruments', { currency: 'ETH', kind: 'option', expired: false })
  if (
    !Array.isArray(instruments) ||
    instruments.length > MAX_INSTRUMENTS ||
    instruments.some(
      (item) => !optionName(item?.instrument_name) || item.kind !== 'option' || item.base_currency !== 'ETH',
    ) ||
    new Set(instruments.map((item) => item.instrument_name)).size !== instruments.length
  ) {
    throw new Error('Invalid or oversized ETH option instrument registry')
  }
  onProgress({ phase: 'recent-trades' })
  const recent = await client.call('public/get_last_trades_by_currency', {
    currency: 'ETH',
    kind: 'option',
    count: tradeCount,
    sorting: 'desc',
  })
  if (
    !Array.isArray(recent?.trades) ||
    recent.trades.length > tradeCount ||
    typeof recent.has_more !== 'boolean' ||
    recent.trades.some(
      (item) =>
        !optionName(item?.instrument_name) ||
        !timestamp(item.timestamp) ||
        typeof item.trade_id !== 'string' ||
        !item.trade_id,
    ) ||
    new Set(recent.trades.map((item) => item.trade_id)).size !== recent.trades.length
  ) {
    throw new Error('Invalid bounded ETH option trade response')
  }
  const trades = recent.trades
  const names = [...new Set([...trades].sort((a, b) => b.timestamp - a.timestamp).map((item) => item.instrument_name))]
  const selected = names.slice(0, maxTickers)
  const tickers = []
  for (const instrument_name of selected) {
    onProgress({ phase: 'ticker', instrumentName: instrument_name, index: tickers.length + 1, total: selected.length })
    const result = await client.call('public/ticker', { instrument_name })
    if (result?.instrument_name !== instrument_name || !timestamp(result.timestamp))
      throw new Error('Invalid or mismatched option ticker')
    tickers.push(result)
  }
  onProgress({ phase: 'underlying-book' })
  const underlyingInstrument = await client.call('public/get_instrument', { instrument_name: 'ETH-PERPETUAL' })
  if (underlyingInstrument?.instrument_name !== 'ETH-PERPETUAL' || underlyingInstrument.base_currency !== 'ETH') {
    throw new Error('Invalid ETH-PERPETUAL instrument specification')
  }
  const underlyingBook = await client.call('public/get_order_book', { instrument_name: 'ETH-PERPETUAL', depth: 20 })
  if (
    underlyingBook?.instrument_name !== 'ETH-PERPETUAL' ||
    !timestamp(underlyingBook.timestamp) ||
    !Array.isArray(underlyingBook.bids) ||
    !Array.isArray(underlyingBook.asks) ||
    underlyingBook.bids.length > 20 ||
    underlyingBook.asks.length > 20
  )
    throw new Error('Invalid bounded ETH-PERPETUAL book')
  const collectedAt = new Date(now()).toISOString()
  if (Date.parse(collectedAt) < Date.parse(collectionStartedAt)) throw new Error('Collection clock moved backwards')
  const registryNames = new Set(instruments.map((item) => item.instrument_name))
  const uncovered = names.slice(maxTickers).map((instrumentName) => ({ instrumentName, reason: 'ticker-limit' }))
  const missingSpecifications = names.filter((name) => !registryNames.has(name))
  const missingTickerFields = tickers.flatMap((item) => {
    const fields = ['delta', 'gamma']
      .filter((key) => !Number.isFinite(item.greeks?.[key]))
      .map((key) => `greeks.${key}`)
    for (const key of ['underlying_price', 'mark_iv']) if (!Number.isFinite(item[key])) fields.push(key)
    return fields.length ? [{ instrumentName: item.instrument_name, fields }] : []
  })
  const timestamps = [...tickers.map((item) => item.timestamp), underlyingBook.timestamp]
  const observedMin = Math.min(...timestamps)
  const observedMax = Math.max(...timestamps)
  const latestSourceTimestamp = Math.max(observedMax, ...trades.map((item) => item.timestamp))
  const clientSourceClockSkewMs = latestSourceTimestamp - Date.parse(collectedAt)
  const availableAt = new Date(Math.max(Date.parse(collectedAt), latestSourceTimestamp)).toISOString()
  const issues = [
    ...(uncovered.length ? ['incomplete-ticker-coverage'] : []),
    ...(missingSpecifications.length ? ['missing-instrument-specification'] : []),
    ...(missingTickerFields.length ? ['incomplete-ticker-fields'] : []),
    ...(!trades.length ? ['no-recent-option-trades'] : []),
    ...(observedMax - observedMin > 30000 ? ['snapshot-times-differ-over-30s'] : []),
    ...(clientSourceClockSkewMs > 30000 ? ['source-clock-ahead-over-30s'] : []),
    ...(Math.abs(observedMax - Date.parse(collectedAt)) > 30000 ||
    Math.abs(observedMin - Date.parse(collectedAt)) > 30000
      ? ['snapshot-clock-skew-or-stale-over-30s']
      : []),
  ]
  onProgress({ phase: 'complete', trades: trades.length, tickers: tickers.length, issues })
  return {
    schemaVersion: 1,
    kind: 'eth-options-snapshot',
    source: 'deribit',
    collectionStartedAt,
    collectedAt,
    availableAt,
    instruments,
    trades,
    tickers,
    underlyingInstrument,
    underlyingBook,
    provenance: {
      scope: 'local-research',
      publicDataOnly: true,
      licenseScope: 'local-personal-research',
      production: true,
      observationType: 'bounded-non-atomic-snapshot',
      historicalBackfill: false,
      largeIntegerEncoding: 'decimal-string',
      availableAtBasis: 'max-client-collection-and-source-time',
      clientSourceClockSkewMs,
      history: {
        scope: 'bounded-recent-trades',
        requestedCount: tradeCount,
        returnedCount: trades.length,
        hasMore: recent.has_more,
        completeHistory: false,
      },
      tickerCoverage: {
        requestedInstrumentNames: selected,
        receivedInstrumentNames: tickers.map((item) => item.instrument_name),
        maxTickers,
        uncovered,
      },
      missingSpecifications,
      missingTickerFields,
      bookDepth: 20,
      quality: { status: issues.length ? 'partial' : 'observed', issues },
      observationWindow: { earliestSnapshotTimestamp: observedMin, latestSnapshotTimestamp: observedMax },
      requestCount: client.requestCount,
      requests: client.observations,
      economicInterpretation: 'public-trades-do-not-identify-dealer-position-or-hedging',
    },
  }
}
