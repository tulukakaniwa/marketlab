import { describe, expect, it } from 'vitest'
import { summarizeRegime, summarizeRegression, summarizeReason } from '../decision/narrative.js'

describe('summarizeRegime', () => {
  it('深度折价：低于 5%', () => {
    const out = summarizeRegime({ markPrice: 90, costAnchor: 100, costDistance: -0.10, costWindow: 60 })
    expect(out).toContain('深度折价')
    expect(out).toContain('10.0%')
    expect(out).toContain('近 60 日均价')
  })

  it('小幅折价：1%~5%', () => {
    const out = summarizeRegime({ markPrice: 97, costAnchor: 100, costDistance: -0.03, costWindow: 60 })
    expect(out).toContain('小幅折价')
    expect(out).toContain('3.0%')
  })

  it('贴近均价：abs ≤ 1%', () => {
    const out = summarizeRegime({ markPrice: 100.5, costAnchor: 100, costDistance: 0.005, costWindow: 60 })
    expect(out).toContain('贴近均价')
  })

  it('溢价：高于 5%', () => {
    const out = summarizeRegime({ markPrice: 110, costAnchor: 100, costDistance: 0.10, costWindow: 60 })
    expect(out).toContain('溢价')
    expect(out).toContain('10.0%')
  })

  it('回归区：1%~5%', () => {
    const out = summarizeRegime({ markPrice: 103, costAnchor: 100, costDistance: 0.03, costWindow: 60 })
    expect(out).toContain('回归')
  })

  it('null 容错', () => {
    expect(summarizeRegime(null)).toBe('载入 K 线后判断')
    expect(summarizeRegime({})).toBe('载入 K 线后判断')
  })
})

describe('summarizeRegression', () => {
  it('正常输出概率短句', () => {
    const out = summarizeRegression({ regressionProb: 0.65, regime: '折价' })
    expect(out).toContain('65%')
    expect(out).toContain('回归')
  })

  it('null/无概率：返回 null', () => {
    expect(summarizeRegression(null)).toBeNull()
    expect(summarizeRegression({ regressionProb: null })).toBeNull()
  })
})

describe('summarizeReason', () => {
  it('折价 + side=buy → "再等更便宜或开始买"风格', () => {
    const out = summarizeReason({ state: '折价买入', costDistance: -0.03, atrPercent: 0.02, side: 'buy' })
    expect(typeof out).toBe('string')
    expect(out.length).toBeGreaterThan(4)
  })

  it('溢价 + side=sell → "仅减仓"风格', () => {
    const out = summarizeReason({ state: '溢价减仓', costDistance: 0.06, atrPercent: 0.02, side: 'sell' })
    expect(out).toContain('仓')
  })

  it('null 输入兜底', () => {
    expect(summarizeReason(null)).toBe('等待 K 线给出明确折价')
    expect(summarizeReason({})).toBe('等待 K 线给出明确折价')
  })
})
