import { estimateInverseEthHedge, validateInverseEthBook } from './executionBook.js'

const MAX_SKEW_MS = 30000
const SCENARIO_ID = 'assume-passive-counterparty-hedges-incremental-trade-basket'
const finite = (value) => typeof value === 'number' && Number.isFinite(value)
const positive = (value) => finite(value) && value > 0
const nonnegative = (value) => finite(value) && value >= 0
const numeric = (value) => (finite(value) ? value : null)
const timestamp = (value) => Number.isSafeInteger(value) && value > 0 && value <= 8640000000000000
const iso = (value) => (timestamp(value) ? new Date(value).toISOString() : null)
const unique = (items) => [...new Set(items)]
const dateValue = (value) =>
  typeof value === 'string' && /^\d{4}-\d\d-\d\dT.*Z$/.test(value) ? Date.parse(value) : NaN
const UNKNOWN = ['passive-counterparty-identity', 'open-close', 'initial-inventory', 'actual-hedge-actions']

// NTD is a price-adjusted inverse-option sensitivity, not observed dealer hedging.
// Ticker Delta is the venue's BS Delta; account DeltaTotal uses NTD instead.
// https://docs.deribit.com/api-reference/market-data/public-ticker
// https://support.deribit.com/hc/en-us/articles/31424939096093-Inverse-Options
export const ETH_OPTIONS_GREEK_CONVENTION = Object.freeze({
  id: 'deribit-inverse-option-net-transaction-delta',
  equation: 'netTransactionDelta = ticker.greeks.delta - ticker.mark_price',
  premiumCurrency: 'ETH',
  quantityUnit: 'ETH',
  contractSizeEth: 1,
  basis: 'capture-time-venue-greeks',
  accountEquityIncluded: false,
  initialInventoryKnown: false,
  source: 'https://docs.deribit.com/api-reference/market-data/public-ticker',
})

function envelopeIssues(bundle) {
  if (!bundle || bundle.schemaVersion !== 1 || bundle.kind !== 'eth-options-snapshot' || bundle.source !== 'deribit')
    return ['invalid-options-bundle-schema']
  if (bundle.provenance?.scope !== 'local-research') return ['missing-local-research-scope']
  if (bundle.provenance.fixture !== undefined && typeof bundle.provenance.fixture !== 'boolean')
    return ['invalid-fixture-provenance']
  for (const [key, limit] of [
    ['instruments', 5000],
    ['trades', 1000],
    ['tickers', 1000],
  ]) {
    if (!Array.isArray(bundle[key]) || bundle[key].length > limit) return [`invalid-or-unbounded-${key}`]
  }
  return []
}

function indexByName(values, label, issues) {
  const result = new Map()
  for (const value of values) {
    const name = value?.instrument_name
    if (typeof name !== 'string' || !name.length || name.length > 100 || result.has(name)) {
      issues.push(`duplicate-or-invalid-${label}-identity`)
      continue
    }
    result.set(name, value)
  }
  return result
}

function instrumentIssues(instrument, collectedMs) {
  if (!instrument) return ['missing-option-instrument']
  const issues = []
  if (
    instrument.kind !== 'option' ||
    instrument.instrument_type !== 'reversed' ||
    instrument.base_currency !== 'ETH' ||
    instrument.quote_currency !== 'ETH' ||
    instrument.settlement_currency !== 'ETH' ||
    instrument.contract_size !== 1 ||
    instrument.price_index !== 'eth_usd'
  )
    issues.push('unsupported-option-units')
  if (
    !['call', 'put'].includes(instrument.option_type) ||
    !positive(instrument.strike) ||
    !timestamp(instrument.expiration_timestamp) ||
    instrument.expiration_timestamp <= collectedMs ||
    instrument.state !== 'open' ||
    instrument.is_active !== true
  )
    issues.push('invalid-or-expired-option-metadata')
  return issues
}

function tickerIssues(ticker, instrument, collectedMs) {
  if (!ticker) return ['missing-option-ticker']
  const issues = []
  if (!timestamp(ticker.timestamp) || !finite(collectedMs) || Math.abs(ticker.timestamp - collectedMs) > MAX_SKEW_MS)
    issues.push('stale-or-invalid-option-ticker-time')
  if (
    ticker.state !== 'open' ||
    !nonnegative(ticker.mark_price) ||
    !nonnegative(ticker.mark_iv) ||
    !nonnegative(ticker.open_interest) ||
    !positive(ticker.index_price) ||
    !positive(ticker.underlying_price)
  )
    issues.push('invalid-option-ticker-values')
  if (
    !ticker.greeks ||
    !['delta', 'gamma', 'vega', 'theta', 'rho'].every((name) => finite(ticker.greeks[name])) ||
    Math.abs(ticker.greeks?.delta) > 1 ||
    ticker.greeks?.gamma < 0 ||
    ticker.greeks?.vega < 0
  )
    issues.push('invalid-or-missing-venue-greeks')
  if (
    (instrument?.option_type === 'call' && ticker.greeks?.delta < 0) ||
    (instrument?.option_type === 'put' && ticker.greeks?.delta > 0)
  )
    issues.push('option-delta-type-mismatch')
  return issues
}

function tradeIssues(trade, instrument, collectedMs) {
  const issues = []
  if (
    !trade ||
    typeof trade.trade_id !== 'string' ||
    !trade.trade_id ||
    !Number.isSafeInteger(trade.trade_seq) ||
    trade.trade_seq < 0
  )
    issues.push('invalid-trade-identity')
  if (!['buy', 'sell'].includes(trade?.direction)) issues.push('missing-taker-direction')
  if (
    !positive(trade?.amount) ||
    !positive(trade?.contracts) ||
    trade.contracts !== trade.amount ||
    !nonnegative(trade?.price) ||
    !nonnegative(trade?.iv) ||
    !positive(trade?.index_price)
  )
    issues.push('invalid-option-trade-units-or-values')
  if (
    !timestamp(trade?.timestamp) ||
    !finite(collectedMs) ||
    trade.timestamp > collectedMs + MAX_SKEW_MS ||
    (instrument && trade.timestamp >= instrument.expiration_timestamp)
  )
    issues.push('invalid-option-trade-time')
  return issues
}

function buildRow(trade, instruments, tickers, collectedMs, duplicate) {
  const instrument = instruments.get(trade?.instrument_name)
  const ticker = tickers.get(trade?.instrument_name)
  const metadataIssues = instrumentIssues(instrument, collectedMs)
  const observedIssues = tradeIssues(trade, instrument, collectedMs)
  if (duplicate) observedIssues.push('duplicate-trade')
  const issues = [...metadataIssues, ...observedIssues, ...tickerIssues(ticker, instrument, collectedMs)]
  const venueGreeks =
    ticker?.greeks && ['delta', 'gamma', 'vega', 'theta', 'rho'].every((key) => finite(ticker.greeks[key]))
      ? Object.fromEntries(['delta', 'gamma', 'vega', 'theta', 'rho'].map((key) => [key, ticker.greeks[key]]))
      : null
  return {
    id: trade?.trade_id ?? null,
    instrumentName: trade?.instrument_name ?? null,
    tradeTime: iso(trade?.timestamp),
    tickerTime: iso(ticker?.timestamp),
    takerSide: ['buy', 'sell'].includes(trade?.direction) ? trade.direction : null,
    amountEth: numeric(trade?.amount),
    contracts: numeric(trade?.contracts),
    tradePriceEth: numeric(trade?.price),
    tradeIvPct: numeric(trade?.iv),
    indexPriceUsd: numeric(trade?.index_price),
    optionType: instrument?.option_type ?? null,
    strikePriceUsd: numeric(instrument?.strike),
    expiry: iso(instrument?.expiration_timestamp),
    markPriceEth: numeric(ticker?.mark_price),
    markIvPct: numeric(ticker?.mark_iv),
    openInterestEth: numeric(ticker?.open_interest),
    bsDelta: numeric(ticker?.greeks?.delta),
    netTransactionDelta: issues.length ? null : ticker.greeks.delta - ticker.mark_price,
    greeks: venueGreeks,
    blockTradeId: trade?.block_trade_id ?? null,
    comboId: trade?.combo_trade_id ?? trade?.combo_id ?? null,
    observedTradeValid: metadataIssues.length === 0 && observedIssues.length === 0,
    settlementWindow: instrument && ticker ? instrument.expiration_timestamp - ticker.timestamp <= 1800000 : null,
    quality:
      issues.length === 0 ? 'ready' : issues.every((issue) => issue.startsWith('missing-')) ? 'missing' : 'invalid',
    issues,
  }
}

function emptyScenario(input, enabled) {
  return {
    status: enabled ? 'blocked' : 'disabled',
    id: SCENARIO_ID,
    issues: [],
    valuationBasis: 'capture-time-revaluation-of-recent-trade-basket',
    hedgeRatio: input?.hedgeRatio ?? 1,
    alreadyHedgedEth: input?.alreadyHedgedEth ?? 0,
    netPassiveDeltaChangeEth: null,
    desiredHedgeEth: null,
    execution: null,
  }
}

function calculateScenario(bundle, rows, input, allIssues) {
  const enabled = input?.enabled === true
  const result = emptyScenario(input, enabled)
  if (!enabled) return result
  const issues = [...allIssues]
  if (!finite(result.hedgeRatio) || result.hedgeRatio < 0 || result.hedgeRatio > 1 || !finite(result.alreadyHedgedEth))
    issues.push('invalid-hedge-scenario-inputs')
  if (!rows.length) issues.push('empty-trade-basket')
  if (rows.some((row) => row.quality !== 'ready')) issues.push('incomplete-trade-basket-evidence')
  if (issues.length) return { ...result, issues: unique(issues) }
  // The passive side is assumed for this basket only; opening/closing and inventory remain unknown.
  const netPassiveDeltaChangeEth = rows.reduce(
    (sum, row) => sum - (row.takerSide === 'buy' ? 1 : -1) * row.amountEth * row.netTransactionDelta,
    0,
  )
  const desiredHedgeEth = -netPassiveDeltaChangeEth * result.hedgeRatio - result.alreadyHedgedEth
  if (!finite(netPassiveDeltaChangeEth) || !finite(desiredHedgeEth))
    return { ...result, issues: ['nonfinite-basket-sensitivity'] }
  const execution = estimateInverseEthHedge(bundle.underlyingBook, bundle.underlyingInstrument, desiredHedgeEth)
  return {
    ...result,
    status: execution.status === 'blocked' ? 'blocked' : 'ready',
    issues: execution.status === 'blocked' ? execution.issues : [],
    netPassiveDeltaChangeEth,
    desiredHedgeEth,
    execution,
  }
}

export function analyzeEthOptionsBundle(bundle, scenario = { enabled: false, hedgeRatio: 1, alreadyHedgedEth: 0 }) {
  const issues = envelopeIssues(bundle)
  const base = {
    executionAuthority: 'none',
    source: 'deribit',
    // Source identifies the venue/schema; dataOrigin separately preserves synthetic evidence.
    dataOrigin:
      bundle?.provenance?.fixture === true
        ? 'synthetic-fixture'
        : bundle?.provenance?.scope === 'local-research' && [undefined, false].includes(bundle.provenance.fixture)
          ? 'observed'
          : 'unknown',
    greekConvention: ETH_OPTIONS_GREEK_CONVENTION,
    makerGamma: null,
  }
  if (issues.length)
    return {
      ...base,
      status: 'blocked',
      issues,
      summary: null,
      tradeRows: [],
      scenario: { ...emptyScenario(scenario, scenario?.enabled === true), issues },
    }
  const collectedMs = dateValue(bundle.collectedAt)
  const startedMs = dateValue(bundle.collectionStartedAt)
  const availableMs = dateValue(bundle.availableAt)
  if (![collectedMs, startedMs, availableMs].every(finite) || collectedMs < startedMs || availableMs < collectedMs)
    issues.push('invalid-collection-availability-time')
  if (
    !scenario ||
    typeof scenario !== 'object' ||
    (scenario.enabled !== undefined && typeof scenario.enabled !== 'boolean')
  )
    issues.push('invalid-scenario-enable-flag')
  const instruments = indexByName(bundle.instruments, 'instrument', issues)
  const tickers = indexByName(bundle.tickers, 'ticker', issues)
  const ids = new Set()
  const sequences = new Set()
  const rows = bundle.trades.map((trade) => {
    const key = `${trade?.instrument_name}:${trade?.trade_seq}`
    const duplicate = ids.has(trade?.trade_id) || sequences.has(key)
    ids.add(trade?.trade_id)
    sequences.add(key)
    return buildRow(trade, instruments, tickers, collectedMs, duplicate)
  })
  const clockTimes = [
    collectedMs,
    bundle.underlyingBook?.timestamp,
    ...bundle.tickers.map((ticker) => ticker?.timestamp),
  ]
  const snapshotSkewMs = clockTimes.every(timestamp) ? Math.max(...clockTimes) - Math.min(...clockTimes) : null
  if (snapshotSkewMs === null || snapshotSkewMs > MAX_SKEW_MS) issues.push('snapshot-clock-skew-exceeded')
  const sourceTimes = [...clockTimes.slice(1), ...bundle.trades.map((trade) => trade?.timestamp)]
  if (sourceTimes.some((time) => timestamp(time) && time > availableMs))
    issues.push('availability-precedes-source-evidence')
  issues.push(...validateInverseEthBook(bundle.underlyingBook, bundle.underlyingInstrument))
  issues.push(...rows.flatMap((row) => row.issues))
  const coveredNames = new Set(rows.filter((row) => row.quality === 'ready').map((row) => row.instrumentName))
  const observedRows = rows.filter((row) => row.observedTradeValid)
  const names = unique(rows.map((row) => row.instrumentName).filter(Boolean))
  const totalTradeEth =
    observedRows.length === rows.length && rows.length > 0 ? rows.reduce((sum, row) => sum + row.amountEth, 0) : null
  const coveredOpenInterestEth = coveredNames.size
    ? [...coveredNames].reduce((sum, name) => sum + tickers.get(name).open_interest, 0)
    : null
  if (
    (totalTradeEth !== null && !finite(totalTradeEth)) ||
    (coveredOpenInterestEth !== null && !finite(coveredOpenInterestEth))
  )
    issues.push('nonfinite-observation-summary')
  if (!rows.length) issues.push('empty-trade-basket')
  const uniqueIssues = unique(issues)
  return {
    ...base,
    status: uniqueIssues.length ? 'partial' : 'ready',
    issues: uniqueIssues,
    summary: {
      tradeCount: rows.length,
      validTradeCount: observedRows.length,
      coveredTradeCount: rows.filter((row) => row.quality === 'ready').length,
      uniqueInstrumentCount: names.length,
      tickerCount: tickers.size,
      uncoveredInstrumentNames: names.filter((name) => !coveredNames.has(name)),
      totalTradeEth: finite(totalTradeEth) ? totalTradeEth : null,
      coveredOpenInterestEth: finite(coveredOpenInterestEth) ? coveredOpenInterestEth : null,
      collectionStartedAt: bundle.collectionStartedAt,
      collectedAt: bundle.collectedAt,
      availableAt: bundle.availableAt,
      snapshotSkewMs,
      maxSnapshotSkewMs: MAX_SKEW_MS,
      hedgeBookTime: iso(bundle.underlyingBook?.timestamp),
      valuationBasis: 'capture-time-revaluation-of-recent-trade-basket',
      unknowns: [...UNKNOWN],
    },
    tradeRows: rows,
    scenario: calculateScenario(bundle, rows, scenario, uniqueIssues),
  }
}
