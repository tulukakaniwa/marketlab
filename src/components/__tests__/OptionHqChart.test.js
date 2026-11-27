import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import OptionHqChart from '../OptionHqChart.vue'

vi.mock('../../infrastructure/charting/hqOptionChartAdapter.js', () => ({
  createHqOptionChartAdapter: vi.fn(async () => ({
    resize: vi.fn(),
    destroy: vi.fn(),
  })),
}))

const rows = [
  { date: '2026-10-01', open: 99, high: 101, low: 98, close: 100, volume: 500 },
  { date: '2026-10-02', open: 100, high: 103, low: 99, close: 102, volume: 600 },
]

describe('OptionHqChart', () => {
  it('shows missing-input guidance without mounting HQChart when option tenor is unset', () => {
    const wrapper = mount(OptionHqChart, {
      props: {
        rows,
        sourceLabel: 'ETHUSDT',
        graph: { researchInputs: { strikePrice: 100, optionTenorSessions: null, iv: 0.4, tradingDaysPerYear: 365 } },
      },
    })
    expect(wrapper.text()).toContain('HQ 期权终端')
    expect(wrapper.text()).toContain('待补充期权参数')
    expect(wrapper.find('.ohq-canvas').exists()).toBe(false)
  })

  it('mounts HQ option stage when Greeks inputs are complete', async () => {
    const wrapper = mount(OptionHqChart, {
      props: {
        rows,
        sourceLabel: 'ETHUSDT',
        graph: { researchInputs: { strikePrice: 100, optionTenorSessions: 15, iv: 0.4, tradingDaysPerYear: 365 } },
      },
    })
    expect(wrapper.find('.ohq-canvas').exists()).toBe(true)
    wrapper.unmount()
  })
})
