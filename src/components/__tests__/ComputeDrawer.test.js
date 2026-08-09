import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ComputeDrawer from '../ComputeDrawer.vue'

describe('ComputeDrawer GetDelta metric', () => {
  it('悬停会话没有 Delta 带时显示该会话原因，不回退当前带', () => {
    const wrapper = mountDrawer({
      isHovering: true,
      hoverFormulaRow: {
        fieldStates: {
          deltaUpper: {
            status: 'not-applicable',
            missingInputs: [],
            blockedReasons: ['cycle-start-at-or-beyond-anchor'],
          },
        },
      },
    })

    const metric = getDeltaMetric(wrapper)
    expect(metric.text()).toContain('当前结构不适用')
    expect(metric.text()).toContain('没有前向修复区间')
    expect(metric.text()).not.toContain('80 — 120')
  })

  it('悬停会话有 Delta 带时只展示该会话数值', () => {
    const wrapper = mountDrawer({
      isHovering: true,
      hoverFormulaRow: { deltaLower: 70, deltaCost: 80, deltaUpper: 90 },
    })

    const metric = getDeltaMetric(wrapper)
    expect(metric.text()).toContain('70 — 90')
    expect(metric.text()).not.toContain('80 — 120')
  })

  it('非悬停时使用当前公式行状态，不把不适用误写成待输入', () => {
    const wrapper = mountDrawer({
      graph: {
        inputs: { entryPrice: 100, formulaHorizonSessions: null, iv: 0.3, tradingDaysPerYear: 242 },
        deltaBands: { long: { low: 80, cost: 100, high: 120 } },
        decision: { missingInputs: [] },
      },
      formulaPath: [
        {
          fieldStates: {
            deltaUpper: {
              status: 'not-applicable',
              missingInputs: [],
              blockedReasons: ['cycle-start-at-or-beyond-anchor'],
            },
          },
        },
      ],
    })

    const metric = getDeltaMetric(wrapper)
    expect(metric.text()).toContain('当前结构不适用')
    expect(metric.text()).toContain('没有前向修复区间')
    expect(metric.text()).not.toContain('待输入')
  })
})

function mountDrawer(overrides = {}) {
  return mount(ComputeDrawer, {
    props: {
      graph: {
        inputs: { entryPrice: 100, formulaHorizonSessions: 8, iv: 0.3, tradingDaysPerYear: 242 },
        deltaBands: { long: { low: 80, cost: 100, high: 120 } },
        decision: { missingInputs: [] },
      },
      market: {
        rows: 2,
        markPrice: 100,
        costAnchor: 98,
        costDistance: 0.02,
        costLow: 90,
        costHigh: 110,
        annualVol: 0.3,
        atrPercent: 0.02,
      },
      rows: [
        { date: '2026-01-01', close: 99 },
        { date: '2026-01-02', close: 100 },
      ],
      costPath: [
        { date: '2026-01-01', anchor: 98 },
        { date: '2026-01-02', anchor: 98 },
      ],
      formulaPath: [],
      sourceLabel: '测试',
      activeFormulaId: 'delta-band',
      activeFormula: { label: 'GetDelta 成本带' },
      ...overrides,
    },
    global: {
      stubs: {
        WorkbenchSummary: true,
        ChainFlow: true,
        FormulaChart: true,
        FormulaDrawerContent: true,
        FormulaNav: true,
      },
    },
  })
}

function getDeltaMetric(wrapper) {
  return wrapper.findAll('.metric-strip article').find((item) => item.text().includes('GetDelta 区间'))
}
