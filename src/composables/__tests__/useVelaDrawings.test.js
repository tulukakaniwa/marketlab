import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useVelaDrawings } from '../useVelaDrawings.js'
import {
  LEGACY_DRAWING_STORAGE_KEY,
  VELA_DRAWING_STORAGE_KEY,
} from '../../infrastructure/charting/velaDrawingPersistence.js'

beforeEach(() => window.localStorage.clear())

function harness() {
  let scope = 'BTC:1D',
    document = { version: 1, drawings: [] }
  const events = new Map(),
    off = vi.fn()
  const drawings = {
    canUndo: () => true,
    canRedo: () => false,
    all: () => document.drawings,
    setTool: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
  }
  const adapter = {
    chart: {
      drawings,
      on: (event, callback) => {
        events.set(event, callback)
        return off
      },
    },
    exportDrawings: () => document,
    importDrawings: (next) => {
      document = next
    },
  }
  const view = useVelaDrawings({ getAdapter: () => adapter, getScope: () => scope, getAnchorTime: () => 1000 })
  return {
    view,
    drawings,
    off,
    setScope: (next) => {
      scope = next
    },
    change: (next, event = 'drawing:edited') => {
      document = next
      events.get(event)()
    },
  }
}

describe('native drawing scope commands', () => {
  it('migrates once, keeps the old backup, and persists native undo/redo snapshot notifications', async () => {
    const old = JSON.stringify({ version: 1, byScope: { 'BTC:1D': [{ id: 'h', type: 'horizontal', price: 10 }] } })
    window.localStorage.setItem(LEGACY_DRAWING_STORAGE_KEY, old)
    const h = harness()
    h.view.attach()
    expect(h.view.count.value).toBe(1)
    h.change({ version: 1, drawings: [] }, 'drawing:selected')
    await Promise.resolve()
    expect(JSON.parse(window.localStorage.getItem(VELA_DRAWING_STORAGE_KEY)).byScope['BTC:1D'].drawings).toEqual([])
    expect(window.localStorage.getItem(LEGACY_DRAWING_STORAGE_KEY)).toBe(old)
    h.view.dispose()
    const reload = harness()
    reload.view.attach()
    expect(reload.view.count.value).toBe(0) // an empty native scope must never re-import the backup
    reload.view.undo()
    reload.view.redo()
    expect(reload.drawings.undo).toHaveBeenCalledOnce()
    expect(reload.drawings.redo).toHaveBeenCalledOnce()
    reload.view.dispose()
    expect(h.off).toHaveBeenCalledTimes(4)
  })
  it('flushes a pending edit to the outgoing symbol and restores scopes independently', async () => {
    const h = harness()
    h.view.attach()
    h.change({ version: 1, drawings: [{ id: 'native-fib', type: 'fibretracement', paneId: 'price', anchors: [] }] })
    h.setScope('AAPL:1D')
    h.view.loadScope()
    await Promise.resolve()
    expect(h.view.count.value).toBe(0)
    h.setScope('BTC:1D')
    h.view.loadScope()
    expect(h.view.count.value).toBe(1)
    h.view.dispose()
  })
})
