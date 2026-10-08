import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Indicator, PineTS } from 'pinets'
import { parseCsvText } from '../src/domain/market-data/ohlcv.js'
import { inferTdpy } from '../src/domain/market-data/tdpy.js'
import { pineEquivalent } from './verify-pine-equivalence.mjs'

// Executes the actual Pine source. The existing equivalence gate checks the
// independent JS twin against domain outputs; it does not compile Pine source.
const root = new URL('../', import.meta.url)
const source = readFileSync(new URL('bl-esw-pinbar-market-lab.pine', root), 'utf8')
const fixtures = ['GOOG', 'AAPL', '600519', 'BTCUSDT']
const numericPlots = {
  'ML Cost': 'cost_anchor',
  'ML Cost Low': 'cost_low',
  'ML Cost High': 'cost_high',
  'GetDelta Long Low': 'long_low',
  'GetDelta Long High': 'long_high',
  'GetDelta Short High': 'short_high',
  'LP Range Low': 'lp_lower',
  'LP Range High': 'lp_upper',
}
const signals = ['ML Low Buy', 'ML Wait Stop', 'ML Deep Discount', 'ML Trim', 'ML No Chase']
let comparisons = 0
let worstRelativeError = 0

function candles(rows) {
  return rows.map(({ date, open, high, low, close, volume }) => {
    const openTime = Date.parse(`${date}T00:00:00Z`)
    assert(Number.isFinite(openTime), `Invalid fixture date: ${date}`)
    return { openTime, closeTime: openTime + 86400000 - 1, open, high, low, close, volume }
  })
}

function compare(actual, expected, label, tolerance = 1e-6) {
  comparisons += 1
  if (!Number.isFinite(expected)) {
    assert(actual == null || Number.isNaN(actual), `${label}: expected an unavailable value, got ${actual}`)
    return
  }
  assert(Number.isFinite(actual), `${label}: expected a finite value, got ${actual}`)
  const error = Math.abs(actual - expected) / Math.max(Math.abs(expected), 1e-9)
  worstRelativeError = Math.max(worstRelativeError, error)
  assert(error <= tolerance, `${label}: relative error ${error} exceeds ${tolerance}`)
}

for (const symbol of fixtures) {
  const path = new URL(`public/data/${symbol}-1d.csv`, root)
  const rows = parseCsvText(readFileSync(path, 'utf8'))
  const bars = candles(rows)
  assert(rows.length >= 200, `${symbol}: fixture needs at least 200 bars`)
  const tdpy = inferTdpy({ symbol }).value
  assert(Number.isFinite(tdpy), `${symbol}: missing trading-session basis`)
  const indicator = new Indicator(source, { 'Trading Sessions / Year': tdpy })
  const result = await new PineTS(bars).run(indicator)
  for (const title of [...Object.keys(numericPlots), ...signals]) {
    assert(result.plots[title], `${symbol}: missing plot ${title}`)
    assert.equal(result.plots[title].data.length, rows.length, `${symbol}/${title}: lost bars`)
  }

  const sizes = [2, 5, 50, 200, Math.floor(rows.length / 2), rows.length]
  for (const size of sizes) {
    const reference = pineEquivalent(rows.slice(0, size), { trading_sessions_per_year: tdpy })
    for (const [title, field] of Object.entries(numericPlots)) {
      const point = result.plots[title].data[size - 1]
      assert.equal(point.time, bars[size - 1].openTime, `${symbol}/${title}: time must stay in milliseconds`)
      compare(point.value, reference[field], `${symbol}/${size}/${field}`, field.startsWith('cost_') ? 1e-8 : 1e-6)
    }

    // Re-executing a historical prefix must reproduce the same observation in
    // the full-history run. This checks runtime causality, not just JS math.
    if (![50, 200, Math.floor(rows.length / 2)].includes(size)) continue
    const prefix = await new PineTS(bars.slice(0, size)).run(indicator)
    for (const title of [...Object.keys(numericPlots), ...signals]) {
      const expected = result.plots[title].data[size - 1].value
      const actual = prefix.plots[title].data.at(-1).value
      if (typeof expected === 'boolean') assert.equal(actual, expected, `${symbol}/${title}: future-dependent signal`)
      else compare(actual, expected, `${symbol}/${title}: future-dependent value`, 1e-10)
    }
  }
  console.log(`${symbol}: ${rows.length} bars, ${tdpy} sessions/year, source execution and prefix checks passed`)
}

console.log(
  `PineTS runtime: ${comparisons} numeric checks passed; max relative error ${worstRelativeError.toExponential(3)}`,
)
console.log(`Source: ${fileURLToPath(new URL('bl-esw-pinbar-market-lab.pine', root))}`)
console.log(
  'Scope: numeric plots and prefix causality; TradingView execution, rendering, and strategy fills are not verified here.',
)
