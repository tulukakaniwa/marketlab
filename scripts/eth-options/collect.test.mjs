import test from 'node:test'
import assert from 'node:assert/strict'
import { collectEthOptionsSnapshot } from './collect.mjs'

const BASE = Date.UTC(2026, 9, 23, 10)
function provider({
  count = 3,
  tickerError = false,
  missingGreek = false,
  stale = false,
  duplicateTrade = false,
  unordered = false,
  bookClockLead = 0,
  tradeClockLead = 0,
} = {}) {
  let clock = BASE
  const now = () => (clock += 20)
  const names = Array.from({ length: count }, (_, index) => `ETH-30OCT26-${3000 + index * 100}-C`)
  const instruments = names.map((instrument_name) => ({
    instrument_name,
    base_currency: 'ETH',
    kind: 'option',
    instrument_type: 'reversed',
    quote_currency: 'ETH',
    settlement_currency: 'ETH',
    contract_size: 1,
    expiration_timestamp: BASE + 7 * 86400000,
    strike: 3000,
    option_type: 'call',
  }))
  const trades = names.map((instrument_name, index) => ({
    instrument_name,
    timestamp: BASE + tradeClockLead - index * 100,
    trade_id: `trade-${index}`,
    direction: 'buy',
    amount: 1,
    price: 0.1,
  }))
  if (duplicateTrade && count > 1) trades[1].trade_id = trades[0].trade_id
  if (unordered) trades.reverse()
  const calls = []
  const fetchImpl = async (url, init) => {
    const target = new URL(url)
    const method = target.pathname.replace('/api/v2/', '')
    const params = Object.fromEntries(target.searchParams)
    calls.push({ method, params, init })
    assert.equal(target.origin, 'https://www.deribit.com')
    assert.equal(init.method, 'GET')
    assert.equal(init.body, undefined)
    let result
    let error
    if (method === 'public/get_instruments') result = instruments
    else if (method === 'public/get_last_trades_by_currency') result = { trades, has_more: true }
    else if (method === 'public/ticker') {
      if (tickerError) error = { code: 10004, message: 'bad https://server/secret' }
      else
        result = {
          instrument_name: params.instrument_name,
          timestamp: stale ? BASE - 60000 : now(),
          underlying_price: 3000,
          mark_iv: 50,
          greeks: missingGreek ? { gamma: 0.001 } : { delta: 0.5, gamma: 0.001 },
        }
    } else if (method === 'public/get_instrument')
      result = {
        instrument_name: 'ETH-PERPETUAL',
        base_currency: 'ETH',
        quote_currency: 'USD',
        settlement_currency: 'ETH',
        instrument_type: 'reversed',
        contract_size: 1,
      }
    else if (method === 'public/get_order_book')
      result = {
        instrument_name: 'ETH-PERPETUAL',
        timestamp: now() + bookClockLead,
        bids: [[2999, 10000]],
        asks: [[3001, 10000]],
      }
    else throw new Error('Unexpected request')
    return new Response(JSON.stringify({ jsonrpc: '2.0', testnet: false, result, error }))
  }
  return { calls, trades, instruments, fetchImpl, now }
}

test('collects original objects in bounded sequence and records honest collection times', async () => {
  const mock = provider({ count: 3, unordered: true })
  const bundle = await collectEthOptionsSnapshot({ fetchImpl: mock.fetchImpl, now: mock.now })
  assert.deepEqual(bundle.trades, mock.trades)
  assert.deepEqual(bundle.instruments, mock.instruments)
  assert.deepEqual(
    bundle.tickers.map((item) => item.instrument_name),
    [...mock.trades].reverse().map((item) => item.instrument_name),
  )
  assert.deepEqual(
    mock.calls.map((item) => item.method),
    [
      'public/get_instruments',
      'public/get_last_trades_by_currency',
      'public/ticker',
      'public/ticker',
      'public/ticker',
      'public/get_instrument',
      'public/get_order_book',
    ],
  )
  assert.equal(mock.calls[1].params.count, '30')
  assert.equal(mock.calls.at(-1).params.depth, '20')
  assert.ok(bundle.collectionStartedAt < bundle.collectedAt)
  assert.equal(bundle.availableAt, bundle.collectedAt)
  assert.equal(bundle.provenance.history.completeHistory, false)
  assert.equal(bundle.provenance.historicalBackfill, false)
  assert.equal(bundle.provenance.quality.status, 'observed')
  assert.equal(bundle.provenance.licenseScope, 'local-personal-research')
  assert.ok(bundle.provenance.requests.every((item) => item.requestStartedAt <= item.responseReceivedAt))
  assert.ok(bundle.trades.every((item) => item.timestamp < Date.parse(bundle.availableAt)))
})

test('ticker limit preserves every trade and explicitly records uncovered symbols', async () => {
  const mock = provider({ count: 13 })
  const bundle = await collectEthOptionsSnapshot({ tradeCount: 13, fetchImpl: mock.fetchImpl, now: mock.now })
  assert.equal(bundle.trades.length, 13)
  assert.equal(bundle.tickers.length, 12)
  assert.equal(mock.calls.length, 16)
  assert.equal(bundle.provenance.tickerCoverage.uncovered.length, 1)
  assert.equal(bundle.provenance.tickerCoverage.uncovered[0].reason, 'ticker-limit')
  assert.ok(bundle.provenance.quality.issues.includes('incomplete-ticker-coverage'))
  assert.equal(bundle.provenance.history.hasMore, true)
  assert.equal(bundle.provenance.history.completeHistory, false)
})

test('missing Greeks and stale ticker remain raw observations with partial quality', async () => {
  const mock = provider({ missingGreek: true, stale: true })
  const bundle = await collectEthOptionsSnapshot({ fetchImpl: mock.fetchImpl, now: mock.now })
  assert.equal(bundle.tickers.length, 3)
  assert.equal(bundle.tickers[0].greeks.delta, undefined)
  assert.ok(bundle.provenance.quality.issues.includes('incomplete-ticker-fields'))
  assert.ok(bundle.provenance.quality.issues.includes('snapshot-clock-skew-or-stale-over-30s'))
  assert.deepEqual(bundle.provenance.missingTickerFields[0].fields, ['greeks.delta'])
})

test('API errors, duplicate evidence and invalid bounds fail without a fallback bundle', async () => {
  const failure = provider({ tickerError: true })
  await assert.rejects(
    collectEthOptionsSnapshot({ fetchImpl: failure.fetchImpl, now: failure.now, retryDelayMs: 0 }),
    (error) => error.message.includes('10004') && !error.message.includes('secret'),
  )
  assert.equal(failure.calls.length, 3)
  const duplicate = provider({ duplicateTrade: true })
  await assert.rejects(
    collectEthOptionsSnapshot({ fetchImpl: duplicate.fetchImpl, now: duplicate.now }),
    /trade response/,
  )
  const never = async () => {
    throw new Error('network must not run')
  }
  await assert.rejects(collectEthOptionsSnapshot({ tradeCount: 31, fetchImpl: never }), /tradeCount/)
  await assert.rejects(collectEthOptionsSnapshot({ maxTickers: 13, fetchImpl: never }), /maxTickers/)
})

test('availability waits for the latest source timestamp while preserving client collection time', async () => {
  for (const options of [{ bookClockLead: 100 }, { tradeClockLead: 10000 }]) {
    const mock = provider(options)
    const bundle = await collectEthOptionsSnapshot({ fetchImpl: mock.fetchImpl, now: mock.now })
    const latest = Math.max(
      bundle.underlyingBook.timestamp,
      ...bundle.tickers.map((item) => item.timestamp),
      ...bundle.trades.map((item) => item.timestamp),
    )
    assert.ok(latest > Date.parse(bundle.collectedAt))
    assert.equal(bundle.availableAt, new Date(latest).toISOString())
    assert.equal(bundle.provenance.clientSourceClockSkewMs, latest - Date.parse(bundle.collectedAt))
    assert.equal(bundle.provenance.availableAtBasis, 'max-client-collection-and-source-time')
    assert.equal(bundle.provenance.largeIntegerEncoding, 'decimal-string')
    assert.equal(bundle.provenance.observationType, 'bounded-non-atomic-snapshot')
  }
})
