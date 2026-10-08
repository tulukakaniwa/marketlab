import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getNativeIndicator } from '@luxalgo/vela/plugin'
import { createVelaChartAdapter } from '../velaChartAdapter.js'
import { createHeadlessWorkspace } from './velaHeadlessWorkspace.js'

const state = vi.hoisted(() => ({ workspaces: [] }))
vi.mock('../velaWorkspaceShell.js', () => ({
  async createVelaWorkspaceShell({ element, rows }) {
    const { createHeadlessWorkspace } = await import('./velaHeadlessWorkspace.js')
    const workspace = await createHeadlessWorkspace(element, rows)
    state.workspaces.push(workspace)
    return {
      workspace,
      chart: workspace.active.chart,
      silently: (command) => {
        let result
        workspace.active.history.silently(() => {
          result = command()
        })
        return result
      },
      destroy: () => workspace.destroy(),
      setRows() {},
      setTheme() {},
      resize() {},
      fit() {},
    }
  },
}))

const rows = [{ date: '2026-10-08', open: 100, high: 101, low: 99, close: 100, volume: 1 }]
const formulas = ['statisticalCenter', 'vwapCost', 'cohortCost', 'supplyDemand', 'fundamental']
function query(active = ['statisticalCenter']) {
  const catalog = formulas.map((id) => ({
    id,
    label: id,
    color: '#666',
    centerFormula: id,
    controls: [id],
    points: [],
  }))
  return {
    dates: rows.map(({ date }) => date),
    centerDescriptors: catalog,
    groups: [{ id: 'price', active: true, series: catalog.filter(({ id }) => active.includes(id)) }],
  }
}
function input(centerConfig, dataRows = rows) {
  return {
    rows: dataRows,
    markers: [],
    costPath: [],
    centerConfig,
    overlays: { volume: false, stockChipProfile: false, regime: false },
  }
}
async function adapter(centerConfig, active = ['statisticalCenter']) {
  const change = vi.fn(({ formula, key, value }) => {
    centerConfig[formula] ??= {}
    centerConfig[formula][key] = value
  })
  const visibility = vi.fn()
  const view = await createVelaChartAdapter({
    element: document.createElement('div'),
    rows,
    onCenterInputChange: change,
    onOverlayChange: visibility,
  })
  await view.sync(query(active), input(centerConfig))
  const workspace = state.workspaces.at(-1)
  const handle = (formula) => view.chart.indicators().find(({ nativeType }) => nativeType?.endsWith(`price.${formula}`))
  return { view, workspace, history: workspace.active.history, handle, change, visibility }
}

beforeEach(() => {
  state.workspaces.length = 0
  vi.stubGlobal('CSS', { escape: (value) => String(value) })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  )
})
afterEach(() => {
  state.workspaces.forEach((workspace) => workspace.destroy())
  vi.unstubAllGlobals()
})

describe('real Vela native inputs and unified history', () => {
  it('records native edits in the actual cell history, with CQRS undo/redo and silent host sync', async () => {
    const config = { statisticalCenter: { lookback: 120, minObservations: 60 } }
    const { view, history, handle, change } = await adapter(config)
    expect(history.canUndo).toBe(false)
    handle('statisticalCenter').setInputs({ lookback: 90 })
    expect(config.statisticalCenter.lookback).toBe(90)
    expect(history.canUndo).toBe(true)
    await view.sync(query(), input(config))
    expect(change).toHaveBeenCalledTimes(1)
    history.undo()
    expect(config.statisticalCenter.lookback).toBe(120)
    expect(handle('statisticalCenter').inputValues().lookback).toBe(120)
    expect(history.canUndo).toBe(false)
    expect(history.canRedo).toBe(true)
    await view.sync(query(), input(config))
    history.redo()
    expect(config.statisticalCenter.lookback).toBe(90)
    expect(history.canRedo).toBe(false)
    expect(change).toHaveBeenCalledTimes(3)
    view.destroy()
  })
  it('uses real boolean and optional text schemas, preserving false/null through actual undo', async () => {
    const config = { supplyDemand: { enabled: false, a: null, b: null, c: null, d: null } }
    const { view, history, handle, change } = await adapter(config, ['supplyDemand'])
    const native = handle('supplyDemand')
    expect(
      getNativeIndicator(native.nativeType)
        .inputsSchema()
        .map(({ type }) => type),
    ).toEqual(['bool', 'string', 'string', 'string', 'string'])
    expect(native.inputValues()).toEqual({ enabled: false, a: '', b: '', c: '', d: '' })
    native.setInputs({ enabled: true })
    native.setInputs({ a: '20.5' })
    expect(config.supplyDemand).toEqual({ enabled: true, a: 20.5, b: null, c: null, d: null })
    history.undo()
    expect(config.supplyDemand.a).toBeNull()
    history.undo()
    expect(config.supplyDemand.enabled).toBe(false)
    expect(history.canUndo).toBe(false)
    history.redo()
    history.redo()
    expect(config.supplyDemand.a).toBe(20.5)
    native.setInputs({ a: '' })
    expect(config.supplyDemand.a).toBeNull()
    native.setInputs({ a: 'bad number' })
    expect(native.inputValues().a).toBe('')
    expect(change).toHaveBeenCalledTimes(7)
    view.destroy()
  })
  it('enables only an overlay from the native picker, leaving economic scenarios disabled and blank', async () => {
    const config = { fundamental: { enabled: false, nextDividend: null, requiredReturn: null, growthRate: null } }
    const { view, visibility, change } = await adapter(config, [])
    const hostType = view.chart.indicators().find(({ nativeType }) => nativeType.endsWith('-host')).nativeType
    const native = view.chart.addNativeIndicator(hostType.replace(/-host$/, '-price.fundamental'))
    await new Promise((resolve, reject) => {
      native.on('ready', resolve)
      native.on('error', ({ error }) => reject(error))
    })
    expect(native.inputValues()).toEqual({ enabled: false, nextDividend: '', requiredReturn: '', growthRate: '' })
    expect(visibility).toHaveBeenCalledExactlyOnceWith('fundamental', true)
    expect(change).not.toHaveBeenCalled()
    view.destroy()
  })
  it('undoes parameters on the revived native handle after native delete/restore', async () => {
    const config = { vwapCost: { lookback: 120, amountPerVolumeToPrice: null } }
    const { view, history, handle, change } = await adapter(config, ['vwapCost'])
    const original = handle('vwapCost')
    original.setInputs({ amountPerVolumeToPrice: '0.01' })
    expect(config.vwapCost.amountPerVolumeToPrice).toBe(0.01)
    original.remove()
    const restored = new Promise((resolve) => {
      const off = view.chart.on('indicator:added', ({ id }) => {
        const native = view.chart.indicators().find((item) => item.id === id)
        if (native?.nativeType === original.nativeType) {
          off()
          resolve(native)
        }
      })
    })
    history.undo()
    const revived = await restored
    expect(revived.id).not.toBe(original.id)
    expect(revived.inputValues().amountPerVolumeToPrice).toBe('0.01')
    history.undo()
    expect(config.vwapCost.amountPerVolumeToPrice).toBeNull()
    expect(revived.inputValues().amountPerVolumeToPrice).toBe('')
    expect(change).toHaveBeenCalledTimes(2)
    view.destroy()
  })
  it('does not apply stale current-day scenario history after the observation date or chart session changes', async () => {
    const config = { fundamental: { enabled: false, nextDividend: null, requiredReturn: null, growthRate: null } }
    const { view, history, handle, change } = await adapter(config, ['fundamental'])
    handle('fundamental').setInputs({ enabled: true })
    await view.sync(query(['fundamental']), input(config, [{ ...rows[0], date: '2026-10-09' }]))
    history.undo()
    expect(change).toHaveBeenCalledTimes(1)
    expect(config.fundamental.enabled).toBe(true)
    view.destroy()
    history.redo()
    expect(change).toHaveBeenCalledTimes(1)
  })
  it('keeps the public history replay muted even when its actions attempt to push history', async () => {
    const workspace = await createHeadlessWorkspace(document.createElement('div'), rows)
    state.workspaces.push(workspace)
    const history = workspace.active.history
    const undo = vi.fn(() => history.push({ undo() {}, redo() {} }))
    const redo = vi.fn(() => history.push({ undo() {}, redo() {} }))
    history.push({ undo, redo })
    history.undo()
    expect(undo).toHaveBeenCalledOnce()
    expect(history.canUndo).toBe(false)
    history.redo()
    expect(redo).toHaveBeenCalledOnce()
    expect(history.canRedo).toBe(false)
  })
})
