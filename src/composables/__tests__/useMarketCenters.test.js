import { effectScope, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMarketCenters } from '../useMarketCenters.js'

describe('independent market-center ViewModel', () => {
  let scope
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.removeItem('lab.marketCenters.v1')
    scope = effectScope()
  })
  afterEach(() => {
    scope.stop()
    vi.useRealTimers()
  })
  const row = (date) => ({ date, close: 100, high: 101, low: 99, volume: 100 })
  function setup(query = vi.fn(({ rows }) => ({ asOfDate: rows.at(-1).date }))) {
    const rows = ref([row('2026-01-01')])
    const source = ref('asset-a')
    return { ...scope.run(() => useMarketCenters(rows, source, query)), rows, source, query }
  }

  it('captures immutable parameters/prefix and rejects late results after source changes', async () => {
    const pending = []
    const model = setup(({ rows, config }) => new Promise((resolve) => pending.push({ rows, config, resolve })))
    await vi.advanceTimersByTimeAsync(0)
    model.setInput({ formula: 'vwapCost', key: 'lookback', value: 80 })
    expect(model.snapshot.value).toBeNull()
    expect(pending[0].config.vwapCost.lookback).toBe(120)
    model.source.value = 'asset-b'
    model.rows.value = [row('2026-02-01')]
    await vi.advanceTimersByTimeAsync(0)
    pending.at(-1).resolve({ asOfDate: '2026-02-01' })
    await Promise.resolve()
    pending[0].resolve({ asOfDate: '2026-01-01' })
    await Promise.resolve()
    expect(model.snapshot.value).toMatchObject({ asOfDate: '2026-02-01', sourceKey: 'asset-b' })
    expect(model.config.value.vwapCost.lookback).toBe(120)
    model.source.value = 'asset-a'
    expect(model.config.value.vwapCost.lookback).toBe(80)
  })

  it('commands stamp explicit scenarios, preserve blank as missing, and require reapplying after a date change', () => {
    const model = setup()
    model.setInput({ formula: 'fundamental', key: 'nextDividend', value: '' })
    expect(model.config.value.fundamental.nextDividend).toBeNull()
    model.setInput({ formula: 'fundamental', key: 'nextDividend', value: '2' })
    model.setInput({ formula: 'fundamental', key: 'apply', value: true })
    expect(model.config.value.fundamental).toMatchObject({
      enabled: true,
      nextDividend: 2,
      provenance: { kind: 'scenario', asOfDate: '2026-01-01', availableAt: '2026-01-01:close' },
    })
    model.rows.value = [row('2026-01-01'), row('2026-01-02')]
    expect(model.config.value.fundamental.provenance.asOfDate).toBe('2026-01-01')
    model.setInput({ formula: 'fundamental', key: 'apply', value: true })
    expect(model.config.value.fundamental.provenance.asOfDate).toBe('2026-01-02')
  })

  it('source-scoped asynchronous imports and unknown commands cannot change current settings', () => {
    const model = setup()
    expect(model.setInput({ formula: 'cohortCost', key: 'document', value: '{}', sourceKey: 'asset-b' })).toBe(false)
    expect(model.setInput({ formula: 'statisticalCenter', key: 'lookback', value: 100, sourceKey: '' })).toBe(false)
    expect(model.config.value.cohortCost.freeFloat).toBeNull()
    expect(model.setInput({ formula: 'fundamental', key: 'entryPrice', value: 10 })).toBe(false)
    model.setInput({ formula: 'cohortCost', key: 'document', value: '{' })
    expect(model.config.value.cohortCost.importError).toBe('JSON 格式无效')
    expect(model.config.value.cohortCost.freeFloat).toBeNull()
  })

  it('persists source maps and does not schedule unchanged native inputs recursively', async () => {
    const model = setup()
    await vi.advanceTimersByTimeAsync(0)
    model.setInput({ formula: 'statisticalCenter', key: 'lookback', value: 120 })
    await vi.advanceTimersByTimeAsync(0)
    expect(model.query).toHaveBeenCalledTimes(1)
    model.setInput({ formula: 'statisticalCenter', key: 'lookback', value: 100 })
    await vi.advanceTimersByTimeAsync(250)
    expect(JSON.parse(localStorage.getItem('lab.marketCenters.v1'))['asset-a'].statisticalCenter.lookback).toBe(100)
    model.dispose()
    const restored = setup()
    expect(restored.config.value.statisticalCenter.lookback).toBe(100)
  })
})
