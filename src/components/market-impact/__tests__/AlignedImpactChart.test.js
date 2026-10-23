import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AlignedImpactChart from '../AlignedImpactChart.vue'
import ImpactReferenceLegend from '../../ImpactReferenceLegend.vue'

const state = vi.hoisted(() => ({ options: null, create: null, resizeObservers: [] }))
const adapter = vi.hoisted(() => ({
  chart: { setVisibleRange: vi.fn(), renderer: { set: vi.fn() } },
  sync: vi.fn(async () => {}),
  whenReady: vi.fn(async () => {}),
  destroy: vi.fn(),
  setRows: vi.fn(async () => {}),
  setTheme: vi.fn(),
  resize: vi.fn(),
  painted: Promise.resolve(true),
}))
vi.mock('../../../infrastructure/charting/velaChartAdapter.js', () => ({
  createVelaChartAdapter: async (options) => {
    state.options = options
    return state.create ? state.create() : adapter
  },
}))

let wrapper
beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  state.create = null
  state.resizeObservers.length = 0
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn()
      disconnect = vi.fn()
      constructor(callback) {
        this.callback = callback
        state.resizeObservers.push(this)
      }
    },
  )
})
afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  vi.unstubAllGlobals()
})

describe('aligned intraday research chart', () => {
  it('uses the actual prefix with an empty daily model and frames its latest 100 candles', async () => {
    const props = makeProps(150)
    wrapper = mount(AlignedImpactChart, { props })
    await flushPromises()
    expect(state.options.source.timeframe).toBe('5m')
    expect(state.options.rows).toEqual(props.rows)
    expect(adapter.sync.mock.calls[0]).toEqual([
      { dates: props.rows.map((row) => row.date), groups: [], centerDescriptors: [] },
      expect.objectContaining({
        costPath: [],
        markers: [],
        centerConfig: {},
        referenceMap: null,
        impactMap: props.impactMap,
        overlays: expect.objectContaining({ priceBands: false, volume: true, impactReferenceMap: true }),
      }),
    ])
    expect(adapter.chart.setVisibleRange).toHaveBeenCalledWith({
      from: Date.parse(props.rows[50].date),
      to: Date.parse(props.rows.at(-1).date) + 12 * 300000,
    })
    expect(wrapper.text()).toContain(props.rows.at(-1).closeTime)
    expect(wrapper.text()).not.toContain('GetDelta')
    expect(wrapper.text()).not.toContain('入场价')
    await button('返回日线工作台').trigger('click')
    await button('研究样本').trigger('click')
    expect(wrapper.emitted('return-daily')).toHaveLength(1)
    expect(wrapper.emitted('open-research')).toHaveLength(1)
  })

  it('keeps the hover legend date aligned and clears/hides research without resetting the viewport', async () => {
    const props = makeProps()
    wrapper = mount(AlignedImpactChart, { props })
    await flushPromises()
    state.options.onCursor(Date.parse(props.rows[0].date))
    await flushPromises()
    expect(wrapper.getComponent(ImpactReferenceLegend).props('date')).toBe(props.rows[0].date)
    await wrapper.setProps({ impactMap: null })
    await flushPromises()
    expect(adapter.sync.mock.calls.at(-1)[1].impactMap).toBeNull()
    await button('研究价位').trigger('click')
    await flushPromises()
    expect(adapter.sync.mock.calls.at(-1)[1].overlays.impactReferenceMap).toBe(false)
    expect(wrapper.findComponent(ImpactReferenceLegend).exists()).toBe(false)
    await button('成交量').trigger('click')
    await flushPromises()
    expect(adapter.sync.mock.calls.at(-1)[1].overlays.volume).toBe(false)
    expect(adapter.setRows).not.toHaveBeenCalled()
    expect(adapter.chart.setVisibleRange).toHaveBeenCalledOnce()
    await wrapper.setProps({ theme: 'dark' })
    expect(adapter.setTheme).toHaveBeenLastCalledWith('dark')
  })

  it('rejects late row completions after the observation prefix moves again', async () => {
    wrapper = mount(AlignedImpactChart, { props: makeProps(4) })
    await flushPromises()
    let finishOld
    adapter.setRows.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve
        }),
    )
    await wrapper.setProps(makeProps(3))
    expect(wrapper.attributes('aria-busy')).toBe('true')
    const newest = makeProps(2)
    await wrapper.setProps(newest)
    await flushPromises()
    const calls = adapter.sync.mock.calls.length
    expect(adapter.sync.mock.calls.at(-1)[0].dates).toEqual(newest.rows.map((row) => row.date))
    finishOld()
    await flushPromises()
    expect(adapter.sync).toHaveBeenCalledTimes(calls)
    expect(wrapper.attributes('aria-busy')).toBe('false')
  })

  it('adapts the viewport to known near/far levels without changing their strengths or backfilling earlier bars', async () => {
    const props = makeProps()
    props.rows.at(-1).closeTime = Date.parse(props.rows.at(-1).closeTime)
    props.impactMap.path[0] = { date: props.rows[0].date, status: 'not-yet-available', nodes: [] }
    props.impactMap.path[2].nodes = [
      { kind: 'lp', price: 2500, intensity: 0.86 },
      { kind: 'options', price: 2300, intensity: 0.2 },
      { kind: 'options', price: 6000, intensity: 1 },
    ]
    const original = structuredClone(props.impactMap)
    wrapper = mount(AlignedImpactChart, { props })
    await flushPromises()
    expect(wrapper.text()).toContain(new Date(props.rows.at(-1).closeTime).toISOString())
    expect(adapter.sync.mock.calls.at(-1)[1].priceScaleHints).toEqual([
      { date: props.rows[2].date, min: 2300, max: 2500 },
    ])
    await button('全部价位').trigger('click')
    await flushPromises()
    expect(adapter.sync.mock.calls.at(-1)[1].priceScaleHints).toEqual([
      { date: props.rows[2].date, min: 2300, max: 6000 },
    ])
    await button('行情范围').trigger('click')
    await flushPromises()
    expect(adapter.sync.mock.calls.at(-1)[1].priceScaleHints).toEqual([])
    await button('附近价位 ±15%').trigger('click')
    await button('研究价位').trigger('click')
    await flushPromises()
    expect(adapter.sync.mock.calls.at(-1)[1].priceScaleHints).toEqual([])
    expect(props.impactMap).toEqual(original)
    expect(adapter.sync.mock.calls.at(-1)[1].impactMap).toEqual(original)
    expect(adapter.setRows).not.toHaveBeenCalled()
    expect(adapter.chart.setVisibleRange).toHaveBeenCalledOnce()
  })

  it('aborts startup and destroys late adapters after leaving the research view', async () => {
    let finishCreate
    state.create = () =>
      new Promise((resolve) => {
        finishCreate = resolve
      })
    wrapper = mount(AlignedImpactChart, { props: makeProps() })
    wrapper.unmount()
    wrapper = null
    expect(state.options.signal.aborted).toBe(true)
    finishCreate(adapter)
    await flushPromises()
    expect(adapter.destroy).toHaveBeenCalledOnce()
    expect(adapter.sync).not.toHaveBeenCalled()
  })

  it('cleans the rendered chart and listeners and makes renderer failure visible', async () => {
    wrapper = mount(AlignedImpactChart, { props: makeProps() })
    await flushPromises()
    state.options.onError(new Error('renderer failed'))
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('renderer failed')
    expect(adapter.destroy).toHaveBeenCalledOnce()
    wrapper.unmount()
    wrapper = null
    expect(state.resizeObservers[0].disconnect).toHaveBeenCalledOnce()
    expect(state.options.signal.aborted).toBe(true)
    expect(adapter.destroy).toHaveBeenCalledOnce()
  })
})

function button(text) {
  return wrapper.findAll('button').find((item) => item.text() === text)
}

function makeProps(count = 3) {
  const rows = Array.from({ length: count }, (_, index) => {
    const start = Date.UTC(2026, 9, 23, 8) + index * 300000
    return {
      date: new Date(start).toISOString(),
      closeTime: new Date(start + 300000).toISOString(),
      isClosed: true,
      open: 2500,
      high: 2510,
      low: 2490,
      close: 2505,
      volume: 120,
    }
  })
  return {
    rows,
    source: { symbol: 'ETHUSDT', timeframe: '5m' },
    impactMap: { path: rows.map((row) => ({ date: row.date, status: 'ready', nodes: [] })) },
  }
}
