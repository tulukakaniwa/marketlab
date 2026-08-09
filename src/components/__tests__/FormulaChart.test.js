import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import FormulaChart from '../FormulaChart.vue'

describe('FormulaChart', () => {
  it('LP 研究拆解将 CE 几何与同期限收益分列', () => {
    const wrapper = mount(FormulaChart, {
      props: makeProps('net-lp-efficiency'),
    })

    expect(wrapper.text()).toContain('LP 研究拆解')
    expect(wrapper.text()).toContain('CE 几何')
    expect(wrapper.text()).toContain('可与收益相加否')
    expect(wrapper.text()).toContain('fee≈theta')
  })

  it('资本效率展示 CK 精确 ±84.13% 拐点并声明几何中点评估边界', () => {
    const wrapper = mount(FormulaChart, {
      props: makeProps('capital-efficiency', {
        graph: { ...makeGraph(), researchInputs: { rangeWidth: 0.08, skew: 1, liquidity: 1 } },
      }),
    })
    expect(wrapper.text()).toContain('CK 端点比资本效率')
    expect(wrapper.text()).toContain('±84.13%')
    expect(wrapper.text()).toContain('几何中点')
    expect(wrapper.text()).toContain('非当前价执行最优')
  })

  it('偏离图只展示极端度和双尾质量，不展示回归概率', () => {
    const wrapper = mount(FormulaChart, { props: makeProps('deviation-score') })
    expect(wrapper.text()).toContain('偏离百分位')
    expect(wrapper.text()).toContain('双尾')
    expect(wrapper.text()).toContain('不是未来回归概率')
    expect(wrapper.text()).not.toMatch(/回归概率\s*\d/)
  })

  it('动态持仓状态接入二阶公式输出，展示计划和里程碑', () => {
    const wrapper = mount(FormulaChart, {
      props: makeProps('dynamic-holding-state'),
    })

    expect(wrapper.text()).toContain('动态持仓状态')
    expect(wrapper.text()).toContain('短线')
    expect(wrapper.text()).toContain('基金周期')
    expect(wrapper.text()).toContain('成本下沿')
    expect(wrapper.text()).toContain('交易会话')
  })

  it('LP 池覆盖展示聚合池快照指标', () => {
    const wrapper = mount(FormulaChart, {
      props: makeProps('lp-pool-coverage'),
    })

    expect(wrapper.text()).toContain('LP 池覆盖')
    expect(wrapper.text()).toContain('24h 换手')
    expect(wrapper.text()).toContain('主池占比')
  })

  it('公式图按 active costPath 限制 rows，避免历史光标读取未来样本', () => {
    const rows = makeRows(80)
    const costPath = makeCostPath(rows).slice(0, 40)
    const wrapper = mount(FormulaChart, {
      props: makeProps('path', { rows, costPath, market: { ...makeMarket(), rows: 40 } }),
    })

    expect(wrapper.find('.fc-kv div:first-child span').text()).toBe('40')
  })

  it('期权 Greeks 使用明确字段并按交易会话展示 Theta', () => {
    const graph = {
      ...makeGraph(),
      option: {
        price: 4,
        optionDelta: 0.45,
        optionGamma: 0.02,
        optionThetaPerSession: -0.03,
        optionThetaAnnual: -7.26,
        optionVegaPerPct: 0.12,
        optionRhoPerPct: 0.05,
        d1: 0.2,
        d2: 0.1,
      },
    }
    const wrapper = mount(FormulaChart, { props: makeProps('option-greeks', { graph }) })

    expect(wrapper.text()).toContain('Θ/交易会话')
    expect(wrapper.text()).not.toContain('Θ/日')
    expect(wrapper.text()).toContain('-0.0300')
  })

  it('net carry 保留 funding 收付方向，不用绝对值伪装成成本', () => {
    const graph = {
      ...makeGraph(),
      netCarry: {
        grossRecoveryReturn: 0.25,
        fundingCashflowReturn: 0.02,
        fundingNetCostReturn: -0.02,
        netReturn: 0.27,
        breakEvenFundingNetCostReturn: 0.25,
      },
    }
    const wrapper = mount(FormulaChart, { props: makeProps('net-carry', { graph }) })

    expect(wrapper.text()).toContain('Funding 现金流')
    expect(wrapper.text()).toContain('2.00%')
    expect(wrapper.text()).toContain('净 carry')
    expect(wrapper.text()).not.toContain('Funding 净成本 -2.00%')
  })
})

function makeProps(formulaId, overrides = {}) {
  const rows = overrides.rows ?? makeRows(90)
  return {
    formulaId,
    graph: makeGraph(),
    market: makeMarket(),
    rows,
    costPath: overrides.costPath ?? makeCostPath(rows),
    formulaPath: overrides.formulaPath ?? makeFormulaPath(rows),
    ...overrides,
  }
}

function makeRows(count) {
  return Array.from({ length: count }, (_, i) => {
    const close = i < 20 ? 120 : i < 55 ? 120 - (i - 20) * 0.9 : 88.5 + (i - 55) * 0.2
    return {
      date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
      open: close - 0.3,
      high: close + 1,
      low: close - 1,
      close,
      volume: 1000 + i,
    }
  })
}

function makeCostPath(rows) {
  return rows.map((row) => ({
    date: row.date,
    anchor: 100,
    lower: 94,
    upper: 106,
  }))
}

function makeFormulaPath(rows) {
  return rows.map((row) => ({
    date: row.date,
    lpPoolTurnover24h: 0.24,
    lpPoolTopReserveShare: 0.68,
    fieldStates: {
      lpPoolTurnover24h: {
        inputMode: 'pool-real',
        isSynthetic: true,
        missingInputs: ['tick-liquidity-history', 'lp-add-remove-events'],
        context: {
          poolCoverage: { reserveUsd: 1000000, volumeUsd24h: 240000, topPoolReserveShare: 0.68 },
        },
      },
    },
  }))
}

function makeMarket() {
  return {
    rows: 90,
    range: '2026-01-01 → 2026-03-31',
    markPrice: 90,
    costAnchor: 100,
    costRecent: 96,
    costLow: 94,
    costHigh: 106,
    costDistance: -0.25,
    costSlopeRecent: 0,
    annualVol: 0.35,
    atrPercent: 0.025,
    momentumFast: 0.01,
    momentumSlow: -0.02,
  }
}

function makeGraph() {
  return {
    inputs: { entryPrice: 90, formulaHorizonSessions: 30, iv: 0.35, tradingDaysPerYear: 365 },
    researchInputs: { rangeWidth: 0.08, skew: 1.8, liquidity: 1 },
    efficiency: { efficiency: 19.5, lower: 0.92, upper: 1.14 },
    impermanentLoss: { impermanentLoss: -0.015 },
    lpV3Hedged: { upperPrice: 103, lowerPrice: 82.8 },
    deltaBands: { long: { low: 78, cost: 90, high: 108 }, short: { low: 72, cost: 90, high: 112 } },
    option: { optionGamma: 0.0015 },
  }
}
