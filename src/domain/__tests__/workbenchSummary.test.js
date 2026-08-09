import { describe, expect, it } from 'vitest'
import { buildWorkbenchSummary } from '../workbench/workbenchSummary.js'

function rows(count = 2) {
  return Array.from({ length: count }, (_, index) => ({
    date: `2026-08-${String(index + 1).padStart(2, '0')}`,
    close: 10 + index,
  }))
}

describe('buildWorkbenchSummary data state', () => {
  it('无 K 线时明确标记不可用和 missing-input', () => {
    expect(buildWorkbenchSummary({})).toEqual({
      data: {
        state: 'invalid',
        label: '不可用',
        detail: '尚未载入 K 线。',
        dataThrough: '',
        rows: 0,
        source: '本地数据源未标注',
        claimClass: 'missing-input',
      },
      gate: {
        state: '等待载入',
        executionStatus: 'blocked',
        label: '不可执行',
      },
      reason: '等待市场样本形成明确条件。',
      invalidation: '缺失输入：尚未形成可复核的失效条件。',
      nextCheck: '下一根 K 线后复核成本锚、阶段和失效条件。',
      disclosure: '本地日线样本只用于研究；偏离度不是胜率，手绘标注不进入公式或模拟挂单。',
    })
  })

  it('有样本时保持 provisional，展示来源、周期、截止日和样本声明', () => {
    const summary = buildWorkbenchSummary({
      source: { source: 'BaoStock', interval: '1d' },
      rows: rows(3),
    })
    expect(summary.data).toEqual({
      state: 'provisional',
      label: '可研究',
      detail: '3 根 1d K 线 · 截至 2026-08-03',
      dataThrough: '2026-08-03',
      rows: 3,
      source: 'BaoStock',
      claimClass: 'sample-estimate',
    })
  })

  it('陈旧来源优先显示需刷新，缺字段时保留显式占位', () => {
    const summary = buildWorkbenchSummary({
      source: { isStale: true },
      rows: [{ close: 10 }],
    })
    expect(summary.data.state).toBe('stale')
    expect(summary.data.label).toBe('需刷新')
    expect(summary.data.detail).toBe('1 根 周期未标注 K 线 · 截至 截止日未知')
    expect(summary.data.source).toBe('本地数据源未标注')
  })

  it('K 线缺日期时回退 source.dataThrough', () => {
    const summary = buildWorkbenchSummary({
      source: { source: 'local-csv', dataThrough: '2026-08-07', interval: 'day' },
      rows: [{ close: 10 }],
    })
    expect(summary.data.dataThrough).toBe('2026-08-07')
    expect(summary.data.detail).toContain('截至 2026-08-07')
  })
})

describe('buildWorkbenchSummary decision gate', () => {
  it('保留决策门禁、模拟状态、首个阻断原因和失效条件', () => {
    const summary = buildWorkbenchSummary({
      source: { source: 'local-csv', interval: '日线' },
      rows: rows(),
      graph: {
        decision: {
          state: '等待',
          executionStatus: 'simulation-only',
          blockedReasons: ['成本仍在下移', '动量尚未修复'],
          timing: { reason: '次级原因' },
          invalidations: ['收盘跌破结构低点'],
        },
      },
    })
    expect(summary.gate).toEqual({ state: '等待', executionStatus: 'simulation-only', label: '仅模拟' })
    expect(summary.reason).toBe('成本仍在下移')
    expect(summary.invalidation).toBe('收盘跌破结构低点')
    expect(summary.nextCheck).toBe('下一根 K 线后复核：成本仍在下移。')
  })

  it('没有阻断原因时使用 timing.reason，并维持 blocked 执行状态', () => {
    const summary = buildWorkbenchSummary({
      rows: rows(),
      graph: { decision: { state: '观察', timing: { reason: '成本修复已开始' } } },
    })
    expect(summary.gate).toEqual({ state: '观察', executionStatus: 'blocked', label: '不可执行' })
    expect(summary.reason).toBe('成本修复已开始')
    expect(summary.nextCheck).toBe('下一根 K 线后复核成本锚、阶段和失效条件。')
  })

  it.each([
    ['account.capital', '账户资金'],
    ['account.basePosition', '底仓名义'],
    ['verified-market-iv-source', '可验证的市场波动率来源'],
    ['option-leg-premium', '期权腿报价'],
  ])('缺少 %s 时把机器字段翻译为 %s', (missingInput, label) => {
    const summary = buildWorkbenchSummary({
      rows: rows(),
      graph: {
        decision: {
          state: '等待',
          missingInputs: [missingInput],
          blockedReasons: ['研究门禁未满足'],
        },
      },
    })
    expect(summary.reason).toBe('研究门禁未满足')
    expect(summary.nextCheck).toBe(`如需运行模拟，先补充${label}。`)
  })

  it('未知 missing input 使用可读分隔符且优先于 blockedReason 的下一步', () => {
    const summary = buildWorkbenchSummary({
      rows: rows(),
      graph: {
        decision: {
          missingInputs: ['account.risk.limit'],
          blockedReasons: ['价格条件未满足'],
        },
      },
    })
    expect(summary.reason).toBe('价格条件未满足')
    expect(summary.nextCheck).toBe('如需运行模拟，先补充account / risk / limit。')
  })

  it('空 invalidations 回退为明确缺失输入，而不是伪造失效线', () => {
    const summary = buildWorkbenchSummary({
      rows: rows(),
      graph: { decision: { state: '观察', invalidations: [] } },
    })
    expect(summary.invalidation).toBe('缺失输入：尚未形成可复核的失效条件。')
    expect(summary.disclosure).toContain('偏离度不是胜率')
    expect(summary.disclosure).toContain('手绘标注不进入公式或模拟挂单')
  })
})
