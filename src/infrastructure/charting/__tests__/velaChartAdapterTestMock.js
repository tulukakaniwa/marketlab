import { vi } from 'vitest'
import { waitForChartOperation } from '../chartOperation.js'

export function createVelaWorkspaceShellMock(state) {
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
    addNativeIndicator(type, options = {}) {
      const descriptor = state.descriptors.get(type)
      const native = descriptor.create()
      const events = new Map()
      let inputs = { ...descriptor.defaultInputs?.(), ...options.inputs }
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
        inputValues: () => ({ ...inputs }),
        setInputs: vi.fn((values) => {
          inputs = { ...inputs, ...values }
          native.setInputs?.(inputs)
          this.emit('indicator:inputs', { id: handle.id })
        }),
        moveTo: vi.fn((target) => {
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
      Promise.resolve(this.ready()).then(() => {
        if (!handle.removed) native.start(context, inputs)
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
}
