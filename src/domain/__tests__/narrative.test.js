import { describe, expect, it } from 'vitest'
import { summarizeRegime, summarizeRegression, summarizeReason } from '../decision/narrative.js'

describe('summarizeRegime', () => {
  it('describes deep discount against cost anchor', () => {
    const out = summarizeRegime({ costDistance: -0.1, costWindow: 60 })
    expect(out).toContain('深度折价')
    expect(out).toContain('10.0%')
    expect(out).toContain('近 60 日均价')
  })

  it('describes small discount and fair value regimes', () => {
    expect(summarizeRegime({ costDistance: -0.03, costWindow: 60 })).toContain('小幅折价')
    expect(summarizeRegime({ costDistance: 0.005, costWindow: 60 })).toContain('贴近均价')
  })

  it('describes premium regimes', () => {
    expect(summarizeRegime({ costDistance: 0.1, costWindow: 60 })).toContain('溢价')
    expect(summarizeRegime({ costDistance: 0.03, costWindow: 60 })).toContain('回归')
  })

  it('falls back when payload is incomplete', () => {
    expect(summarizeRegime(null)).toBe('载入 K 线后判断')
    expect(summarizeRegime({})).toBe('载入 K 线后判断')
  })
})

describe('summarizeRegression', () => {
  it('formats a regression probability', () => {
    expect(summarizeRegression({ regressionProb: 0.65 })).toContain('65%')
  })

  it('returns null when probability is missing', () => {
    expect(summarizeRegression(null)).toBeNull()
    expect(summarizeRegression({ regressionProb: null })).toBeNull()
  })
})

describe('summarizeReason', () => {
  it('explains buy and sell decisions', () => {
    expect(summarizeReason({ costDistance: -0.03, side: 'buy' }).length).toBeGreaterThan(4)
    expect(summarizeReason({ costDistance: 0.06, side: 'sell' })).toContain('仓')
  })

  it('falls back for incomplete input', () => {
    expect(summarizeReason(null)).toBe('等待 K 线给出明确折价')
    expect(summarizeReason({})).toBe('等待 K 线给出明确折价')
  })
})
