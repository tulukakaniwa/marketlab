import { describe, expect, it, vi } from 'vitest'
import { buildHqOptionChartOption, createHqOptionChartAdapter } from '../hqOptionChartAdapter.js'
import { buildOptionGreeksChartModel } from '../../../domain/formula-research/optionGreeksSeries.js'

const rows = [
  { date: '2026-10-01', open: 99, high: 102, low: 98, close: 100, volume: 1000 },
  { date: '2026-10-02', open: 100, high: 105, low: 99, close: 103, volume: 1200 },
  { date: '2026-10-03', open: 103, high: 106, low: 101, close: 104, volume: 1100 },
]

describe('Option HQChart dedicated adapter', () => {
  it('builds research-only Greeks series from explicit option inputs when formulaPath omits option legs', () => {
    const model = buildOptionGreeksChartModel({
      rows,
      formulaPath: [],
      graph: {
        researchInputs: {
          strikePrice: 105,
          optionTenorSessions: 20,
          iv: 0.35,
          riskFreeRate: 0.04,
          optionType: 'put',
          optionSide: 'long',
          optionQuantity: 1,
          optionMultiplier: 1,
          tradingDaysPerYear: 252,
        },
      },
    })
    expect(model.status).toBe('research-only')
    expect(model.groups[0].series.map((s) => s.id)).toEqual(['bsDelta', 'bsGamma', 'bsTheta'])
    expect(model.groups[0].series[0].points).toHaveLength(3)
  })

  it('configures HQChart in locked option-only mode without right-click menus or main-chart indicators', () => {
    const option = buildHqOptionChartOption({
      source: { symbol: 'ETHUSDT' },
      pageSize: 30,
      researchConfig: { windows: [{ API: { ID: 'market-lab:greeks' } }], frames: [{ Height: 1.5, SplitCount: 3 }] },
      eventIds: { RECV_HISTROY_DATA: 1 },
    })
    expect(option.IsShowRightMenu).toBe(false)
    expect(option.KLine.DrawType).toBe(1)
    expect(option.Windows[0].Index).toBe('EMPTY')
    expect(option.Windows).toHaveLength(2)
  })

  it('initializes and destroys HQChart safely via injected runtime', async () => {
    const el = document.createElement('div')
    Object.defineProperty(el, 'clientWidth', { value: 320 })
    Object.defineProperty(el, 'clientHeight', { value: 240 })
    const onSize = vi.fn()
    const chartInstance = {
      SetOption: (opt) => {
        const readyCb = opt.EventCallback.find((item) => item.event === 7)?.callback
        queueMicrotask(() => readyCb?.())
        return true
      },
      OnSize: onSize,
      ChartDestory: vi.fn(),
    }
    const adapter = await createHqOptionChartAdapter({
      element: el,
      getRows: () => rows,
      getSource: () => ({ symbol: 'NVDA' }),
      getOptionModel: () => ({ dates: rows.map((r) => r.date), groups: [] }),
      loadRuntime: async () => ({
        Chart: {
          JSCHART_EVENT_ID: { RECV_HISTROY_DATA: 7 },
          JSChart: { Init: () => chartInstance },
        },
      }),
    })
    expect(onSize).toHaveBeenCalledWith({ Type: 2 })
    adapter.resize()
    expect(onSize).toHaveBeenCalledTimes(2)
    adapter.destroy()
  })
})
