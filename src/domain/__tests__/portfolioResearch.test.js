import { describe, expect, it } from 'vitest'
import { buildPortfolioResearch } from '../formula-research/portfolioResearch.js'

describe('portfolio research ledger', () => {
  it('mark、入场现金流和 PnL 分列，缺校准输入时不输出正式 total', () => {
    const result = buildPortfolioResearch({
      lpMark: 120,
      lpEntryValue: 100,
      lpPnl: 20,
      optionPortfolio: {
        value: 8,
        entryCost: 5,
        pnl: 3,
        missingInputs: [],
      },
      hedgePnl: -4,
      feePnl: 2,
      fundingPnl: -1,
      feeModelCalibrated: false,
      fundingSettlementKnown: false,
    })
    expect(result.mark.option).toBe(8)
    expect(result.entryCashflow.option).toBe(5)
    expect(result.pnl.option).toBe(3)
    expect(result.pnl.scenarioTotal).toBe(20)
    expect(result.pnl.total).toBeNull()
    expect(result.missingInputs).toEqual(['path-fee-model', 'funding-settlement'])
  })

  it('缺失权利金保持缺失，不能被当作零成本', () => {
    const result = buildPortfolioResearch({
      lpMark: 100,
      lpEntryValue: 100,
      lpPnl: 0,
      optionPortfolio: {
        value: 4,
        entryCost: 4,
        pnl: 0,
        missingInputs: ['option-leg-premium'],
      },
      hedgePnl: 0,
      feePnl: 0,
      fundingPnl: 0,
    })
    expect(result.entryCashflow.option).toBeNull()
    expect(result.missingInputs).toContain('option-leg-premium')
  })

  it('完整上卷期权组合的缺失输入，而不是只识别权利金', () => {
    const result = buildPortfolioResearch({
      lpMark: 100,
      lpEntryValue: 100,
      lpPnl: 0,
      optionPortfolio: {
        value: 4,
        entryCost: 1,
        pnl: 3,
        missingInputs: ['verified-market-iv-source'],
      },
      hedgePnl: 0,
      feePnl: 0,
      fundingPnl: 0,
      feeModelCalibrated: true,
      fundingSettlementKnown: true,
    })
    expect(result.missingInputs).toContain('verified-market-iv-source')
    expect(result.pnl.missingInputs).toEqual(result.missingInputs)
    expect(result.pnl.total).toBeNull()
    expect(result.status).toBe('calibration-required')
  })
})
