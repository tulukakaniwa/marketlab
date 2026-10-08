import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createVelaChartAdapter } from '../velaChartAdapter.js'
import { waitForChartOperation } from '../chartOperation.js'

const state = vi.hoisted(() => ({ descriptors: new Map(), layers: new Map(), charts: [], ready: null }))
vi.mock('@luxalgo/vela/plugin', () => ({
  getNativeIndicator: (key) => state.descriptors.get(key),
  registerNativeIndicator: (value) => state.descriptors.set(value.type, value),
  unregisterNativeIndicator: (key) => state.descriptors.delete(key),
  registerRendererLayer: (value) => state.layers.set(value.id, value),
  unregisterRendererLayer: (key) => state.layers.delete(key),
}))
vi.mock('../velaWorkspaceShell.js', () => {
  class Vela {
    constructor(element, options) {
      this.element = element
      this.options = options
      this.handles = []
      this.data = {}
      this.silently = vi.fn((command) => command())
      this.events = new Map()
      this.panes = {
        list: () => {
          const panes = new Map([['price', { id: 'price', indicators: [] }]])
          for (const handle of this.handles.filter((handle) => handle.mounted && !handle.removed)) {
            if (!panes.has(handle.paneId)) panes.set(handle.paneId, { id: handle.paneId, indicators: [] })
            panes.get(handle.paneId).indicators.push({ id: handle.id })
          }
          return [...panes.values()]
        },
      }
      this.document = { version: 1, drawings: [] }
      this.drawings = {
        toJSON: () => structuredClone(this.document),
        fromJSON: vi.fn((document) => {
          this.document = structuredClone(document)
        }),
      }
      this.destroy = vi.fn(() => this.handles.filter((handle) => !handle.removed).forEach((handle) => handle.remove()))
      this.off = vi.fn()
      this.renderer = {
        onCrosshairMove: (handler) => {
          this.cursor = handler
          return this.off
        },
      }
      this.setMarket = vi.fn(async () => {})
      this.setVisibleRangePreset = vi.fn()
      state.charts.push(this)
    }
    on(event, callback) {
      if (!this.events.has(event)) this.events.set(event, new Set())
      this.events.get(event).add(callback)
      return () => this.events.get(event).delete(callback)
    }
    emit(event, payload) {
      this.events.get(event)?.forEach((callback) => callback(payload))
    }
    ready() {
      return state.ready ?? Promise.resolve()
    }
    indicators() {
      return this.handles.filter((handle) => !handle.removed)
    }
    addNativeIndicator(type) {
      const descriptor = state.descriptors.get(type)
      const native = descriptor.create()
      const events = new Map()
      const handle = {
        id: `native-${this.handles.length}`,
        type,
        nativeType: type,
        native,
        paneId: null,
        mounted: false,
        removed: false,
        on: (event, callback) => {
          if (!events.has(event)) events.set(event, new Set())
          events.get(event).add(callback)
          return () => events.get(event).delete(callback)
        },
        setInputs: vi.fn((values) => native.setInputs?.(values)),
        moveTo: vi.fn((target) => {
          // Real Vela ignores this until the first model exists.
          if (!handle.mounted) return
          handle.paneId = target === 'price' ? 'price' : (target.pane ?? `pane-${handle.id}-moved`)
          this.emit('indicator:moved', { id: handle.id, paneId: handle.paneId })
        }),
        setVisible: vi.fn((visible) => this.emit('indicator:visibility', { id: handle.id, visible })),
        remove: vi.fn(() => {
          handle.removed = true
          native.stop()
          this.emit('indicator:removed', { id: handle.id })
        }),
      }
      const context = {
        data: this.data,
        emit: vi.fn((output) => {
          const first = !handle.mounted
          handle.mounted = true
          handle.paneId ??= descriptor.overlay ? 'price' : `pane-${handle.id}`
          handle.output = structuredClone(output)
          if (first) {
            this.emit('indicator:added', { id: handle.id })
            events.get('ready')?.forEach((callback) => callback())
          }
        }),
        pushData: vi.fn(),
      }
      handle.context = context
      this.handles.push(handle)
      // Match the library's await readyPromise before native start / pane creation.
      Promise.resolve(this.ready()).then(() => {
        if (!handle.removed) native.start(context, {})
      })
      return handle
    }
  }
  return {
    async createVelaWorkspaceShell({ element, rows, theme, signal }) {
      const chart = new Vela(element, {
        rows,
        theme,
        live: false,
        volume: false,
        drawings: true,
        logScale: true,
        currentPriceLine: true,
      })
      let destroyed = false
      const destroy = () => {
        if (destroyed) return
        destroyed = true
        signal?.removeEventListener('abort', destroy)
        chart.destroy()
      }
      signal?.addEventListener('abort', destroy, { once: true })
      try {
        await waitForChartOperation(chart.ready(), { signal })
      } catch (error) {
        destroy()
        throw error
      }
      return {
        chart,
        destroy,
        silently: chart.silently,
        setRows: chart.setMarket,
        fit: chart.setVisibleRangePreset,
        resize: vi.fn(),
        setTheme: vi.fn(),
      }
    },
  }
})

beforeEach(() => {
  state.descriptors.clear()
  state.layers.clear()
  state.charts.length = 0
  state.ready = null
  for (const type of ['volume', 'vpvr'])
    state.descriptors.set(type, {
      type,
      overlay: true,
      create: () => ({ start: (context) => context.emit({}), setInputs() {}, stop() {} }),
    })
})
const rows = [{ date: '2026-10-08', open: 8, high: 10, low: 7, close: 9, volume: 120 }]
const priceGroup = {
  id: 'price',
  label: '价格',
  active: true,
  series: [{ id: 'cost', label: '成本', color: '#0e7558', active: true, points: [{ time: rows[0].date, value: 8 }] }],
  guides: [],
}
const model = { dates: [rows[0].date], groups: [priceGroup] }
const input = { rows, costPath: [], markers: [], overlays: { volume: true, stockChipProfile: false } }
const studyGroup = { ...priceGroup, id: 'kdj', label: 'Lab KDJ', overlayKey: 'kdjPane' }

function adapter(options = {}) {
  return createVelaChartAdapter({ element: {}, rows, theme: 'light', ...options })
}

describe('Vela asynchronous lifecycle and host/native consistency', () => {
  it('uses native visible-range profile and keeps mobile suppression separate from the saved overlay', async () => {
    const change = vi.fn()
    const view = await adapter({ onOverlayChange: change })
    const chart = state.charts[0]
    await view.sync(model, {
      ...input,
      overlays: { volume: false, stockChipProfile: true },
      profilePaintEnabled: false,
    })
    const profile = chart.handles.find((handle) => handle.type === 'vpvr')
    expect(profile.paneId).toBe('price')
    expect(profile.setVisible).toHaveBeenLastCalledWith(false)
    expect(change).not.toHaveBeenCalled()
    await view.sync(model, { ...input, overlays: { volume: false, stockChipProfile: true }, profilePaintEnabled: true })
    expect(chart.handles.filter((handle) => handle.type === 'vpvr')).toHaveLength(1)
    expect(profile.setVisible).toHaveBeenLastCalledWith(true)
    view.destroy()
  })
  it('uses native volume, structurally refreshes domain snapshots, and releases registrations', async () => {
    const view = await adapter()
    const chart = state.charts[0]
    expect(chart.options).toMatchObject({ live: false, volume: false, drawings: true, logScale: true })
    await view.sync(model, input)
    expect(chart.handles).toHaveLength(3)
    const price = chart.handles.find((handle) => handle.type.endsWith('price.price'))
    expect(state.descriptors.get(price.type).legend).toBe(true)
    const volume = chart.handles.find((handle) => handle.type === 'volume')
    expect(volume.moveTo).toHaveBeenCalledWith({ newPane: { after: 'price' } })
    expect(price.output.series[0].points[0].value).toBe(8)
    const changed = {
      ...model,
      groups: [{ ...priceGroup, series: [{ ...priceGroup.series[0], points: [{ time: rows[0].date, value: 9 }] }] }],
    }
    const marker = { time: rows[0].date, position: 'belowBar', shape: 'arrowUp', text: 'B' }
    await view.sync(changed, { ...input, markers: [marker], overlays: { ...input.overlays, volume: false } })
    expect(chart.handles).toHaveLength(3)
    expect(price.setInputs).toHaveBeenCalledWith({})
    expect(price.output.series[0].points[0].value).toBe(9)
    const host = chart.handles.find((handle) => handle.type.endsWith('-host'))
    expect(state.descriptors.get(host.type).legend).toBe(false)
    expect(host.setInputs).toHaveBeenCalledWith({})
    expect(host.output.series[0].markers[0].text).toBe('B')
    expect(volume.remove).toHaveBeenCalledOnce()
    view.destroy()
    view.destroy()
    expect(chart.destroy).toHaveBeenCalledOnce()
    expect(chart.off).toHaveBeenCalledOnce()
    expect(state.layers.size).toBe(0)
    expect([...state.descriptors.keys()]).toEqual(['volume', 'vpvr'])
  })
  it('waits for asynchronous study panes before mapping/importing drawings', async () => {
    const view = await adapter()
    const chart = state.charts[0]
    const query = { ...model, groups: [priceGroup, studyGroup] }
    const pending = view.sync(query, input)
    expect(chart.panes.list().some((pane) => pane.id !== 'price')).toBe(false)
    await pending
    const study = chart.handles.find((handle) => handle.type.endsWith('kdj.shared'))
    chart.document.drawings = [
      { id: 'study-line', type: 'hline', paneId: study.paneId, anchors: [{ time: 1, price: 9 }] },
    ]
    const saved = view.exportDrawings()
    expect(saved.drawings[0].paneId).toBe('lab:kdj.shared')
    view.importDrawings(saved)
    expect(chart.document.drawings[0].paneId).toBe(study.paneId)
    const imported = chart.drawings.fromJSON.mock.calls.length
    await view.sync(query, input)
    expect(chart.drawings.fromJSON).toHaveBeenCalledTimes(imported) // numeric sync keeps native history
    await view.sync(model, input)
    await view.sync(query, input)
    const replacement = chart.handles.filter((handle) => handle.type.endsWith('kdj.shared')).at(-1)
    expect(replacement.paneId).not.toBe(study.paneId)
    expect(chart.document.drawings[0]).toMatchObject({
      id: 'study-line',
      paneId: replacement.paneId,
      anchors: [{ time: 1, price: 9 }],
    })
    view.destroy()
  })
  it('reflects native legend hide/remove commands in the domain overlay and can restore a removed study', async () => {
    const change = vi.fn()
    const view = await adapter({ onOverlayChange: change })
    const chart = state.charts[0]
    const query = { ...model, groups: [priceGroup, studyGroup] }
    await view.sync(query, input)
    const study = chart.handles.find((handle) => handle.type.endsWith('kdj.shared'))
    study.setVisible(false)
    expect(change).toHaveBeenLastCalledWith('kdjPane', false)
    study.remove()
    expect(change).toHaveBeenLastCalledWith('kdjPane', false)
    await view.sync(model, input)
    // The shell's native Undo calls the retained public type, without a host add command.
    expect(state.descriptors.has(study.type)).toBe(true)
    const revived = chart.addNativeIndicator(study.type)
    await Promise.resolve()
    expect(change).toHaveBeenLastCalledWith('kdjPane', true)
    expect(revived.output.series[0].points[0].value).toBeNull()
    const updated = {
      ...query,
      groups: [
        priceGroup,
        { ...studyGroup, series: [{ ...studyGroup.series[0], points: [{ time: rows[0].date, value: 11 }] }] },
      ],
    }
    await view.sync(updated, input)
    expect(revived.output.series[0].points[0].value).toBe(11)
    expect(chart.handles.filter((handle) => handle.type.endsWith('kdj.shared'))).toHaveLength(2)
    view.destroy()
  })
  it('gives each price legend its own host command and mutes programmatic removals', async () => {
    const change = vi.fn()
    const view = await adapter({ onOverlayChange: change })
    const chart = state.charts[0]
    const cost = { ...priceGroup.series[0], controls: ['priceBands', 'costBand'] }
    const causal = { ...cost, id: 'causal', label: '因果均衡', controls: ['causalEquilibrium'] }
    const entry = { ...cost, id: 'entry', label: '入场', controls: ['entryLine'] }
    const query = { ...model, groups: [{ ...priceGroup, overlayKey: 'priceBands', series: [cost, causal, entry] }] }
    await view.sync(query, { ...input, overlays: { volume: false, stockChipProfile: false } })
    const costHandle = chart.handles.find((handle) => handle.type.endsWith('price.costBand'))
    costHandle.setVisible(false)
    expect(change).toHaveBeenCalledExactlyOnceWith('costBand', false)
    const disabled = { ...model, groups: [{ ...priceGroup, series: [causal, entry] }] }
    const quietInput = { ...input, overlays: { volume: false, stockChipProfile: false } }
    await view.sync(disabled, quietInput)
    expect(costHandle.remove).not.toHaveBeenCalled()
    costHandle.setVisible(true)
    expect(change).toHaveBeenLastCalledWith('costBand', true)
    await view.sync(query, quietInput)
    change.mockClear()
    chart.silently.mockClear()
    await view.sync(disabled, quietInput)
    expect(costHandle.remove).toHaveBeenCalledOnce()
    expect(chart.silently).toHaveBeenCalled()
    expect(change).not.toHaveBeenCalled()
    expect(chart.indicators().filter((handle) => handle.type.includes('price.'))).toHaveLength(2)
    view.destroy()
  })
  it('cancels a running shell without treating teardown as user overlay commands', async () => {
    const change = vi.fn()
    const controller = new AbortController()
    const view = await adapter({ signal: controller.signal, onOverlayChange: change })
    await view.sync(model, input)
    controller.abort()
    expect(change).not.toHaveBeenCalled()
    expect(state.charts[0].destroy).toHaveBeenCalledOnce()
    expect(state.layers.size).toBe(0)
    expect([...state.descriptors.keys()]).toEqual(['volume', 'vpvr'])
  })
  it('isolates domain descriptors between native chart catalogs and keeps host markers out of the picker', async () => {
    const first = await adapter()
    const second = await adapter()
    await first.sync(model, input)
    const firstChart = state.charts[0],
      secondChart = state.charts[1]
    const descriptor = state.descriptors.get(
      firstChart.handles.find((handle) => handle.type.endsWith('price.price')).type,
    )
    expect(descriptor.isSupported('LOCAL', firstChart.data)).toBe(true)
    expect(descriptor.isSupported('LOCAL', secondChart.data)).toBe(false)
    const host = state.descriptors.get(firstChart.handles.find((handle) => handle.type.endsWith('-host')).type)
    expect(host.isSupported('LOCAL', firstChart.data)).toBe(false)
    first.destroy()
    second.destroy()
  })
  it('routes restored native failures before their first emit to workspace recovery', async () => {
    const error = vi.fn()
    const view = await adapter({ onError: error })
    const chart = state.charts[0]
    await view.sync(model, input)
    const old = chart.handles.find((handle) => handle.type.endsWith('price.price'))
    old.remove()
    state.ready = new Promise(() => {})
    const revived = chart.addNativeIndicator(old.type)
    const failure = new Error('native mount failed')
    chart.emit('indicator:error', { id: revived.id, error: failure })
    expect(error).toHaveBeenCalledExactlyOnceWith(failure)
    view.destroy()
  })
  it('destroys an aborted pending startup and leaves no global layer registrations', async () => {
    state.ready = new Promise(() => {})
    const controller = new AbortController()
    const pending = adapter({ signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(state.charts[0].destroy).toHaveBeenCalledOnce()
    expect(state.layers.size).toBe(0)
  })
})
