import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ChartStrategyBar from '../ChartStrategyBar.vue'
import { parseBinanceKlines } from '../../domain/market-data/ohlcv.js'
import { CHART_STRATEGY_CATALOG, evaluateChartStrategy } from '../../domain/strategy-planning/chartStrategyEngine.js'

describe('ChartStrategyBar', () => {
  it('renders strategy mode selector pills, live telemetry, and emits selection command', async () => {
    const btcCsv = readFileSync(resolve('public/data/btcusdt-1d-2017-2025.csv'), 'utf8')
    const btcRows = parseBinanceKlines(btcCsv).slice(-360)
    const result = evaluateChartStrategy({
      strategyId: 'regime-combo',
      rows: btcRows,
      tradingDaysPerYear: 365,
      feeRate: 0.001,
    })

    const wrapper = mount(ChartStrategyBar, {
      props: {
        strategyId: 'regime-combo',
        catalog: CHART_STRATEGY_CATALOG,
        strategy: result,
        ready: true,
      },
    })

    expect(wrapper.text()).toContain('算法策略')
    expect(wrapper.text()).toContain('结构低吸')
    expect(wrapper.text()).toContain('压缩突破')
    expect(wrapper.text()).toContain('溢价高抛')
    expect(wrapper.text()).toContain('全天候组合')
    expect(wrapper.text()).toContain('累计净值')

    const repairBtn = wrapper.findAll('.csb-mode-btn').find((btn) => btn.text() === '结构低吸')
    await repairBtn.trigger('click')
    expect(wrapper.emitted('select')).toEqual([['structural-repair']])
  })
})
