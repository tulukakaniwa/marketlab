import { VelaWorkspace } from '@luxalgo/vela/workspace'
import { Statusline } from '@luxalgo/vela/widget'
import { applyPlotOverlayTokens } from '@luxalgo/vela/ui'
import { resolveTheme } from '@luxalgo/vela'
import { toVelaBars } from './velaResearchAdapter.js'
import { waitForChartOperation } from './chartOperation.js'

/** The native shell owns chart UI; the Lab owns the offline source and daily timeframe. */
export async function createVelaWorkspaceShell({ element, rows = [], source, theme = 'light', signal } = {}) {
  if (signal?.aborted) throw abortError()
  let workspace,
    statusline,
    cell,
    chart,
    destroyed = false,
    generation = 0
  let currentRows = rows,
    currentSource = source,
    appTheme = theme
  const subscriptions = []
  const restoreCommands = []

  function assertLive() {
    if (destroyed || signal?.aborted) throw abortError()
  }
  function silently(command) {
    assertLive()
    let result
    cell.history.silently(() => {
      result = command()
    })
    return result
  }
  function seedBar(handler) {
    const latest = currentRows.at(-1)
    if (latest) handler(toVelaBars([latest])[0])
  }
  function bindStatusline() {
    statusline.setSymbol(sourceSymbol(currentSource))
    statusline.setMeta('1D', '本地')
    // Static series loads have no `bar` event. Seed only this official UI subscriber;
    // the real chart event bus, indicator execution and replay receive no synthetic tick.
    statusline.onChart({
      renderer: chart.renderer,
      replay: chart.replay,
      on(event, handler) {
        const unsubscribe = chart.on(event, handler)
        if (event !== 'bar') return unsubscribe
        seedBar(handler)
        return unsubscribe
      },
    })
  }
  function syncAppearance() {
    if (destroyed) return
    const config = chart.renderer.getConfig()
    applyPlotOverlayTokens(cell.host, resolveTheme(appTheme), config)
    const style = chart.renderer.get('priceStyle')
    let up = config?.candles?.upColor ?? null,
      down = config?.candles?.downColor ?? null
    let readout = 'ohlc',
      isUp = null
    if (style === 'bars') {
      up = config?.bars?.upColor ?? null
      down = config?.bars?.downColor ?? null
    } else if (style === 'line' || style === 'area') {
      up = down = (style === 'line' ? config?.line?.color : config?.area?.lineColor) ?? null
      readout = 'value'
    } else if (style === 'baseline') {
      up = config?.baseline?.topLineColor ?? null
      down = config?.baseline?.bottomLineColor ?? null
      readout = 'value'
      isUp = (bar) => {
        const level = Number(chart.renderer.get('baselinePrice'))
        return Number.isFinite(level) ? bar.close >= level : bar.close >= bar.open
      }
    }
    statusline.setDirectionColors(up, down, isUp, readout)
  }
  function guardMarketCommands() {
    for (const name of ['setSymbol', 'setTimeframe']) {
      const original = cell[name]
      // Dataset selection is a Lab command; native search/quick-entry cannot replace it.
      cell[name] = () => {}
      restoreCommands.push(() => {
        cell[name] = original
      })
    }
    const applyRange = cell.applyRange
    cell.applyRange = (preset) => applyRange.call(cell, { ...preset, tf: '1D' })
    restoreCommands.push(() => {
      cell.applyRange = applyRange
    })
  }
  async function setRows(nextRows, nextSource = currentSource) {
    assertLive()
    const ticket = ++generation
    const next = Array.isArray(nextRows) ? nextRows : []
    await waitForChartOperation(
      silently(() => chart.setMarket({ data: toVelaBars(next), symbol: sourceSymbol(nextSource), timeframe: '1D' })),
      { signal, label: 'Vela 本地日线' },
    )
    assertLive()
    if (ticket !== generation) return
    currentRows = next
    currentSource = nextSource
    bindStatusline()
    syncAppearance()
  }
  function destroy() {
    if (destroyed) return
    destroyed = true
    generation++
    signal?.removeEventListener('abort', destroy)
    subscriptions.forEach((unsubscribe) => unsubscribe())
    statusline?.destroy()
    restoreCommands.forEach((restore) => restore())
    workspace?.destroy()
  }

  try {
    workspace = new VelaWorkspace(element, {
      layout: false,
      persist: false,
      data: toVelaBars(rows),
      symbol: sourceSymbol(source),
      timeframe: '1D',
      timeframes: ['1D'],
      theme,
      live: false,
      logScale: true,
      currentPriceLine: true,
      volume: false,
      drawings: true,
      drawingToolbar: true,
      statusline: false,
      bottombar: true,
      watermark: true,
      topbar: { left: ['style', 'indicators', 'undo-redo'], right: ['panels', 'screenshot'] },
      settings: { hidden: ['symbol.timezone', 'trading-session', 'advanced.bars'] },
    })
    cell = workspace.active
    chart = cell.chart
    guardMarketCommands()
    signal?.addEventListener('abort', destroy, { once: true })
    statusline = new Statusline(cell.host, sourceSymbol(source))
    statusline.setPartVisible('market', false)
    statusline.attachMenu({
      setPart: (part, visible) => statusline.setPartVisible(part, part === 'market' ? false : visible),
      chartVisible: () => chart.renderer.get('candleVisible') !== false,
      setChartVisible: (visible) => chart.renderer.set('candleVisible', visible),
    })
    bindStatusline()
    subscriptions.push(chart.renderer.onConfigChanged(syncAppearance))
    subscriptions.push(
      chart.on('theme:changed', (nextTheme) => {
        appTheme = nextTheme
        syncAppearance()
      }),
    )
    syncAppearance()
    await waitForChartOperation(chart.ready(), { signal, label: 'Vela 原生工作台' })
    assertLive()
    return {
      workspace,
      chart,
      setRows,
      silently,
      setTheme(next) {
        assertLive()
        appTheme = next
        workspace.setTheme(next)
        syncAppearance()
      },
      resize: () => {
        assertLive()
        workspace.resize()
      },
      fit: () => {
        assertLive()
        cell.resetView()
      },
      destroy,
    }
  } catch (error) {
    destroy()
    throw error
  }
}

function sourceSymbol(source) {
  return String(source?.symbol || source?.id || source?.label || '本地数据')
}
function abortError() {
  return new DOMException('图表初始化已取消', 'AbortError')
}
