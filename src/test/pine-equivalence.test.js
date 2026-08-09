import { describe, expect, it } from 'vitest'
import { loadCsv } from './helpers/loadCsv.js'
import { DEFAULTS as PINE_DEFAULTS, derivePineWindows, pineEquivalent } from '../../scripts/verify-pine-equivalence.mjs'
import { buildMarketState } from '../domain/market-data/cost.js'
import { buildFormulaPath } from '../domain/market-data/formulaPath.js'
import { deviationScore } from '../domain/formulas/core.js'
import { inferTdpy } from '../domain/market-data/tdpy.js'

const FIXTURES = [
  { symbol: 'GOOG', path: 'public/data/GOOG-1d.csv' },
  { symbol: 'AAPL', path: 'public/data/AAPL-1d.csv' },
  { symbol: '600519', path: 'public/data/600519-1d.csv' },
  { symbol: 'BTCUSDT', path: 'public/data/BTCUSDT-1d.csv' },
]

const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-9)

function latestEligiblePrefix(rows, tradingDaysPerYear) {
  const path = buildFormulaPath(rows, {
    tradingDaysPerYear,
    deltaSlope: PINE_DEFAULTS.delta_slope,
  })
  for (let index = path.length - 1; index >= 0; index -= 1) {
    if (path[index].formulaHorizonSessions) return { rows: rows.slice(0, index + 1), point: path[index] }
  }
  throw new Error('fixture 没有可验证的动态恢复周期')
}

for (const { symbol, path } of FIXTURES) {
  describe(`Pine ↔ JS prefix-causal alignment: ${symbol}`, () => {
    const rows = loadCsv(path)
    const tdpy = inferTdpy({ symbol }).value
    const jsRef = buildMarketState(rows, tdpy)
    const pine = pineEquivalent(rows, { trading_sessions_per_year: tdpy })

    it('使用网站推导的交易日年化口径', () => {
      expect(tdpy).toBe(symbol === 'BTCUSDT' ? 365 : symbol === '600519' ? 242 : 252)
    })

    it('窗口由当前前缀推导，不含 30/60 默认周期', () => {
      const windows = derivePineWindows(rows.length)
      expect(pine.prefix_n).toBe(rows.length)
      expect(pine.cost_window).toBe(windows.cost_window)
      expect(pine.recent_window).toBe(windows.recent_window)
      expect(pine.vol_window).toBe(windows.cost_window)
      expect(jsRef.windowSpec).toMatchObject({
        cost: windows.cost_window,
        recent: windows.recent_window,
        vol: windows.cost_window,
        mode: 'adaptive-prefix',
      })
    })

    it('成本锚、成本带、年化波动率与 recent ATR 对齐', () => {
      expect(rel(pine.cost_anchor, jsRef.costAnchor)).toBeLessThan(1e-10)
      expect(rel(pine.cost_low, jsRef.costLow)).toBeLessThan(1e-10)
      expect(rel(pine.cost_high, jsRef.costHigh)).toBeLessThan(1e-10)
      expect(rel(pine.annual_vol, jsRef.annualVol)).toBeLessThan(1e-10)
      expect(rel(pine.atr_pct, jsRef.atrPercent)).toBeLessThan(1e-10)
    })

    it('当 0<q<1 不成立时不输出周期、GetDelta、z 或信号', () => {
      if (pine.recovery_fraction > 0 && pine.recovery_fraction < 1 && pine.rho > 0 && pine.rho < 1) return
      expect(pine.formula_ready).toBe(false)
      expect(pine.signals_enabled).toBe(false)
      expect(Number.isNaN(pine.formula_horizon_sessions)).toBe(true)
      expect(Number.isNaN(pine.long_low)).toBe(true)
      expect(Number.isNaN(pine.z_score)).toBe(true)
    })

    it('在最近可用前缀对齐 expanding rho、q、H、GetDelta 和 z', () => {
      const eligible = latestEligiblePrefix(rows, tdpy)
      const twin = pineEquivalent(eligible.rows, { trading_sessions_per_year: tdpy })
      const point = eligible.point
      const context = point.fieldStates.formulaHorizonSessions.context

      expect(twin.rho).toBeGreaterThan(0)
      expect(twin.rho).toBeLessThan(1)
      expect(rel(twin.rho, context.meanReversion.arCoefficient)).toBeLessThan(1e-10)
      expect(rel(twin.half_life_sessions, context.meanReversion.halfLifeSessions)).toBeLessThan(1e-10)
      expect(rel(twin.recovery_fraction, point.recoveryFraction)).toBeLessThan(1e-10)
      expect(twin.formula_horizon_sessions).toBe(point.formulaHorizonSessions)
      expect(rel(twin.long_cost, point.deltaCost)).toBeLessThan(1e-10)
      expect(rel(twin.long_low, point.deltaLower)).toBeLessThan(1e-10)
      expect(rel(twin.long_high, point.deltaUpper)).toBeLessThan(1e-10)

      const dev = deviationScore({
        costDistance: twin.cost_distance,
        annualVol: twin.annual_vol,
        formulaHorizonSessions: twin.formula_horizon_sessions,
        tradingDaysPerYear: tdpy,
      })
      expect(rel(twin.z_score, dev.z)).toBeLessThan(1e-10)
      expect(rel(twin.match_pct, dev.deviationPercentile)).toBeLessThan(1e-10)
      expect(twin.signals_enabled).toBe(true)
    })

    it('LP 显示区间仍以同一成本锚为参考', () => {
      const lower = jsRef.costAnchor * Math.max(1 - PINE_DEFAULTS.lp_range_width, 0.001)
      const upper = jsRef.costAnchor * (1 + PINE_DEFAULTS.lp_range_width * PINE_DEFAULTS.lp_skew)
      expect(rel(pine.lp_lower, lower)).toBeLessThan(1e-10)
      expect(rel(pine.lp_upper, upper)).toBeLessThan(1e-10)
    })
  })
}

describe('周期参数语义隔离', () => {
  it('canonical DEFAULTS 没有人工 holding/cost/recent/vol 周期', () => {
    for (const forbidden of ['holding_days', 'cost_len', 'recent_len', 'vol_len', 'target_return_pct']) {
      expect(PINE_DEFAULTS).not.toHaveProperty(forbidden)
    }
    expect(PINE_DEFAULTS).not.toHaveProperty('trading_days')
    expect(PINE_DEFAULTS).toHaveProperty('trading_sessions_per_year')
    expect(PINE_DEFAULTS).toHaveProperty('delta_slope')
  })

  it('旧 holding_days 输入不能悄悄改写 canonical 结果', () => {
    const rows = loadCsv('public/data/AAPL-1d.csv')
    const a = pineEquivalent(rows, { trading_sessions_per_year: 252 })
    const b = pineEquivalent(rows, { trading_sessions_per_year: 252, holding_days: 30 })
    expect(b).toEqual(a)
  })
})
