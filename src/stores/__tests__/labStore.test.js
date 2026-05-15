import { setActivePinia, createPinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useLabStore } from '../labStore.js'

describe('useLabStore（D2 拆分后契约）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('对外 API 字段齐全', () => {
    const lab = useLabStore()
    // 数据层
    expect(lab.rows).toBeDefined()
    expect(lab.cursor).toBeDefined()
    expect(typeof lab.loadSample).toBe('function')
    expect(typeof lab.importText).toBe('function')
    // 市场态
    expect(lab.market).toBeDefined()
    expect(lab.costPath).toBeDefined()
    expect(lab.formulaPath).toBeDefined()
    // 决策
    expect(lab.input).toBeDefined()
    expect(lab.graph).toBeDefined()
    expect(lab.effectiveInput).toBeDefined()
    // UI
    expect(lab.activeMode).toBeDefined()
    expect(typeof lab.selectCapability).toBe('function')
  })

  it('初始 input 默认值正确', () => {
    const lab = useLabStore()
    expect(lab.input.holdingDays).toBe(30)
    expect(lab.input.targetReturn).toBe(0.3)
    expect(lab.input.capital).toBe(0)
    expect(lab.input.tradingDaysPerYear).toBe(365)
  })

  it('默认计划 profile 只来自手动选择', () => {
    const lab = useLabStore()
    lab.input.strategyProfile = 'conservative'
    expect(lab.effectiveInput.strategyProfile).toBe('conservative')
  })

  it('importText 解析 CSV 并触发输入回填', async () => {
    const lab = useLabStore()
    // 至少需要 2 行才能算出 marketState
    const csv = ['date,open,high,low,close,volume',
      ...Array.from({ length: 60 }, (_, i) => {
        const close = 100 + i * 0.5
        return `2024-01-${String(i + 1).padStart(2, '0')},${close},${close + 1},${close - 1},${close},1000`
      })].join('\n')
    lab.importText(csv, '测试集')
    // 等待响应式更新（Pinia store 内部 watch 同步执行）
    await new Promise(r => setTimeout(r, 50))
    expect(lab.rows.length).toBeGreaterThan(0)
    expect(lab.input.entryPrice).toBeGreaterThan(0)
    expect(lab.input.iv).toBeGreaterThanOrEqual(0)
  })

  it('selectCapability 切换 active 公式', () => {
    const lab = useLabStore()
    lab.selectCapability('liquidity-amm')
    expect(lab.activeCapabilityId).toBe('liquidity-amm')
    expect(lab.activeFormulaId).toBeTruthy()
  })

  it('A3 回归：tdpy 切换不污染缓存', () => {
    const lab = useLabStore()
    const csv = ['date,open,high,low,close,volume',
      ...Array.from({ length: 80 }, (_, i) => {
        const close = 100 + Math.sin(i / 5) * 3
        return `2024-01-${String((i % 28) + 1).padStart(2, '0')},${close},${close + 0.5},${close - 0.5},${close},1000`
      })].join('\n')
    lab.importText(csv, '测试集')
    const v1 = lab.market.annualVol
    lab.input.tradingDaysPerYear = 252
    const v2 = lab.market.annualVol
    expect(v1).not.toBeCloseTo(v2, 4)
  })
})
