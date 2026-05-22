import { describe, expect, it } from 'vitest'
import { loadCsv } from './helpers/loadCsv.js'
import { pineEquivalent } from '../../scripts/verify-pine-equivalence.mjs'
import { buildMarketState } from '../domain/market-data/cost.js'

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
  })
}
