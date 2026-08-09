import { mount } from '@vue/test-utils'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import MainChart from '../MainChart.vue'

const mocks = vi.hoisted(() => {
  const mainPriceScaleApply = vi.fn()
  const timeScale = {
    fitContent: vi.fn(),
    subscribeVisibleLogicalRangeChange: vi.fn(),
    unsubscribeVisibleLogicalRangeChange: vi.fn(),
    width: vi.fn(() => 600),
    coordinateToTime: vi.fn(() => '2026-01-02'),
  }
  const candle = {
    setData: vi.fn(),
    attachPrimitive: vi.fn(),
    detachPrimitive: vi.fn(),
    coordinateToPrice: vi.fn((y) => 200 - y),
    priceToCoordinate: vi.fn((price) => 200 - price),
    priceScale: vi.fn(() => ({ applyOptions: mainPriceScaleApply })),
  }
  const chart = {
    applyOptions: vi.fn(),
    timeScale: vi.fn(() => timeScale),
    panes: vi.fn(() => [{ getHeight: () => 300 }]),
    subscribeCrosshairMove: vi.fn(),
    unsubscribeCrosshairMove: vi.fn(),
    resize: vi.fn(),
    remove: vi.fn(),
  }
  return {
    timeScale,
    candle,
    chart,
    createChart: vi.fn(() => chart),
    applyOverlays: vi.fn(),
    stockQueue: vi.fn(),
    stockStart: vi.fn(),
    stockStop: vi.fn(),
    stockDispose: vi.fn(),
    crosshairHandler: vi.fn(() => null),
    mainPriceScaleApply,
  }
})

vi.mock('lightweight-charts', () => ({
  ColorType: { Solid: 'solid' },
  PriceScaleMode: { Logarithmic: 1 },
  createChart: mocks.createChart,
}))

vi.mock('../../composables/useMainChartSeries.js', () => ({
  useMainChartSeries: () => ({
    series: { candle: mocks.candle },
    seriesMeta: {},
    applyOverlays: mocks.applyOverlays,
    getPaneLayout: () => ({ main: 0 }),
    getMarkersApi: () => null,
  }),
}))

vi.mock('../../composables/useStockChipViewport.js', () => ({
  useStockChipViewport: () => ({
    viewport: { value: null },
    queue: mocks.stockQueue,
    startMonitor: mocks.stockStart,
    stopMonitor: mocks.stockStop,
    dispose: mocks.stockDispose,
  }),
}))

vi.mock('../../composables/useMainChartLegend.js', () => ({
  useMainChartLegend: () => ({
    hoverLegend: { value: null },
    handleCrosshair: mocks.crosshairHandler,
  }),
}))

vi.mock('../../composables/useBreakpoint.js', () => ({
  useBreakpoint: () => ({ isMobile: { value: false } }),
}))

class FakeObserver {
  observe = vi.fn()
  disconnect = vi.fn()
}

const previousResizeObserver = globalThis.ResizeObserver
const previousMutationObserver = globalThis.MutationObserver
globalThis.ResizeObserver = FakeObserver
globalThis.MutationObserver = FakeObserver

afterAll(() => {
  globalThis.ResizeObserver = previousResizeObserver
  globalThis.MutationObserver = previousMutationObserver
})

beforeEach(() => {
  for (const value of Object.values(mocks)) {
    if (typeof value?.mockClear === 'function') value.mockClear()
  }
})

describe('MainChart', () => {
  it('只在数据集合或 scope 改变时 fitContent，并在卸载时解绑图表资源', async () => {
    const rows = makeRows()
    const wrapper = mount(MainChart, {
      props: makeProps(rows),
      global: {
        stubs: {
          ChartDrawingToolbar: true,
          ChartDisplayTools: true,
          ChartStatusBar: true,
          MainChartHoverLegend: true,
          StockChipProfileOverlay: true,
          WorkbenchSummary: true,
        },
      },
    })

    expect(mocks.timeScale.fitContent).toHaveBeenCalledTimes(1)
    expect(mocks.candle.attachPrimitive).toHaveBeenCalledTimes(1)
    expect(mocks.chart.subscribeCrosshairMove).toHaveBeenCalledTimes(1)
    expect(mocks.mainPriceScaleApply).toHaveBeenCalledWith({ mode: 1 })

    await wrapper.setProps({ entryPrice: 101, decision: { state: 'watch' } })
    expect(mocks.timeScale.fitContent).toHaveBeenCalledTimes(1)

    await wrapper.setProps({ overlays: { stockChipProfile: false, volume: false } })
    expect(mocks.timeScale.fitContent).toHaveBeenCalledTimes(1)

    await wrapper.setProps({ drawingScope: 'scope-b' })
    expect(mocks.timeScale.fitContent).toHaveBeenCalledTimes(2)

    await wrapper.setProps({ rows: rows.map((row) => ({ ...row })) })
    expect(mocks.timeScale.fitContent).toHaveBeenCalledTimes(3)

    wrapper.unmount()
    expect(mocks.candle.detachPrimitive).toHaveBeenCalledTimes(1)
    expect(mocks.timeScale.unsubscribeVisibleLogicalRangeChange).toHaveBeenCalledTimes(1)
    expect(mocks.chart.unsubscribeCrosshairMove).toHaveBeenCalledTimes(1)
    expect(mocks.chart.remove).toHaveBeenCalledTimes(1)
  })
})

function makeProps(rows) {
  return {
    rows,
    costPath: [],
    formulaPath: [],
    entryPrice: 100,
    replay: { equityCurve: [] },
    drawingScope: 'scope-a',
    overlays: { stockChipProfile: false },
    input: {},
  }
}

function makeRows() {
  return [
    { date: '2026-01-01', open: 99, high: 102, low: 98, close: 101, volume: 1000 },
    { date: '2026-01-02', open: 101, high: 104, low: 100, close: 103, volume: 1200 },
  ]
}
