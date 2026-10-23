import { effectScope, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildPriceReferenceMap } from '../../domain/research-visualization/priceReferenceMap.js'
import { usePriceReferenceMap } from '../usePriceReferenceMap.js'

function sampleRows(length = 8) {
  return Array.from({ length }, (_, index) => ({
    date: new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10),
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 100,
  }))
}

describe('usePriceReferenceMap scheduling', () => {
  let scope
  beforeEach(() => {
    vi.useFakeTimers()
    scope = effectScope()
  })
  afterEach(() => {
    scope.stop()
    vi.useRealTimers()
  })

  function setup(query = null, initialRows = sampleRows(), isEnabled = true) {
    const rows = ref(initialRows)
    const source = ref('asset-a')
    const enabled = ref(isEnabled)
    const model = scope.run(() => usePriceReferenceMap(rows, source, enabled, query))
    return { ...model, rows, source, enabled }
  }

  it('defers and batches historical work, retaining every point and matching the pure domain result', async () => {
    const model = setup(null, sampleRows(130))
    expect(model.snapshot.value).toBeNull()
    expect(model.queryState.value.status).toBe('computing')
    await vi.advanceTimersByTimeAsync(0)
    expect(model.snapshot.value).toBeNull()
    expect(vi.getTimerCount()).toBe(1)
    await vi.runAllTimersAsync()
    expect(model.snapshot.value).toEqual({
      ...buildPriceReferenceMap({ rows: model.rows.value }),
      sourceKey: 'asset-a',
    })
    expect(model.snapshot.value.path).toHaveLength(130)
    expect(model.queryState.value.status).toBe('ready')
  })

  it('does not schedule disabled or missing-data queries and clears output synchronously on disable', async () => {
    const query = vi.fn(buildPriceReferenceMap)
    const model = setup(query, [], false)
    await vi.runAllTimersAsync()
    expect(model.queryState.value.reason).toBe('disabled')
    model.enabled.value = true
    expect(model.queryState.value.reason).toBe('missing-data')
    expect(query).not.toHaveBeenCalled()
    model.rows.value = sampleRows()
    await vi.runAllTimersAsync()
    expect(model.snapshot.value.status).toBe('ready')
    model.enabled.value = false
    expect(model.snapshot.value).toBeNull()
    expect(model.queryState.value.reason).toBe('disabled')
    await vi.runAllTimersAsync()
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('invalidates the old date synchronously and coalesces rapid cursor changes', async () => {
    const query = vi.fn(buildPriceReferenceMap)
    const model = setup(query)
    await vi.runAllTimersAsync()
    model.rows.value = sampleRows(9)
    expect(model.snapshot.value).toBeNull()
    model.rows.value = sampleRows(10)
    await vi.runAllTimersAsync()
    expect(query).toHaveBeenCalledTimes(2)
    expect(Object.keys(query.mock.calls[1][0])).toEqual(['rows'])
    expect(model.snapshot.value.path).toHaveLength(10)
  })

  it('captures copied prefix rows before deferred work starts', async () => {
    const query = vi.fn(buildPriceReferenceMap)
    const model = setup(query)
    model.rows.value[0].volume = 999
    await vi.runAllTimersAsync()
    expect(query.mock.calls[0][0].rows[0].volume).toBe(100)
  })

  it('cancels a partially completed batch when source changes', async () => {
    const model = setup(null, sampleRows(130))
    await vi.advanceTimersByTimeAsync(0)
    model.source.value = 'asset-b'
    model.rows.value = sampleRows(8)
    expect(model.snapshot.value).toBeNull()
    await vi.runAllTimersAsync()
    expect(model.snapshot.value.sourceKey).toBe('asset-b')
    expect(model.snapshot.value.path).toHaveLength(8)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ignores old promises after changing instrument or disabling', async () => {
    const pending = []
    const query = vi.fn(
      ({ rows }) => new Promise((resolve) => pending.push(() => resolve(buildPriceReferenceMap({ rows })))),
    )
    const model = setup(query)
    await vi.advanceTimersByTimeAsync(0)
    model.source.value = 'asset-b'
    model.rows.value = sampleRows(10)
    await vi.advanceTimersByTimeAsync(0)
    pending[1]()
    await Promise.resolve()
    expect(model.snapshot.value).toMatchObject({ sourceKey: 'asset-b', visibleRows: 10 })
    pending[0]()
    await Promise.resolve()
    expect(model.snapshot.value).toMatchObject({ sourceKey: 'asset-b', visibleRows: 10 })
    model.rows.value = sampleRows(11)
    await vi.advanceTimersByTimeAsync(0)
    model.enabled.value = false
    pending[2]()
    await Promise.resolve()
    expect(model.snapshot.value).toBeNull()
    expect(model.queryState.value.reason).toBe('disabled')
  })

  it('scope disposal stops scheduled batches and prevents pending requests from writing', async () => {
    const model = setup(null, sampleRows(130))
    await vi.advanceTimersByTimeAsync(0)
    scope.stop()
    await vi.runAllTimersAsync()
    expect(model.snapshot.value).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
    expect(model.queryState.value.reason).toBe('disposed')
  })

  it('does not publish an injected in-flight promise after scope disposal', async () => {
    let finish
    const model = setup(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    await vi.advanceTimersByTimeAsync(0)
    scope.stop()
    finish({ status: 'ready', path: [{ date: '2025-01-08' }] })
    await Promise.resolve()
    expect(model.snapshot.value).toBeNull()
    expect(model.queryState.value.reason).toBe('disposed')
  })

  it('ignores old request failure after a newer snapshot has arrived', async () => {
    let fail
    const query = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            fail = reject
          }),
      )
      .mockImplementation(buildPriceReferenceMap)
    const model = setup(query)
    await vi.advanceTimersByTimeAsync(0)
    model.rows.value = sampleRows(10)
    await vi.runAllTimersAsync()
    expect(model.snapshot.value.visibleRows).toBe(10)
    fail(new Error('stale request failure'))
    await Promise.resolve()
    expect(model.snapshot.value.visibleRows).toBe(10)
    expect(model.queryState.value.status).toBe('ready')
  })

  it('reports current query failure without stale output', async () => {
    const model = setup(() => {
      throw new Error('query failed')
    })
    await vi.runAllTimersAsync()
    expect(model.snapshot.value).toBeNull()
    expect(model.queryState.value).toMatchObject({ status: 'error', reason: 'query-failed', sourceKey: 'asset-a' })
  })
})
