import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { collectEthMarketSnapshot, BINANCE_MARKET_BASE } from './collect.mjs'

const BASE = Date.UTC(2026, 9, 23, 12)
const STEP = 300000
const candle = (offset = 0) => [
  BASE + offset * STEP,
  '2500.00',
  '2510.00',
  '2490.00',
  '2505.00',
  '20.00',
  BASE + (offset + 1) * STEP - 1,
  '50000.00',
  10,
  '10.00',
  '25000.00',
  '0',
]
function provider({ rows = [candle(), candle(1), candle(2)], serverTime = BASE + 3 * STEP } = {}) {
  const calls = []
  return {
    calls,
    fetchImpl: async (url, options) => {
      const parsed = new URL(url)
      calls.push({ url: parsed, options })
      return new Response(JSON.stringify(parsed.pathname.endsWith('/time') ? { serverTime } : rows))
    },
  }
}

test('public collection preserves raw fields and uses server closure even if client clock is later', async () => {
  const api = provider()
  const rows = [candle(), candle(1), candle(2)]
  const bundle = await collectEthMarketSnapshot({ ...api, now: () => BASE + 24 * 3600000, limit: 3 })
  assert.deepEqual(bundle.rawKlines, rows)
  assert.equal(bundle.candles.length, 3)
  assert.equal(bundle.candles.at(-1).closeTime, BASE + 3 * STEP - 1)
  assert.equal(bundle.candles[0].availableAt, new Date(BASE + STEP).toISOString())
  assert.equal(bundle.candles[0].closed, true)
  assert.equal(bundle.provenance.quality.status, 'observed')
  assert.equal(bundle.provenance.historicalBackfill, true)
  assert.equal(bundle.provenance.historicalRevisionAudit, 'not-performed')
  assert.equal(api.calls.length, 2)
  assert.equal(api.calls[0].url.origin, BINANCE_MARKET_BASE)
  assert.equal(api.calls[0].url.pathname, '/api/v3/time')
  assert.equal(api.calls[1].options.redirect, 'error')
  assert.equal(api.calls[1].options.method, 'GET')
  assert.equal(api.calls[1].url.searchParams.get('endTime'), String(BASE + 3 * STEP - 1))
  assert.equal(api.calls[1].url.searchParams.get('timeZone'), '0')
  assert.equal(
    bundle.provenance.requests[1].responseSha256,
    createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
  )
})

test('server-time equality and active candles are excluded even when returned by provider', async () => {
  const api = provider({ serverTime: BASE + 3 * STEP - 1 })
  const bundle = await collectEthMarketSnapshot({ ...api, now: () => BASE + 10 * STEP, startTime: BASE, limit: 3 })
  assert.deepEqual(
    bundle.candles.map((x) => x.openTime),
    [BASE, BASE + STEP],
  )
  assert.equal(bundle.rawKlines.length, 3)
  assert.ok(bundle.provenance.quality.issues.includes('discarded-out-of-range-or-unclosed-candles'))
})

test('source ahead of client still controls closure, and future requested end cannot expand cutoff', async () => {
  const api = provider()
  const bundle = await collectEthMarketSnapshot({ ...api, now: () => BASE, endTime: BASE + 10 * STEP, limit: 3 })
  assert.equal(bundle.availableAt, new Date(BASE + 3 * STEP).toISOString())
  assert.equal(bundle.candles.length, 3)
  assert.equal(bundle.provenance.requested.endTime, BASE + 3 * STEP - 1)
})

test('partial explicit end and start retain complete intervals only, gaps stay visible', async () => {
  const api = provider({ rows: [candle(1), candle(3)], serverTime: BASE + 6 * STEP })
  const bundle = await collectEthMarketSnapshot({
    ...api,
    now: () => BASE + 6 * STEP,
    startTime: BASE + 1,
    endTime: BASE + 4 * STEP + 120000,
    limit: 4,
  })
  assert.equal(bundle.provenance.requested.startTime, BASE + STEP)
  assert.equal(bundle.provenance.requested.endTime, BASE + 4 * STEP - 1)
  assert.equal(bundle.provenance.expectedCount, 3)
  assert.equal(bundle.provenance.gaps.length, 1)
  assert.ok(bundle.provenance.quality.issues.includes('incomplete-requested-range'))
  assert.ok(bundle.provenance.quality.issues.includes('missing-candle-intervals'))
})

test('malformed, duplicate, descending or inconsistent OHLCV is rejected', async () => {
  const malformed = candle()
  malformed[6] -= 1
  const wrongHigh = candle()
  wrongHigh[2] = '2400'
  const wrongInteger = candle()
  wrongInteger[8] = Number.MAX_SAFE_INTEGER + 1
  for (const rows of [[malformed], [wrongHigh], [wrongInteger], [candle(), candle()], [candle(1), candle()]]) {
    await assert.rejects(collectEthMarketSnapshot({ ...provider({ rows }), limit: 3 }), /Invalid|ascending/)
  }
})

test('invalid controls are rejected before network and time-range cap prevents unbounded pagination', async () => {
  let calls = 0
  const fetchImpl = async () => {
    calls += 1
    return new Response(JSON.stringify({ serverTime: BASE + 10 * STEP }))
  }
  for (const options of [{ interval: '1d' }, { limit: 1001 }, { limit: 0 }, { startTime: NaN }, { timeoutMs: 30000 }]) {
    await assert.rejects(collectEthMarketSnapshot({ ...options, fetchImpl }))
  }
  assert.equal(calls, 0)
  await assert.rejects(collectEthMarketSnapshot({ fetchImpl, startTime: BASE, limit: 3 }), /exceeds candle limit/)
  assert.equal(calls, 1)
})

test('response byte limit cancels oversized body before parsing and never retries', async () => {
  let calls = 0,
    cancelled = false
  const fetchImpl = async () => {
    calls += 1
    return new Response(
      new ReadableStream({
        cancel() {
          cancelled = true
        },
      }),
      {
        headers: { 'content-length': String(16 * 1024 * 1024 + 1) },
      },
    )
  }
  await assert.rejects(collectEthMarketSnapshot({ fetchImpl }), /exceeds.*byte limit/)
  assert.equal(calls, 1)
  assert.equal(cancelled, true)
})
