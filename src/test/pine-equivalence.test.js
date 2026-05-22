import { describe, expect, it } from 'vitest'
import { loadCsv } from './helpers/loadCsv.js'
import { pineEquivalent } from '../../scripts/verify-pine-equivalence.mjs'
import { buildMarketState } from '../domain/market-data/cost.js'
import { getDeltaBands } from '../domain/formulas/options.js'

function jsGetDeltaBand(market, lastClose) {
  const r = getDeltaBands({
    entryPrice: lastClose,
    holdingDays: 30,
    iv: market.annualVol,
    targetReturn: 0.30,
    z: 1,
    tradingDaysPerYear: 365,
  })
  return { longCost: r.long.cost, longHigh: r.long.high, longLow: r.long.low }
}

const FIXTURES = [
  { symbol: 'GOOG', path: 'public/data/GOOG-1d.csv' },
  { symbol: 'AAPL', path: 'public/data/AAPL-1d.csv' },
  { symbol: '600519', path: 'public/data/600519-1d.csv' },
  { symbol: 'BTCUSDT', path: 'public/data/BTCUSDT-1d.csv' },
]

const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-9)

for (const { symbol, path } of FIXTURES) {
  describe(`Pine ↔ JS alignment: ${symbol}`, () => {
    const rows = loadCsv(path)
    const jsRef = buildMarketState(rows, 365)
    const pine = pineEquivalent(rows)

    it('cost_anchor 差异 < 0.05%', () => {
      expect(rel(pine.cost_anchor, jsRef.costAnchor)).toBeLessThan(0.0005)
    })
    it('annual_vol 差异 < 0.20%', () => {
      expect(rel(pine.annual_vol, jsRef.annualVol)).toBeLessThan(0.002)
    })
    it('atr_pct 差异 < 0.30%', () => {
      expect(rel(pine.atr_pct, jsRef.atrPercent)).toBeLessThan(0.003)
    })
    it('cost_low 差异 < 0.10%', () => {
      expect(rel(pine.cost_low, jsRef.costLow)).toBeLessThan(0.001)
    })
    it('cost_high 差异 < 0.10%', () => {
      expect(rel(pine.cost_high, jsRef.costHigh)).toBeLessThan(0.001)
    })
    it('GetDelta long band 差异 < 0.30%', () => {
      const { longCost, longHigh, longLow } = jsGetDeltaBand(jsRef, rows.at(-1).close)
      expect(rel(pine.long_cost, longCost)).toBeLessThan(0.003)
      expect(rel(pine.long_high, longHigh)).toBeLessThan(0.003)
      expect(rel(pine.long_low, longLow)).toBeLessThan(0.003)
    })
  })
}
