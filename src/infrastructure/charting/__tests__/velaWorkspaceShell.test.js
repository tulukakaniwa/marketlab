import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createVelaWorkspaceShell } from '../velaWorkspaceShell.js'

const state = vi.hoisted(() => ({ workspaces: [], statuslines: [], ready: null, nextMarkets: [], tokens: [] }))

function events() {
  const listeners = new Map()
  return {
    on(name, handler) {
      if (!listeners.has(name)) listeners.set(name, new Set())
      listeners.get(name).add(handler)
      return () => listeners.get(name).delete(handler)
    },
    emit(name, value) {
      for (const handler of listeners.get(name) ?? []) handler(value)
    },
    count: () => [...listeners.values()].reduce((count, set) => count + set.size, 0),
  }
}

vi.mock('@luxalgo/vela/workspace', () => ({
  VelaWorkspace: class {
    constructor(element, options) {
      this.element = element
      this.options = options
      const bus = events(),
        crosshair = events(),
        config = events()
      const features = { priceStyle: 'candles', candleVisible: true }
      this.chart = {
        ...bus,
        market: { symbol: options.symbol, timeframe: options.timeframe },
        replay: { state: { active: false } },
        ready: () => state.ready ?? Promise.resolve(),
        renderer: {
          get: (name) => features[name],
          set: vi.fn((name, value) => {
            features[name] = value
          }),
          getConfig: () => ({ candles: { upColor: '#123', downColor: '#456' } }),
          onConfigChanged: (handler) => config.on('change', handler),
          onCrosshairMove: (handler) => crosshair.on('move', handler),
        },
        setMarket: vi.fn((next) => {
          this.chart.market = { ...this.chart.market, ...next }
          return state.nextMarkets.shift() ?? Promise.resolve()
        }),
      }
      this.active = {
        host: document.createElement('div'),
        chart: this.chart,
        history: { silently: vi.fn((command) => command()) },
        setSymbol: vi.fn((symbol) => this.chart.setMarket({ symbol })),
        setTimeframe: vi.fn((timeframe) => this.chart.setMarket({ timeframe })),
        applyRange: vi.fn((preset) => this.chart.setMarket({ timeframe: preset.tf, visibleRange: preset.preset })),
        resetView: vi.fn(),
      }
      this.originalCommands = { ...this.active }
      this.destroy = vi.fn()
      this.resize = vi.fn()
      this.setTheme = vi.fn((theme) => bus.emit('theme:changed', theme))
      state.workspaces.push(this)
    }
  },
}))
vi.mock('@luxalgo/vela/widget', () => ({
  Statusline: class {
    constructor(host, symbol) {
      this.host = host
      this.symbol = symbol
      this.off = []
      this.setPartVisible = vi.fn()
      this.setDirectionColors = vi.fn()
      state.statuslines.push(this)
    }
    setSymbol(symbol) {
      this.symbol = symbol
    }
    setMeta(timeframe, provider) {
      this.meta = { timeframe, provider }
    }
    attachMenu(hooks) {
      this.menu = hooks
    }
    onChart(chart) {
      this.off.forEach((off) => off())
      this.off = [
        chart.on('bar', (bar) => {
          this.bar = bar
        }),
        chart.renderer.onCrosshairMove((event) => {
          this.hover = event.ohlc
        }),
      ]
    }
    destroy() {
      this.off.forEach((off) => off())
      this.off = []
    }
  },
}))
vi.mock('@luxalgo/vela/ui', () => ({
  applyPlotOverlayTokens: (host, theme, config) => state.tokens.push({ host, theme, config }),
}))
vi.mock('@luxalgo/vela', () => ({ resolveTheme: (theme) => theme }))

beforeEach(() => {
  state.workspaces.length = state.statuslines.length = state.tokens.length = state.nextMarkets.length = 0
  state.ready = null
})

const rows = [{ date: '2026-10-08', open: 9, high: 12, low: 8, close: 11, volume: 120 }]
const source = { symbol: 'BTCUSDT', label: 'Bitcoin 日线' }

describe('native Vela workspace shell', () => {
  it('uses native single-chart controls and keeps host drawing storage separate', async () => {
    const shell = await createVelaWorkspaceShell({ element: {}, rows, source, theme: 'dark' })
    const workspace = state.workspaces[0]
    expect(shell.workspace).toBe(workspace)
    expect(shell.chart).toBe(workspace.chart)
    expect(workspace.options).toMatchObject({
      layout: false,
      persist: false,
      timeframe: '1D',
      timeframes: ['1D'],
      symbol: 'BTCUSDT',
      statusline: false,
      drawingToolbar: true,
      drawings: true,
      bottombar: true,
      live: false,
      volume: false,
      topbar: { left: ['style', 'indicators', 'undo-redo'], right: ['panels', 'screenshot'] },
    })
    expect(workspace.options.data[0]).toMatchObject({ time: Date.UTC(2026, 9, 8), close: 11, volume: 120 })
    expect(state.statuslines[0].meta).toEqual({ timeframe: '1D', provider: '本地' })
    expect(state.statuslines[0].setPartVisible).toHaveBeenCalledWith('market', false)
    expect(state.statuslines[0].setPartVisible).not.toHaveBeenCalledWith('change', false)
    expect(state.tokens.at(-1)).toMatchObject({ host: workspace.active.host, theme: 'dark' })
    shell.fit()
    shell.resize()
    expect(workspace.active.resetView).toHaveBeenCalledOnce()
    expect(workspace.resize).toHaveBeenCalledOnce()
    expect(shell.silently(() => 42)).toBe(42)
    shell.destroy()
    shell.destroy()
    expect(workspace.destroy).toHaveBeenCalledOnce()
    expect(workspace.chart.count()).toBe(0)
    expect(workspace.active.setSymbol).toBe(workspace.originalCommands.setSymbol)
  })

  it('seeds only the official statusline consumer from static bars and refreshes it on a source change', async () => {
    const shell = await createVelaWorkspaceShell({ element: {}, rows, source })
    const chart = shell.chart,
      line = state.statuslines[0]
    const ordinaryBarHandler = vi.fn()
    const off = chart.on('bar', ordinaryBarHandler)
    expect(line.bar).toMatchObject({ time: Date.UTC(2026, 9, 8), close: 11 })
    const next = [{ ...rows[0], date: '2026-10-09', close: 13 }]
    await shell.setRows(next, { symbol: '600519', label: '贵州茅台' })
    expect(chart.setMarket).toHaveBeenCalledWith({
      data: [{ time: Date.UTC(2026, 9, 9), open: 9, high: 12, low: 8, close: 13, volume: 120 }],
      symbol: '600519',
      timeframe: '1D',
    })
    expect(line.symbol).toBe('600519')
    expect(line.bar.close).toBe(13)
    expect(ordinaryBarHandler).not.toHaveBeenCalled()
    const liveBar = { ...line.bar, close: 14 }
    chart.emit('bar', liveBar)
    expect(line.bar).toBe(liveBar)
    expect(ordinaryBarHandler).toHaveBeenCalledWith(liveBar)
    off()
    shell.destroy()
  })

  it('keeps native range controls but prevents symbol and timeframe quick actions from changing Lab data', async () => {
    const shell = await createVelaWorkspaceShell({ element: {}, rows, source })
    const cell = shell.workspace.active
    cell.setSymbol('UNRELATED')
    cell.setTimeframe('5')
    expect(shell.chart.setMarket).not.toHaveBeenCalled()
    cell.applyRange({ id: '1D', tf: '1', preset: '1D', bars: 1500 })
    expect(shell.workspace.originalCommands.applyRange).toHaveBeenCalledWith({
      id: '1D',
      tf: '1D',
      preset: '1D',
      bars: 1500,
    })
    expect(shell.chart.market.timeframe).toBe('1D')
    expect(shell.chart.market.symbol).toBe('BTCUSDT')
    shell.destroy()
  })

  it('does not replace the latest statusline state when an older market command resolves late', async () => {
    const shell = await createVelaWorkspaceShell({ element: {}, rows, source })
    let resolveOld
    state.nextMarkets.push(
      new Promise((resolve) => {
        resolveOld = resolve
      }),
    )
    const old = shell.setRows([{ ...rows[0], close: 12 }], { symbol: 'OLD' })
    await shell.setRows([{ ...rows[0], close: 15 }], { symbol: 'NEW' })
    resolveOld()
    await old
    expect(state.statuslines[0].symbol).toBe('NEW')
    expect(state.statuslines[0].bar.close).toBe(15)
    shell.destroy()
  })

  it('destroys the workspace and its official statusline when startup is aborted', async () => {
    state.ready = new Promise(() => {})
    const controller = new AbortController()
    const pending = createVelaWorkspaceShell({ element: {}, rows, source, signal: controller.signal })
    const workspace = state.workspaces[0]
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(workspace.destroy).toHaveBeenCalledOnce()
    expect(workspace.chart.count()).toBe(0)
    expect(state.statuslines[0].off).toHaveLength(0)
  })

  it('cancels an outstanding source load without binding another statusline subscription', async () => {
    const controller = new AbortController()
    const shell = await createVelaWorkspaceShell({ element: {}, rows, source, signal: controller.signal })
    let resolveMarket
    state.nextMarkets.push(
      new Promise((resolve) => {
        resolveMarket = resolve
      }),
    )
    const pending = shell.setRows([{ ...rows[0], close: 20 }], { symbol: 'LATE' })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    resolveMarket()
    await Promise.resolve()
    expect(state.statuslines[0].symbol).toBe('BTCUSDT')
    expect(state.statuslines[0].off).toHaveLength(0)
    expect(shell.chart.count()).toBe(0)
    expect(shell.workspace.destroy).toHaveBeenCalledOnce()
  })

  it('cleans a failed native startup and avoids creating anything for an already aborted signal', async () => {
    state.ready = Promise.reject(new Error('renderer unavailable'))
    await expect(createVelaWorkspaceShell({ element: {}, rows, source })).rejects.toThrow('renderer unavailable')
    expect(state.workspaces[0].destroy).toHaveBeenCalledOnce()
    const controller = new AbortController()
    controller.abort()
    await expect(
      createVelaWorkspaceShell({ element: {}, rows, source, signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(state.workspaces).toHaveLength(1)
  })
})
