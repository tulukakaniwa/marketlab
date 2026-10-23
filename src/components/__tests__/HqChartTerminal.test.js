import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import HqChartTerminal from '../HqChartTerminal.vue'
import PriceReferenceCanvas from '../PriceReferenceCanvas.vue'
import PriceReferenceLegend from '../PriceReferenceLegend.vue'
import { paintPriceReferenceMap } from '../../infrastructure/charting/priceReferencePainter.js'

const mocks = vi.hoisted(() => ({ options: null, adapter: null }))
vi.mock('../../infrastructure/charting/hqChartAdapter.js', () => ({
  createHqChartAdapter: async (options) => {
    mocks.options = options
    return mocks.adapter
  },
}))
vi.mock('../../infrastructure/charting/priceReferencePainter.js', () => ({ paintPriceReferenceMap: vi.fn() }))
vi.mock('../../composables/useBreakpoint.js', () => ({ useBreakpoint: () => ({ isMobile: { value: false } }) }))

const rows = [
  { date: '2026-10-08', open: 99, high: 102, low: 98, close: 101, volume: 1000 },
  { date: '2026-10-09', open: 101, high: 104, low: 100, close: 103, volume: 1200 },
]
const costPath = rows.map((row) => ({ date: row.date, anchor: 100, lower: 95, upper: 105 }))
const snapshot = {
  sourceKey: 'scope-a',
  asOfDate: rows[1].date,
  path: rows.map((row, index) => ({
    date: row.date,
    status: 'ready',
    sampleSize: 8 + index,
    nodes: [{ price: 90 + index, share: 0.25, intensity: 1, side: 'below', isPoc: true }],
  })),
}
const query = { status: 'ready', sourceKey: 'scope-a', asOfDate: rows[1].date }
const viewport = {
  signature: 'reference-viewport-a',
  width: 800,
  height: 400,
  pixelRatio: 2,
  bounds: { left: 40, top: 20, width: 700, height: 300 },
  hasDate: (date) => rows.some((row) => row.date === date),
  projectX: (date) => (date === rows[0].date ? 100 : 200),
  projectY: (price) => 300 - price,
  barSpacing: 10,
}
const wrappers = []
let frames, nextFrame, observer, context

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  frames = new Map()
  nextFrame = 0
  observer = { observe: vi.fn(), disconnect: vi.fn() }
  context = { setTransform: vi.fn() }
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor() {
        return observer
      }
    },
  )
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback) => {
      const id = ++nextFrame
      frames.set(id, callback)
      return id
    }),
  )
  vi.stubGlobal(
    'cancelAnimationFrame',
    vi.fn((id) => frames.delete(id)),
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context)
  mocks.adapter = {
    destroy: vi.fn(),
    resize: vi.fn(),
    getStockChipViewport: vi.fn(() => ({ signature: 'chip-a', top: 20, height: 300 })),
    getPriceReferenceViewport: vi.fn(() => viewport),
  }
})
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function mountTerminal(overrides = {}) {
  const wrapper = mount(HqChartTerminal, {
    props: {
      rows,
      costPath,
      formulaPath: [],
      entryPrice: 100,
      replay: { equityCurve: [] },
      drawingScope: 'scope-a',
      overlays: { stockChipProfile: false, priceReferenceMap: true, priceBands: true, costBand: true },
      referenceMap: snapshot,
      referenceQuery: query,
      ...overrides,
    },
    global: {
      stubs: {
        HqChartToolbar: true,
        WorkbenchSummary: true,
        MainChartHoverLegend: true,
        StockChipProfileOverlay: true,
      },
    },
  })
  wrappers.push(wrapper)
  return wrapper
}

async function renderViewportFrame() {
  await flushPromises()
  const pending = [...frames.values()]
  frames.clear()
  pending.forEach((callback) => callback(0))
  await nextTick()
}

describe('HQ reference-map component integration', () => {
  it('mounts the shared canvas after readiness and forwards the historical snapshot and native viewport', async () => {
    const wrapper = mountTerminal()
    expect(wrapper.findComponent(PriceReferenceCanvas).exists()).toBe(false)
    await renderViewportFrame()
    expect(wrapper.emitted('ready')).toHaveLength(1)
    expect(mocks.adapter.getStockChipViewport).toHaveBeenCalledOnce()
    expect(mocks.adapter.getPriceReferenceViewport).toHaveBeenCalledOnce()
    const canvas = wrapper.getComponent(PriceReferenceCanvas)
    expect(canvas.props('snapshot')).toEqual(snapshot)
    expect(canvas.props('costPath')).toEqual(costPath)
    expect(canvas.props('viewport')).toEqual(viewport)
    expect(paintPriceReferenceMap).toHaveBeenLastCalledWith(
      context,
      expect.objectContaining({ path: snapshot.path, costPath, bounds: viewport.bounds, dark: false }),
    )
    expect(wrapper.getComponent(PriceReferenceLegend).props('date')).toBe(rows[1].date)
    mocks.options.onCursor(0)
    await nextTick()
    expect(wrapper.getComponent(PriceReferenceLegend).props('date')).toBe(rows[0].date)
    expect(wrapper.find('.price-reference-node b').text()).toBe('90')
    expect(wrapper.emitted('cursor-change').at(-1)).toEqual([0])
  })

  it('clears pending snapshots and independently suppresses cost fill or the complete map', async () => {
    const wrapper = mountTerminal()
    await renderViewportFrame()
    await wrapper.setProps({ referenceMap: null, referenceQuery: { ...query, status: 'computing' } })
    expect(wrapper.getComponent(PriceReferenceCanvas).props('snapshot')).toBeNull()
    expect(paintPriceReferenceMap).toHaveBeenLastCalledWith(context, expect.objectContaining({ path: [] }))
    expect(wrapper.getComponent(PriceReferenceLegend).text()).toContain('计算中')
    expect(wrapper.findAll('.price-reference-node')).toHaveLength(0)
    await wrapper.setProps({ referenceMap: snapshot, referenceQuery: query })
    expect(paintPriceReferenceMap).toHaveBeenLastCalledWith(context, expect.objectContaining({ path: snapshot.path }))

    const overlays = wrapper.props('overlays')
    for (const key of ['costBand', 'priceBands']) {
      await wrapper.setProps({ overlays: { ...overlays, [key]: false } })
      await renderViewportFrame()
      expect(wrapper.getComponent(PriceReferenceCanvas).props('costPath')).toEqual([])
      expect(paintPriceReferenceMap).toHaveBeenLastCalledWith(context, expect.objectContaining({ costPath: [] }))
      expect(wrapper.getComponent(PriceReferenceLegend).props('bandVisible')).toBe(false)
    }
    await wrapper.setProps({ overlays: { ...overlays, priceReferenceMap: false } })
    await renderViewportFrame()
    expect(wrapper.findComponent(PriceReferenceCanvas).exists()).toBe(false)
    expect(wrapper.findComponent(PriceReferenceLegend).exists()).toBe(false)
    expect(frames.size).toBe(0)
    await wrapper.setProps({ overlays })
    await renderViewportFrame()
    expect(wrapper.getComponent(PriceReferenceCanvas).props('snapshot')).toEqual(snapshot)
    expect(wrapper.getComponent(PriceReferenceCanvas).props('costPath')).toEqual(costPath)
  })

  it('releases the viewport monitor, observer and adapter when the terminal is unmounted', async () => {
    const wrapper = mountTerminal()
    await renderViewportFrame()
    expect(frames.size).toBe(1)
    const pending = [...frames.values()][0]
    mocks.adapter.getPriceReferenceViewport.mockClear()
    wrapper.unmount()
    wrappers.splice(wrappers.indexOf(wrapper), 1)
    expect(cancelAnimationFrame).toHaveBeenCalled()
    expect(frames.size).toBe(0)
    expect(observer.disconnect).toHaveBeenCalledOnce()
    expect(mocks.adapter.destroy).toHaveBeenCalledOnce()
    pending(0)
    expect(mocks.adapter.getPriceReferenceViewport).not.toHaveBeenCalled()
    expect(frames.size).toBe(0)
  })
})
