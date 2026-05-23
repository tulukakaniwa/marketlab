import { describe, expect, it } from 'vitest'
import { loadCsv } from './helpers/loadCsv.js'
import { pineEquivalent, DEFAULTS as PINE_DEFAULTS } from '../../scripts/verify-pine-equivalence.mjs'
import { buildMarketState } from '../domain/market-data/cost.js'
import { getDeltaBands } from '../domain/formulas/options.js'
import { deviationScore } from '../domain/formulas/core.js'
import { normalCdf } from '../domain/formulas/probability.js'

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
    it('lp_lower / lp_upper 差异 < 0.05%', () => {
      // 用 PINE_DEFAULTS 而非硬编码：默认值改动时测试会自然跟随，避免静默通过
      const lpLower = jsRef.costAnchor * Math.max(1 - PINE_DEFAULTS.lp_range_width, 0.001)
      const lpUpper = jsRef.costAnchor * (1 + PINE_DEFAULTS.lp_range_width * PINE_DEFAULTS.lp_skew)
      expect(rel(pine.lp_lower, lpLower)).toBeLessThan(0.0005)
      expect(rel(pine.lp_upper, lpUpper)).toBeLessThan(0.0005)
    })
    it('match_pct 差异 < 0.50%', () => {
      const dev = deviationScore({
        costDistance: jsRef.costDistance,
        annualVol: jsRef.annualVol,
        holdingDays: 30,
        tradingDaysPerYear: 365,
      })
      const zAbs = Math.abs(dev.z)
      // normalCdf(zAbs) 内部做 z=|x|/√2；等价于 Pine 的 norm_cdf_abs(z_abs/sqrt(2))
      const matchJs = zAbs >= 8 ? 1 : Math.max(0, Math.min(1, 2 * normalCdf(zAbs) - 1))
      expect(rel(pine.match_pct, matchJs)).toBeLessThan(0.005)
    })
  })
}

describe('iv_override 切换语义', () => {
  const rows = loadCsv('public/data/AAPL-1d.csv')
  const lastClose = rows.at(-1).close

  it('iv_override = 0 时退化为 annual_vol（与默认一致）', () => {
    const a = pineEquivalent(rows)
    const b = pineEquivalent(rows, { iv_override: 0 })
    expect(rel(a.long_cost, b.long_cost)).toBeLessThan(1e-12)
  })

  it('iv_override > 0 时 GetDelta band 用用户输入的 IV 计算', () => {
    const userIv = 0.221
    const result = pineEquivalent(rows, { iv_override: userIv })
    // 用 jsGetDeltaBand 算 IV=0.221 的参考值（市场对象只用 annualVol 字段，所以伪造一个 jsRef）
    const ref = jsGetDeltaBand({ annualVol: userIv }, lastClose)
    expect(rel(result.long_cost, ref.longCost)).toBeLessThan(0.003)
    expect(rel(result.long_high, ref.longHigh)).toBeLessThan(0.003)
    expect(rel(result.long_low, ref.longLow)).toBeLessThan(0.003)
  })
})

describe('iv_override 切换语义', () => {
  const rows = loadCsv('public/data/AAPL-1d.csv')
  const lastClose = rows.at(-1).close

  it('iv_override = 0 时退化为 annual_vol（与默认一致）', () => {
    const a = pineEquivalent(rows)
    const b = pineEquivalent(rows, { iv_override: 0 })
    expect(rel(a.long_cost, b.long_cost)).toBeLessThan(1e-12)
  })

  it('iv_override > 0 时 GetDelta band 用用户输入的 IV 计算', () => {
    const userIv = 0.221
    const result = pineEquivalent(rows, { iv_override: userIv })
    // 用 jsGetDeltaBand 算 IV=0.221 的参考值（市场对象只用 annualVol 字段，所以伪造一个 jsRef）
    const ref = jsGetDeltaBand({ annualVol: userIv }, lastClose)
    expect(rel(result.long_cost, ref.longCost)).toBeLessThan(0.003)
    expect(rel(result.long_high, ref.longHigh)).toBeLessThan(0.003)
    expect(rel(result.long_low, ref.longLow)).toBeLessThan(0.003)
  })
})
