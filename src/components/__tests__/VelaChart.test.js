import { flushPromises, mount } from '@vue/test-utils'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import VelaChart from '../VelaChart.vue'
const mocks = vi.hoisted(() => ({
  chart: {
    resize: vi.fn(),
    setTheme: vi.fn(),
    on: () => vi.fn(),
    drawings: { canUndo: () => false, canRedo: () => false, all: () => [], setTool: vi.fn() },
  },
  sync: vi.fn(async () => {}),
  whenReady: vi.fn(async () => {}),
  fit: vi.fn(),
  destroy: vi.fn(),
  setRows: vi.fn(async () => {}),
  setTheme: vi.fn(),
  resize: vi.fn(),
  exportDrawings: () => ({ version: 1, drawings: [] }),
  importDrawings: vi.fn(),
  painted: Promise.resolve(true),
}))
vi.mock('../../infrastructure/charting/velaChartAdapter.js', () => ({ createVelaChartAdapter: async () => mocks }))
vi.mock('../../composables/useBreakpoint.js', () => ({ useBreakpoint: () => ({ isMobile: { value: false } }) }))
class FakeObserver {
  observe = vi.fn()
  disconnect = vi.fn()
}
const oldResize = globalThis.ResizeObserver,
  oldMutation = globalThis.MutationObserver
globalThis.ResizeObserver = FakeObserver
globalThis.MutationObserver = FakeObserver
afterAll(() => {
  globalThis.ResizeObserver = oldResize
  globalThis.MutationObserver = oldMutation
})
beforeEach(() => vi.clearAllMocks())
const stubs = {
  ChartDisplayTools: true,
  ChartStatusBar: true,
  WorkbenchSummary: true,
}

describe('Vela research view', () => {
  it('reports synchronous renderer failures from overlay commands for workspace recovery', async () => {
    const wrapper = mount(VelaChart, { props: makeProps(makeRows()), global: { stubs } })
    await flushPromises()
    mocks.sync.mockImplementationOnce(() => {
      throw new Error('native renderer failed')
    })
    await wrapper.setProps({ overlays: { stockChipProfile: false, volume: false } })
    await flushPromises()
    expect(wrapper.emitted('fatal-error')[0][0].message).toBe('native renderer failed')
    wrapper.unmount()
  })
  it('fits only after data/scope commands and cleans up on unmount', async () => {
    const rows = makeRows()
    const wrapper = mount(VelaChart, { props: makeProps(rows), global: { stubs } })
    await flushPromises()
    expect(mocks.fit).toHaveBeenCalledTimes(1)
    expect(wrapper.emitted('ready')).toHaveLength(1)
    await wrapper.setProps({ entryPrice: 101, decision: { state: 'watch' } })
    await wrapper.setProps({ overlays: { stockChipProfile: false, volume: false } })
    expect(mocks.fit).toHaveBeenCalledTimes(1)
    await wrapper.setProps({ drawingScope: 'scope-b' })
    await flushPromises()
    expect(mocks.fit).toHaveBeenCalledTimes(2)
    await wrapper.setProps({ rows: rows.map((row) => ({ ...row })) })
    await flushPromises()
    expect(mocks.fit).toHaveBeenCalledTimes(3)
    wrapper.unmount()
    expect(mocks.destroy).toHaveBeenCalledTimes(1)
  })
  it('passes explicit domain gaps and point data without synthesizing formula values', async () => {
    const rows = makeManyRows(20)
    const wrapper = mount(VelaChart, {
      props: {
        ...makeProps(rows),
        overlays: { stockChipProfile: false, equityPane: true, kdjPane: true, rsiPane: true },
        replay: {
          equityCurve: [
            { date: rows[0].date, equity: 100000 },
            { date: rows[2].date, equity: 100200 },
          ],
        },
        causalPath: [
          { date: rows[1].date, equilibriumPrice: 101 },
          { date: rows[3].date, equilibriumPrice: 103 },
        ],
        formulaPath: [
          { date: rows[0].date, deltaUpper: 110, deltaLower: 90 },
          { date: rows[2].date, deltaUpper: 112, deltaLower: 92 },
        ],
      },
      global: { stubs },
    })
    await flushPromises()
    expect(points('causalEquilibrium')).toEqual([
      { time: rows[1].date, value: 101 },
      { time: rows[3].date, value: 103 },
    ])
    await wrapper.setProps({ causalPath: [] })
    expect(points('causalEquilibrium')).toBeUndefined()
    expect(points('deltaUpper')).toEqual([
      { time: rows[0].date, value: 110 },
      { time: rows[2].date, value: 112 },
    ])
    expect(points('equity')).toEqual([
      { time: rows[0].date, value: 100000 },
      { time: rows[2].date, value: 100200 },
    ])
    expect(points('mark')).toEqual(rows.map((row) => ({ time: row.date, value: rows.at(-1).close })))
    for (const key of ['kdjK', 'kdjJ', 'rsi'])
      expect(points(key).every((point) => Number.isFinite(point.value))).toBe(true)
    wrapper.unmount()
  })
})
function points(key) {
  return mocks.sync.mock.calls
    .at(-1)[0]
    .groups.flatMap((group) => group.series)
    .find((series) => series.id === key)?.points
}
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

function makeManyRows(count) {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + index
    return {
      date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
      open: close - 1,
      high: close + 1,
      low: close - 2,
      close,
      volume: 1000 + index,
    }
  })
}
