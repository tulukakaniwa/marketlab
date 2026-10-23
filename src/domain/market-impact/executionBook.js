const finite = (value) => typeof value === 'number' && Number.isFinite(value)
const positive = (value) => finite(value) && value > 0
const MAX_LEVELS = 1000

// Deribit ETH-PERPETUAL quantity is USD notional, not ETH or margin cash.
// https://support.deribit.com/hc/en-us/articles/31424954847133-Inverse-Perpetual
export function validateInverseEthBook(book, instrument) {
  const issues = []
  if (
    !instrument ||
    instrument.instrument_name !== 'ETH-PERPETUAL' ||
    instrument.kind !== 'future' ||
    instrument.instrument_type !== 'reversed' ||
    instrument.base_currency !== 'ETH' ||
    instrument.quote_currency !== 'USD' ||
    instrument.settlement_currency !== 'ETH' ||
    instrument.contract_size !== 1 ||
    instrument.min_trade_amount !== 1 ||
    instrument.state !== 'open' ||
    instrument.is_active !== true ||
    instrument.price_index !== 'eth_usd' ||
    instrument.settlement_period !== 'perpetual'
  )
    issues.push('unsupported-hedge-instrument-units')
  if (
    !book ||
    book.instrument_name !== 'ETH-PERPETUAL' ||
    book.state !== 'open' ||
    !Number.isSafeInteger(book.timestamp) ||
    book.timestamp < 0 ||
    !Number.isSafeInteger(book.change_id) ||
    book.change_id < 0
  ) {
    issues.push('invalid-underlying-book-metadata')
  }
  for (const side of ['bids', 'asks']) {
    const levels = book?.[side]
    if (!Array.isArray(levels) || !levels.length || levels.length > MAX_LEVELS) {
      issues.push(`missing-or-unbounded-${side}`)
      continue
    }
    let previous = side === 'bids' ? Infinity : -Infinity
    for (const level of levels) {
      if (
        !Array.isArray(level) ||
        level.length !== 2 ||
        !positive(level[0]) ||
        !positive(level[1]) ||
        !Number.isSafeInteger(level[1]) ||
        (side === 'bids' ? level[0] >= previous : level[0] <= previous)
      ) {
        issues.push(`invalid-${side}-price-or-usd-quantity`)
        break
      }
      previous = level[0]
    }
  }
  if (
    !issues.length &&
    (book.bids[0][0] >= book.asks[0][0] ||
      book.best_bid_price !== book.bids[0][0] ||
      book.best_ask_price !== book.asks[0][0])
  ) {
    issues.push('crossed-or-inconsistent-book')
  }
  return issues
}

export function estimateInverseEthHedge(book, instrument, desiredHedgeEth) {
  const issues = validateInverseEthBook(book, instrument)
  if (!finite(desiredHedgeEth)) issues.push('invalid-hedge-eth-amount')
  const base = {
    executionAuthority: 'none',
    venue: 'deribit',
    instrumentName: 'ETH-PERPETUAL',
    quantityModel: 'continuous-depth-estimate',
    quantityUnit: 'USD-notional',
    feesIncluded: false,
    fundingIncluded: false,
    bookTimestamp: book?.timestamp ?? null,
    requestedEth: finite(desiredHedgeEth) ? Math.abs(desiredHedgeEth) : null,
    side: finite(desiredHedgeEth) ? (desiredHedgeEth > 0 ? 'buy' : desiredHedgeEth < 0 ? 'sell' : 'none') : null,
  }
  if (issues.length)
    return {
      ...base,
      status: 'blocked',
      issues,
      filledEth: null,
      unfilledEth: null,
      usdNotional: null,
      averagePriceUsd: null,
      marginalPriceUsd: null,
      fills: [],
    }
  const midPriceUsd = (book.bids[0][0] + book.asks[0][0]) / 2
  let remaining = Math.abs(desiredHedgeEth)
  let filledEth = 0
  let usdNotional = 0
  const fills = []
  const levels = desiredHedgeEth > 0 ? book.asks : book.bids
  for (const [priceUsd, availableUsd] of levels) {
    if (remaining <= 0) break
    const baseAtLevel = availableUsd / priceUsd
    const amountEth = Math.min(remaining, baseAtLevel)
    const amountUsd = amountEth * priceUsd
    remaining = Math.max(0, remaining - amountEth)
    filledEth += amountEth
    usdNotional += amountUsd
    fills.push({ priceUsd, amountEth, amountUsd, availableUsd })
  }
  if (![filledEth, remaining, usdNotional, midPriceUsd].every(finite)) {
    return {
      ...base,
      status: 'blocked',
      issues: ['nonfinite-execution-estimate'],
      filledEth: null,
      unfilledEth: null,
      usdNotional: null,
      averagePriceUsd: null,
      marginalPriceUsd: null,
      fills: [],
    }
  }
  const averagePriceUsd = filledEth > 0 ? usdNotional / filledEth : null
  const marginalPriceUsd = fills.at(-1)?.priceUsd ?? null
  const averageImpactBps = averagePriceUsd === null ? null : (averagePriceUsd / midPriceUsd - 1) * 10000
  const marginalImpactBps = marginalPriceUsd === null ? null : (marginalPriceUsd / midPriceUsd - 1) * 10000
  return {
    ...base,
    status: desiredHedgeEth === 0 ? 'no-hedge' : remaining > 0 ? 'partial' : 'complete',
    issues: remaining > 0 ? ['visible-depth-exhausted'] : [],
    filledEth,
    signedFilledEth: Math.sign(desiredHedgeEth) * filledEth,
    unfilledEth: remaining,
    usdNotional,
    midPriceUsd,
    averagePriceUsd,
    marginalPriceUsd,
    averageImpactBps,
    marginalImpactBps,
    adverseAverageImpactBps: averageImpactBps === null ? null : Math.sign(desiredHedgeEth) * averageImpactBps,
    fills,
  }
}
