import { describe, expect, it } from 'vitest'
import { buildImpactChartOverlay } from './impactChartOverlay.js'
import { analyzeEthLpBundle } from './ethLpResearch.js'
import { analyzeEthOptionsBundle } from './ethOptionsResearch.js'
import { makeReplayFixture } from './__tests__/fixtures.js'
import { makeOptionsFixture } from './__tests__/optionsFixtures.js'

const source = { symbol: 'ETHUSD', interval: '1d' }
const bars = (...dates) => dates.map((date) => ({ date, close: 2000 }))
const optionsReport = () => analyzeEthOptionsBundle(makeOptionsFixture())
const lpReport = () => analyzeEthLpBundle(makeReplayFixture())
const optionsQuery = (rows, report = optionsReport(), extra = {}) =>
  buildImpactChartOverlay({ options: { phase: 'ready', report }, source, rows, ...extra })

describe('captured impact research on the price chart', () => {
  it('never backdates a capture onto its old trades or the daily opening instant', () => {
    const result = optionsQuery(bars('2026-10-22', '2026-10-23', '2026-10-24'))
    expect(result.path[0]).toMatchObject({
      completedAt: '2026-10-23T00:00:00.000Z',
      status: 'not-yet-available',
      nodes: [],
    })
    expect(result.path[1]).toMatchObject({ completedAt: '2026-10-24T00:00:00.000Z', status: 'ready' })
    const node = result.path[1].nodes[0]
    expect(node).toMatchObject({
      kind: 'options',
      price: 2000,
      rawValue: 150,
      intensity: 1,
      availableAt: '2026-10-23T12:00:00.000Z',
      temporalBasis: 'snapshot-carried-forward-from-availability',
      dataOrigin: 'synthetic-fixture',
      executionAuthority: 'none',
    })
    expect(result.path[2].nodes[0]).toEqual(node)
    expect(result.path[2].sourceStatus.options.snapshotAgeMs).toBeGreaterThan(
      result.path[1].sourceStatus.options.snapshotAgeMs,
    )
    expect(result.futureRowsUsed).toBe(false)
  })

  it('requires an explicit close timestamp for intraday data and gates at that close', () => {
    const rows = [
      { date: '2026-10-23T10:00:00.000Z', close: 2000, endTime: '2026-10-23T11:00:00.000Z' },
      { date: '2026-10-23T11:00:00.000Z', close: 2000, closeTime: '2026-10-23T12:00:00.000Z' },
      { date: '2026-10-23T12:00:00.000Z', close: 2000 },
    ]
    const result = optionsQuery(rows, optionsReport(), { source: { symbol: 'ETHUSD', timeframe: '1h' } })
    expect(result.path[0].nodes).toEqual([])
    expect(result.path[1].nodes).toHaveLength(1)
    expect(result.path[2]).toMatchObject({ reason: 'missing-completion-time', nodes: [] })
  })

  it('refuses a future close relabelled onto an earlier daily date', () => {
    const result = optionsQuery([
      { date: '2026-10-22', close: 2000, closeTime: '2026-10-24T00:00:00.000Z' },
      { date: '2026-10-23', close: 2000, closeTime: '2026-10-23T23:59:59.999Z' },
    ])
    expect(result.path[0]).toMatchObject({ reason: 'completion-outside-daily-session', nodes: [] })
    expect(result.path[1].nodes).toHaveLength(1)
    expect(
      optionsQuery([{ date: '2026-02-30', close: 2000, closeTime: '2026-03-01T00:00:00.000Z' }]).path[0],
    ).toMatchObject({ reason: 'invalid-session-date', nodes: [] })
  })

  it('rejects intraday completion before its opening timestamp', () => {
    const result = optionsQuery(
      [{ date: '2026-10-23T13:00:00.000Z', close: 2000, endTime: '2026-10-23T12:00:00.000Z' }],
      optionsReport(),
      { source: { symbol: 'ETHUSD', interval: '1h' } },
    )
    expect(result.path[0]).toMatchObject({ reason: 'completion-before-session-end', nodes: [] })
  })

  it.each([
    [{ isClosed: false }, 'unclosed-session'],
    [{ closed: false }, 'unclosed-session'],
    [{ closeTime: '2026-10-24 00:00:00' }, 'invalid-completion-time'],
    [{ closeTime: null }, 'invalid-completion-time'],
    [{ close: NaN }, 'invalid-close-price'],
  ])('leaves an explicit gap for invalid or unfinished candles %o', (fields, reason) => {
    const result = optionsQuery([{ ...bars('2026-10-23')[0], ...fields }])
    expect(result.path[0]).toMatchObject({ status: 'invalid-data', reason, nodes: [] })
  })

  it('preserves every prefix when later candles are added or changed', () => {
    const history = bars('2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25')
    const before = structuredClone(history)
    const full = optionsQuery(history)
    for (let end = 1; end <= history.length; end += 1) {
      expect(optionsQuery(history.slice(0, end)).path).toEqual(full.path.slice(0, end))
    }
    history.push({ date: '2030-01-01', close: 1e50 })
    expect(optionsQuery(history).path.slice(0, 4)).toEqual(full.path)
    expect(history.slice(0, 4)).toEqual(before)
  })

  it.each(['BTCUSD', 'AAPL', 'ETHBTC', 'SOMETHING'])('never paints ETH evidence onto %s', (symbol) => {
    const result = optionsQuery(bars('2026-10-23'), optionsReport(), { source: { symbol } })
    expect(result.path[0].nodes).toEqual([])
    expect(result.sourceStatus.options.reason).toBe('asset-mismatch')
  })

  it('explicitly labels the requested dollar approximation without converting prices', () => {
    const result = buildImpactChartOverlay({
      source: { symbol: 'ETHUSDT', label: 'ETH USD', quoteCurrency: 'USDT' },
      rows: bars('2026-10-23'),
      lp: lpReport(),
      options: optionsReport(),
    })
    expect(result.sourceStatus.lp.quoteApproximation).toBe(true)
    expect(result.sourceStatus.options.quoteApproximation).toBe(true)
    expect(result.priceBasis).toBe('approximate-usd-reference-no-fx-conversion')
    expect(result.path[0].nodes.find((node) => node.kind === 'options')).toMatchObject({
      price: 2000,
      quoteCurrency: 'USD',
      axisQuoteCurrency: 'USDT',
      quoteApproximation: true,
    })
    expect(
      optionsQuery(bars('2026-10-23'), optionsReport(), { source: { symbol: 'ETHUSDT', quoteCurrency: 'USD' } }).reason,
    ).toBe('conflicting-asset-identity')
    expect(
      optionsQuery(bars('2026-10-23'), optionsReport(), {
        source: { symbol: 'BTCUSD', baseAsset: 'ETH', quoteCurrency: 'USD' },
      }).reason,
    ).toBe('asset-mismatch')
  })

  it('deduplicates OI per contract and trades by id before aggregating by strike', () => {
    const report = optionsReport()
    report.tradeRows.push({ ...report.tradeRows[0], id: 'another-trade', amountEth: 3 })
    report.tradeRows.push({ ...report.tradeRows[0] })
    const result = optionsQuery(bars('2026-10-23'), report)
    expect(result.path[0].nodes).toHaveLength(1)
    expect(result.path[0].nodes[0]).toMatchObject({ rawValue: 150, tradeVolumeEth: 6, contractCount: 2 })
  })

  it('drops expired contracts only at later closes, preserving historical node intensity', () => {
    const report = optionsReport()
    report.tradeRows[0].expiry = '2026-10-25T00:00:00.000Z'
    report.tradeRows[1].strikePriceUsd = 2100
    const result = optionsQuery(bars('2026-10-23', '2026-10-24'), report)
    expect(result.path[0].nodes.map(({ rawValue, intensity }) => ({ rawValue, intensity }))).toEqual([
      { rawValue: 100, intensity: 1 },
      { rawValue: 50, intensity: 0.5 },
    ])
    expect(result.path[1].nodes).toHaveLength(1)
    expect(result.path[1].nodes[0]).toMatchObject({ price: 2100, intensity: 1 })
  })

  it('does not use an enabled hypothetical hedge, execution price or maker gamma', () => {
    const original = optionsReport()
    const changed = structuredClone(original)
    changed.scenario = { status: 'ready', desiredHedgeEth: 1e12, execution: { averagePrice: 1e9 } }
    changed.makerGamma = 1e30
    expect(optionsQuery(bars('2026-10-23'), changed)).toEqual(optionsQuery(bars('2026-10-23'), original))
  })

  it('requires source availability and does not reuse stale results while a lane computes', () => {
    const report = optionsReport()
    report.summary.availableAt = null
    expect(optionsQuery(bars('2026-10-23'), report).sourceStatus.options.reason).toBe('missing-availability-time')
    expect(
      optionsQuery(bars('2026-10-23'), optionsReport(), {
        options: { phase: 'computing', report: optionsReport() },
      }).path[0].nodes,
    ).toEqual([])
    const futureRow = optionsReport()
    futureRow.tradeRows[0].tickerTime = '2026-10-23T13:00:00.000Z'
    expect(optionsQuery(bars('2026-10-23'), futureRow).sourceStatus.options.reason).toBe(
      'availability-precedes-option-evidence',
    )
  })

  it('uses LP tick ranges in USDC/WETH and keeps exact signed/raw liquidity units', () => {
    const report = lpReport()
    const result = buildImpactChartOverlay({
      lp: report,
      source: { symbol: 'ETHUSDC' },
      rows: bars('2023-11-13', '2023-11-14'),
    })
    expect(result.path[0].nodes).toEqual([])
    const nodes = result.path[1].nodes
    expect(nodes).toHaveLength(2)
    expect(nodes[0]).toMatchObject({
      kind: 'lp',
      action: 'Mint',
      rawValue: '200000000000000',
      signedLiquidityDeltaRaw: '200000000000000',
      intensity: 1,
      unit: 'liquidity-raw',
    })
    expect(nodes[1]).toMatchObject({
      action: 'Burn',
      rawValue: '100000000000000',
      signedLiquidityDeltaRaw: '-100000000000000',
      intensity: 0.5,
    })
    expect(nodes[0].lowerPrice).toBeCloseTo(1e12 / 1.0001 ** 200020, 6)
    expect(nodes[0].upperPrice).toBeCloseTo(1e12 / 1.0001 ** 199990, 6)
    expect(nodes[0].price).toBeGreaterThan(nodes[0].lowerPrice)
    expect(nodes[0].price).toBeLessThan(nodes[0].upperPrice)
    expect(result.sourceStatus.lp.meaning).toBe('observed-liquidity-action-not-current-depth')
  })

  it('normalizes LP action size independently of option data and deduplicates event ids', () => {
    const report = lpReport()
    report.actions.push({ ...report.actions[0] })
    const result = buildImpactChartOverlay({
      lp: report,
      options: optionsReport(),
      source: { symbol: 'WETH/USDC' },
      rows: bars('2026-10-23'),
    })
    expect(result.path[0].nodes.filter((node) => node.kind === 'lp').map((node) => node.intensity)).toEqual([1, 0.5])
    expect(result.path[0].nodes[0].eventCount).toBe(1)
    expect(result.sourceStatus.options.quoteApproximation).toBe(true)
  })

  it('ignores a zero Burn fee poke instead of blocking valid liquidity observations', () => {
    const report = lpReport()
    report.actions.push({
      event: { ...report.actions[1].event, logIndex: 10, liquidityDeltaRaw: '0' },
    })
    const result = buildImpactChartOverlay({ lp: report, source: { symbol: 'ETHUSDC' }, rows: bars('2023-11-14') })
    expect(result.status).toBe('ready')
    expect(result.path[0].nodes).toHaveLength(2)
    expect(result.path[0].nodes.map((node) => node.intensity)).toEqual([1, 0.5])
  })

  it('never paints a later duplicate session or missing history', () => {
    const result = optionsQuery(bars('2026-10-23', '2026-10-23'))
    expect(result.path[0].status).toBe('ready')
    expect(result.path[1]).toMatchObject({ reason: 'non-increasing-completion-time', nodes: [] })
    expect(buildImpactChartOverlay()).toMatchObject({ status: 'empty', reason: 'missing-history', path: [] })
  })
})
