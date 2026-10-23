import { describe, expect, it } from 'vitest'
import { analyzeEthOptionsBundle } from './ethOptionsResearch.js'
import { makeOptionsFixture } from './__tests__/optionsFixtures.js'

describe('ETH option observations and explicit passive-side scenario', () => {
  it('defaults to observations without inferred maker gamma or a hedge order', () => {
    const bundle = makeOptionsFixture()
    const original = structuredClone(bundle)
    const result = analyzeEthOptionsBundle(bundle)
    expect(result).toMatchObject({
      status: 'ready',
      executionAuthority: 'none',
      dataOrigin: 'synthetic-fixture',
      makerGamma: null,
      issues: [],
      scenario: { status: 'disabled', desiredHedgeEth: null, execution: null },
    })
    expect(result.summary).toMatchObject({
      tradeCount: 2,
      coveredTradeCount: 2,
      totalTradeEth: 3,
      coveredOpenInterestEth: 150,
      snapshotSkewMs: 1000,
    })
    expect(result.summary.unknowns).toEqual([
      'passive-counterparty-identity',
      'open-close',
      'initial-inventory',
      'actual-hedge-actions',
    ])
    expect(bundle).toEqual(original)
  })

  it('preserves fixture provenance through enabled and blocked reports', () => {
    const bundle = makeOptionsFixture()
    expect(analyzeEthOptionsBundle(bundle, { enabled: true }).dataOrigin).toBe('synthetic-fixture')
    bundle.trades = null
    expect(analyzeEthOptionsBundle(bundle)).toMatchObject({ status: 'blocked', dataOrigin: 'synthetic-fixture' })
  })

  it.each([undefined, false])('labels collector provenance as observed when fixture is %s', (fixture) => {
    const bundle = makeOptionsFixture()
    bundle.provenance.fixture = fixture
    expect(analyzeEthOptionsBundle(bundle)).toMatchObject({ status: 'ready', dataOrigin: 'observed' })
  })

  it('does not classify malformed fixture provenance as observed', () => {
    const bundle = makeOptionsFixture()
    bundle.provenance.fixture = 'false'
    expect(analyzeEthOptionsBundle(bundle)).toMatchObject({
      status: 'blocked',
      dataOrigin: 'unknown',
      issues: ['invalid-fixture-provenance'],
    })
    expect(analyzeEthOptionsBundle(null).dataOrigin).toBe('unknown')
  })

  it('revalues old trades with capture-time venue NTD without backdating the Greeks', () => {
    const bundle = makeOptionsFixture()
    const result = analyzeEthOptionsBundle(bundle, { enabled: true })
    // Call: -2 * (0.6 - 0.1) = -1 ETH. Put: -1 * (-0.4 - 0.05) = +0.45 ETH.
    expect(result.scenario.netPassiveDeltaChangeEth).toBeCloseTo(-0.55)
    expect(result.scenario.desiredHedgeEth).toBeCloseTo(0.55)
    expect(result.scenario).toMatchObject({
      status: 'ready',
      id: 'assume-passive-counterparty-hedges-incremental-trade-basket',
      valuationBasis: 'capture-time-revaluation-of-recent-trade-basket',
      execution: { side: 'buy' },
    })
    expect(result.tradeRows[0]).toMatchObject({ tradeIvPct: 60, markIvPct: 65, bsDelta: 0.6, netTransactionDelta: 0.5 })
    expect(result.tradeRows[0].tradeTime < result.tradeRows[0].tickerTime).toBe(true)
    bundle.trades[0].price = 0.8
    bundle.trades[0].iv = 100
    expect(analyzeEthOptionsBundle(bundle, { enabled: true }).scenario.desiredHedgeEth).toBeCloseTo(0.55)
  })

  it('handles taker direction, a fractional hedge ratio and signed incremental hedge already done', () => {
    const bundle = makeOptionsFixture()
    bundle.trades[0].direction = 'sell'
    const result = analyzeEthOptionsBundle(bundle, { enabled: true, hedgeRatio: 0.5, alreadyHedgedEth: -0.2 })
    expect(result.scenario.netPassiveDeltaChangeEth).toBeCloseTo(1.45)
    expect(result.scenario.desiredHedgeEth).toBeCloseTo(-0.525)
    expect(result.scenario.execution.side).toBe('sell')
  })

  it('counts unique instrument open interest once, even with repeated trades', () => {
    const bundle = makeOptionsFixture()
    bundle.trades.push({ ...bundle.trades[0], trade_id: 'synthetic-3', trade_seq: 3 })
    const result = analyzeEthOptionsBundle(bundle)
    expect(result.summary.coveredOpenInterestEth).toBe(150)
    expect(result.summary.totalTradeEth).toBe(5)
  })

  it('preserves uncovered observations but blocks the entire basket scenario', () => {
    const bundle = makeOptionsFixture()
    bundle.tickers.pop()
    const result = analyzeEthOptionsBundle(bundle, { enabled: true })
    expect(result).toMatchObject({
      status: 'partial',
      scenario: { status: 'blocked', netPassiveDeltaChangeEth: null, desiredHedgeEth: null, execution: null },
    })
    expect(result.tradeRows).toHaveLength(2)
    expect(result.tradeRows[1]).toMatchObject({
      quality: 'missing',
      amountEth: 1,
      tradeIvPct: 60,
      markIvPct: null,
      netTransactionDelta: null,
    })
    expect(result.summary).toMatchObject({
      validTradeCount: 2,
      coveredTradeCount: 1,
      totalTradeEth: 3,
      coveredOpenInterestEth: 100,
    })
  })

  it.each([
    [
      'quantity mismatch',
      (x) => {
        x.trades[0].contracts = 20
      },
      'invalid-option-trade-units-or-values',
    ],
    [
      'unsupported linear contract',
      (x) => {
        x.instruments[0].instrument_type = 'linear'
      },
      'unsupported-option-units',
    ],
    [
      'missing Greeks',
      (x) => {
        delete x.tickers[0].greeks.gamma
      },
      'invalid-or-missing-venue-greeks',
    ],
    [
      'wrong delta sign',
      (x) => {
        x.tickers[0].greeks.delta = -0.5
      },
      'option-delta-type-mismatch',
    ],
    [
      'duplicate trade',
      (x) => {
        x.trades.push({ ...x.trades[0] })
      },
      'duplicate-trade',
    ],
    [
      'stale ticker',
      (x) => {
        x.tickers[0].timestamp -= 30000
      },
      'snapshot-clock-skew-exceeded',
    ],
    [
      'future availability breach',
      (x) => {
        x.underlyingBook.timestamp += 13
      },
      'availability-precedes-source-evidence',
    ],
    [
      'invalid timestamp',
      (x) => {
        x.availableAt = 'invalid'
      },
      'invalid-collection-availability-time',
    ],
  ])('blocks %s without fake zero sensitivity', (_, change, issue) => {
    const bundle = makeOptionsFixture()
    change(bundle)
    const result = analyzeEthOptionsBundle(bundle, { enabled: true })
    expect(result.issues).toContain(issue)
    expect(result.scenario).toMatchObject({
      status: 'blocked',
      desiredHedgeEth: null,
      netPassiveDeltaChangeEth: null,
      execution: null,
    })
  })

  it('accepts conservatively delayed availability for a small source clock offset', () => {
    const bundle = makeOptionsFixture()
    bundle.underlyingBook.timestamp += 13
    bundle.availableAt = new Date(bundle.underlyingBook.timestamp).toISOString()
    expect(analyzeEthOptionsBundle(bundle, { enabled: true }).scenario.status).toBe('ready')
  })

  it.each([{ hedgeRatio: -0.01 }, { hedgeRatio: 1.01 }, { hedgeRatio: NaN }, { alreadyHedgedEth: Infinity }])(
    'rejects invalid scenario controls %o',
    (input) => {
      const result = analyzeEthOptionsBundle(makeOptionsFixture(), { enabled: true, ...input })
      expect(result.scenario).toMatchObject({
        status: 'blocked',
        issues: ['invalid-hedge-scenario-inputs'],
        desiredHedgeEth: null,
      })
    },
  )

  it('keeps a partial visible-book execution explicit', () => {
    const bundle = makeOptionsFixture()
    bundle.trades[0].amount = bundle.trades[0].contracts = 20
    const result = analyzeEthOptionsBundle(bundle, { enabled: true })
    expect(result.scenario.status).toBe('ready')
    expect(result.scenario.execution).toMatchObject({
      status: 'partial',
      filledEth: 3,
      issues: ['visible-depth-exhausted'],
    })
    expect(result.scenario.execution.unfilledEth).toBeCloseTo(6.55)
  })

  it('rejects missing or unbounded envelopes and does not throw on malformed rows', () => {
    expect(analyzeEthOptionsBundle(null).status).toBe('blocked')
    const bundle = makeOptionsFixture()
    bundle.trades = [null]
    expect(analyzeEthOptionsBundle(bundle, { enabled: true }).scenario.status).toBe('blocked')
    bundle.trades = Array(1001).fill(null)
    expect(analyzeEthOptionsBundle(bundle).status).toBe('blocked')
  })
})
