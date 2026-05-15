import { describe, expect, it } from 'vitest'
import { buildMarketStatePath } from '../market/cost.js'
import { buildDailyReplay } from '../replay/dailyReplay.js'
import { strategyProfileList } from '../planning/orderPlan.js'

function makeRows(n, gen) {
  return Array.from({ length: n }, (_, i) => {
    const close = gen(i)
    return {
      date: `2024-${String(Math.floor(i / 30) + 1).padStart(2, '0')}-${String((i % 30) + 1).padStart(2, '0')}`,
      timestamp: i,
      open: close,
      high: close + 1,
      low: close - 1,
      close,
      volume: 1000,
    }
  })
}

describe('buildDailyReplay', () => {
  const rows = makeRows(200, i => 100 + Math.sin(i / 8) * 10)
  const baseInput = {
    holdingDays: 30,
    targetReturn: 0.3,
    capital: 10000,
    strategyProfile: 'balanced',
    rangeWidth: 0.1,
    skew: 1,
    liquidity: 1,
    replayFeeRate: 0.001,
    optionType: 'put',
    riskFreeRate: 0.04,
    iv: 0.4,
  }

  it('rows 不够长时返回空回放', () => {
    const empty = buildDailyReplay(makeRows(20, i => 100), baseInput)
    expect(empty.tradeCount).toBe(0)
    expect(empty.equityCurve).toEqual([])
  })

  it('正常输出权益曲线 + 数值有限', () => {
    const r = buildDailyReplay(rows, baseInput)
    expect(Number.isFinite(r.totalPnl)).toBe(true)
    expect(Number.isFinite(r.maxDrawdown)).toBe(true)
    expect(Number.isFinite(r.winRate)).toBe(true)
  })

  it('A4/A5 回归：tdpy 透传 + 接受外部 marketStates 不抛错', () => {
    // 行为契约：buildDailyReplay 必须接受第三个参数 marketStates，
    // 并能在传入与不传入时都返回结构合法的回放
    const tdpy = 252
    const states = buildMarketStatePath(rows, tdpy)
    const r1 = buildDailyReplay(rows, { ...baseInput, tradingDaysPerYear: tdpy }, states)
    const r2 = buildDailyReplay(rows, { ...baseInput, tradingDaysPerYear: tdpy })
    // 字段齐全
    for (const r of [r1, r2]) {
      expect(Number.isFinite(r.totalPnl)).toBe(true)
      expect(Number.isFinite(r.maxDrawdown)).toBe(true)
      expect(Number.isFinite(r.winRate)).toBe(true)
      expect(Array.isArray(r.equityCurve)).toBe(true)
      expect(Array.isArray(r.trades)).toBe(true)
    }
    // 长度等于错位 marketStates 时应回退到内部计算（A5 规约）
    const wrongLen = states.slice(0, 5)
    const r3 = buildDailyReplay(rows, baseInput, wrongLen)
    expect(Number.isFinite(r3.totalPnl)).toBe(true)
  })

  it('三档 profile 都能跑通且 ledger 平账', () => {
    for (const profile of strategyProfileList) {
      const r = buildDailyReplay(rows, { ...baseInput, strategyProfile: profile.id })
      expect(r.profileId).toBe(profile.id)
      expect(Number.isFinite(r.returnOnUsedNotional)).toBe(true)
      // ledger 平账：每笔卖出不应卖超持仓
      let base = 0
      for (const t of r.trades) {
        if (t.side === 'buy') base += t.baseAmount
        else expect(t.baseAmount).toBeLessThanOrEqual(base + 1e-9)
        if (t.side === 'sell') base -= t.baseAmount
      }
    }
  })
})
