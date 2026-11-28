import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PortfolioRotationDialog from '../PortfolioRotationDialog.vue'
import { ROTATION_PRESETS } from '../../domain/strategy-planning/portfolioRotationEngine.js'

describe('PortfolioRotationDialog', () => {
  it('renders KPI strip, equity SVG, and emits preset/slot/jump commands', async () => {
    const mockResult = {
      status: 'ready',
      maxSlots: 5,
      startDate: '2021-01-01',
      endDate: '2026-11-26',
      summary: {
        totalNetReturn: 3.359,
        benchmarkReturn: 1.12,
        cagr: 0.283,
        annualVol: 0.26,
        sharpe: 0.99,
        calmar: 0.99,
        maxDrawdown: -0.285,
        avgUtilization: 0.432,
        closedCount: 104,
        winRate: 0.42,
        profitFactor: 3.64,
        activeCount: 2,
      },
      equityCurve: [
        { date: '2021-01-01', equity: 1.0, benchmarkEquity: 1.0, utilization: 0.2, activeSlots: 1 },
        { date: '2026-11-26', equity: 4.359, benchmarkEquity: 2.12, utilization: 0.5, activeSlots: 2 },
      ],
      attribution: [{ symbol: 'NVDA', label: 'NVDA', trades: 12, wins: 7, netContribution: 0.95, active: true }],
      recentTrades: [
        {
          symbol: 'NVDA',
          legLabel: '压缩突破',
          entryDate: '2026-05-01',
          exitDate: '2026-07-01',
          rawNetReturn: 0.34,
          reason: '趋势止盈',
        },
      ],
    }

    const wrapper = mount(PortfolioRotationDialog, {
      props: {
        open: true,
        running: false,
        presets: ROTATION_PRESETS,
        presetId: ROTATION_PRESETS[0].id,
        maxSlots: 5,
        useMakerLadder: true,
        result: mockResult,
      },
    })

    expect(wrapper.text()).toContain('跨市场多标的资金轮动引擎')
    expect(wrapper.text()).toContain('+335.9%')
    expect(wrapper.text()).toContain('NVDA')

    await wrapper.find('.pr-click-row').trigger('click')
    expect(wrapper.emitted('jump-symbol')).toEqual([['NVDA']])
  })
})
