import { describe, expect, it } from 'vitest'
import { analyzeEthMarketBundle } from '../ethMarketSnapshot.js'
import { completedBarTime } from '../impactChartTime.js'

function fixture(interval = '5m') {
  const intervalMs = interval === '5m' ? 300000 : 3600000
  const start = Date.parse('2026-10-23T12:00:00Z')
  const end = start + intervalMs * 3 - 1
  const iso = (value) => new Date(value).toISOString()
  const requested = { symbol: 'ETHUSDT', interval, startTime: start, endTime: end, timeZone: '0', limit: 3 }
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
    collectionStartedAt: iso(end + 1),
    collectedAt: iso(end + 1000),
    serverTime: end + 100,
    availableAt: iso(end + 1000),
    rawKlines: Array.from({ length: 3 }, (_, i) => [
      start + i * intervalMs,
      '2400.00',
      '2410.00',
      '2390.00',
      '2405.00',
      '100.00',
      start + (i + 1) * intervalMs - 1,
      '240000.00',
      100,
      '50.00',
      '120000.00',
      '0',
    ]),
    provenance: {
      scope: 'local-research',
      publicDataOnly: true,
      licenseScope: 'local-personal-research',
      endpoint: 'https://data-api.binance.vision',
      production: true,
      historicalBackfill: true,
      historicalRevisionAudit: 'not-performed',
      candleAvailabilityBasis: 'exchange-close-time-plus-one-ms',
      closureBasis: 'closeTime-before-serverTime-read-before-klines',
      executionAuthority: 'none',
      requested,
      requests: [
        {
          path: '/api/v3/time',
          params: {},
          requestStartedAt: iso(end + 1),
          responseReceivedAt: iso(end + 200),
          responseSha256: 'a'.repeat(64),
        },
        {
          path: '/api/v3/klines',
          params: { ...requested },
          requestStartedAt: iso(end + 200),
          responseReceivedAt: iso(end + 900),
          responseSha256: 'b'.repeat(64),
        },
      ],
    },
  }
}

describe('historical ETH market capture boundary', () => {
  it.each(['5m', '1h'])('maps %s raw exchange bars to closed UTC rows without daily models', (interval) => {
    const bundle = fixture(interval)
    const report = analyzeEthMarketBundle(bundle)
    expect(report.status).toBe('ready')
    expect(report.source).toMatchObject({ type: 'research-market', symbol: 'ETHUSDT', timeframe: interval })
    expect(report.rows[0]).toMatchObject({ date: '2026-10-23T12:00:00.000Z', close: 2405, isClosed: true })
    expect(completedBarTime(report.rows[0], report.source).time).toBe(bundle.rawKlines[0][6] + 1)
    expect(Date.parse(report.rows[0].availableAt)).toBeLessThan(Date.parse(report.capturedAt))
    expect(report).toMatchObject({
      executionAuthority: 'none',
      futureRowsUsed: false,
      historicalRevisionAudit: 'not-performed',
    })
    expect(bundle.rawKlines[0][1]).toBe('2400.00')
  })

  it('discards out-of-range raw bars and never exposes the currently forming candle', () => {
    const bundle = fixture()
    bundle.provenance.requested.limit = 4
    bundle.provenance.requests[1].params.limit = 4
    const forming = [...bundle.rawKlines.at(-1)]
    forming[0] += bundle.intervalMs
    forming[6] += bundle.intervalMs
    bundle.rawKlines.push(forming)
    const report = analyzeEthMarketBundle(bundle)
    expect(report.status).toBe('ready')
    expect(report.rows).toHaveLength(3)
    expect(report.rows.every((row) => row.closeTime < bundle.serverTime)).toBe(true)
    expect(report.issues).toContain('discarded-out-of-range-or-unclosed-candles')
  })

  it('rejects a requested end later than the server clock or a shifted close timestamp', () => {
    const bundle = fixture()
    bundle.provenance.requested.endTime += bundle.intervalMs
    expect(analyzeEthMarketBundle(bundle).issues).toContain('invalid-market-request-range')
    const shifted = fixture()
    shifted.rawKlines[0][6] += 1
    expect(analyzeEthMarketBundle(shifted)).toMatchObject({ status: 'blocked', rows: [] })
  })

  it.each([
    (b) => {
      b.rawKlines.reverse()
    },
    (b) => {
      b.rawKlines[1] = [...b.rawKlines[0]]
    },
    (b) => {
      b.rawKlines[0][2] = '2300.00'
    },
    (b) => {
      b.rawKlines[0][5] = '-1'
    },
    (b) => {
      b.rawKlines[0][9] = '101.0'
    },
    (b) => {
      b.rawKlines[0][1] = 'Infinity'
    },
    (b) => {
      b.interval = '1d'
      delete b.intervalMs
    },
    (b) => {
      b.symbol = 'BTCUSDT'
    },
    (b) => {
      b.collectionStartedAt = '2026-10-23T12:00:00'
    },
    (b) => {
      b.provenance.requests.reverse()
    },
    (b) => {
      b.provenance.requests[1].params.interval = '1h'
    },
    (b) => {
      b.candles = [{ open: 1 }]
    },
  ])('blocks malformed source/sequence/OHLCV or derived candle claims', (mutate) => {
    const bundle = fixture()
    mutate(bundle)
    expect(analyzeEthMarketBundle(bundle)).toMatchObject({ status: 'blocked', rows: [] })
  })

  it('keeps gaps explicit and does not interpolate prices', () => {
    const bundle = fixture()
    bundle.rawKlines.splice(1, 1)
    const report = analyzeEthMarketBundle(bundle)
    expect(report.rows).toHaveLength(2)
    expect(report.issues).toContain('missing-candle-intervals')
    expect(report.issues).toContain('incomplete-requested-range')
  })

  it('cross-checks every retained derived candle against the raw exchange tuple', () => {
    const bundle = fixture()
    bundle.candles = bundle.rawKlines.map((row) => ({
      openTime: row[0],
      closeTime: row[6],
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
      quoteVolume: Number(row[7]),
      tradeCount: row[8],
      takerVolume: Number(row[9]),
      takerQuoteVolume: Number(row[10]),
      closed: true,
      availableAt: new Date(row[6] + 1).toISOString(),
    }))
    expect(analyzeEthMarketBundle(bundle).status).toBe('ready')
    bundle.candles[0].availableAt = new Date(bundle.rawKlines[0][0]).toISOString()
    expect(analyzeEthMarketBundle(bundle)).toMatchObject({
      status: 'blocked',
      rows: [],
      issues: ['market-candles-mismatch'],
    })
  })

  it('does not change earlier candle values when a later closed candle is appended', () => {
    const complete = fixture()
    const prefix = structuredClone(complete)
    prefix.rawKlines.pop()
    expect(analyzeEthMarketBundle(complete).rows.slice(0, 2)).toEqual(analyzeEthMarketBundle(prefix).rows)
  })
})
