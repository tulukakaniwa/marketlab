import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLabStore } from '../labStore.js'

const dateAt = (index) => new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10)
const csv = (base = 100) =>
  [
    'date,open,high,low,close,volume',
    ...Array.from(
      { length: 100 },
      (_, i) => `${dateAt(i)},${base + i},${base + i + 1},${base + i - 1},${base + i},1000`,
    ),
  ].join('\n')

describe('lab price reference map integration', () => {
  let pinia
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
    pinia = createPinia()
    setActivePinia(pinia)
  })
  afterEach(() => {
    disposePinia(pinia)
    vi.useRealTimers()
  })
  const settle = async () => {
    await nextTick()
    await vi.runAllTimersAsync()
  }
  it('queries only observation prefix, independently of scenario parameters; invalidates on asset, cursor and toggle', async () => {
    const lab = useLabStore()
    lab.importText(csv(), 'reference-a')
    lab.setObservationDate(dateAt(40))
    await settle()
    const snapshot = lab.priceReferenceMap
    expect(snapshot).toMatchObject({
      asOfDate: dateAt(40),
      visibleRows: 41,
      executionAuthority: 'none',
      futureRowsUsed: false,
    })
    lab.input.iv = 3
    lab.input.entryPrice = 10
    lab.input.holdingDays = 999
    await settle()
    expect(lab.priceReferenceMap).toBe(snapshot)
    lab.setObservationDate(dateAt(20))
    expect(lab.priceReferenceMap).toBeNull()
    await settle()
    expect(lab.priceReferenceMap.path).toEqual(snapshot.path.slice(0, 21))
    lab.chartOverlays.priceReferenceMap = false
    expect(lab.priceReferenceMap).toBeNull()
    expect(lab.priceReferenceQuery.reason).toBe('disabled')
    lab.chartOverlays.priceReferenceMap = true
    await settle()
    expect(lab.priceReferenceMap.asOfDate).toBe(dateAt(20))
    lab.importText(csv(200), 'reference-b')
    expect(lab.priceReferenceMap).toBeNull()
    await settle()
    expect(lab.priceReferenceMap.sourceKey).toBe('reference-b')
  })
})
