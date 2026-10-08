import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLabStore } from '../labStore.js'

describe('independent centers preserve planning CQRS boundary', () => {
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
  async function settle() {
    await vi.runAllTimersAsync()
    await nextTick()
  }

  it('uses imported trade amounts only after an explicit unit conversion', async () => {
    const lab = useLabStore()
    lab.importText(
      'date,open,high,low,close,volume,amount\n2026-01-01,10,11,9,10,100,900\n2026-01-02,20,22,18,20,100,1800',
      'amount-csv',
    )
    await settle()
    expect(lab.sourceKey).toBe('amount-csv')
    expect(lab.graph.marketCenters.formulas.vwapCost.value).toBeNull()
    expect(lab.graph.marketCenters.formulas.vwapCost.source.kind).toBe('amount-volume')
    lab.setCenterInput({ formula: 'vwapCost', key: 'amountPerVolumeToPrice', value: 1, sourceKey: lab.sourceKey })
    await settle()
    expect(lab.graph.marketCenters.formulas.vwapCost.value).toBe(13.5)
  })

  it('publishes separate scoped queries and settings without changing plan or scenario prices', async () => {
    const lab = useLabStore()
    const csv = [
      'date,open,high,low,close,volume',
      ...Array.from({ length: 81 }, (_, i) => {
        const day = new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10)
        const close = 100 + Math.sin(i)
        return `${day},${close},105,95,${close},100`
      }),
    ].join('\n')
    lab.importText(csv, 'center-a')
    lab.setTdpyOverride('center-a', 252)
    await settle()
    const before = JSON.stringify({ input: lab.input, position: lab.graph.position, decision: lab.graph.decision })
    for (const [key, value] of [
      ['a', 200],
      ['b', 1],
      ['c', 0],
      ['d', 1],
    ])
      lab.setCenterInput({ formula: 'supplyDemand', key, value })
    lab.setCenterInput({ formula: 'supplyDemand', key: 'apply', value: true })
    expect(lab.graph.marketCenters).toBeNull()
    expect(lab.centerPath).toEqual([])
    await settle()
    expect(lab.graph.marketCenters.formulas.supplyDemand.value).toBe(100)
    expect(JSON.stringify({ input: lab.input, position: lab.graph.position, decision: lab.graph.decision })).toBe(
      before,
    )
    lab.setCursorIndex(60)
    expect(lab.centerPath).toEqual([])
    await settle()
    expect(lab.graph.marketCenters.formulas.supplyDemand.value).toBeNull()
    lab.importText(csv, 'center-b')
    await settle()
    expect(lab.centerConfig.supplyDemand.enabled).toBe(false)
    expect(lab.graph.marketCenters.sourceKey).toBe('center-b')
  })
})
