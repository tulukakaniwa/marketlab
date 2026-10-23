import { reactive } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it } from 'vitest'
import { useImpactChartOverlay } from '../useImpactChartOverlay.js'
import { useEthImpactResearchStore } from '../../stores/ethImpactResearchStore.js'
import { analyzeEthOptionsBundle } from '../../domain/market-impact/ethOptionsResearch.js'
import { makeOptionsFixture } from '../../domain/market-impact/__tests__/optionsFixtures.js'

describe('research-to-chart read model', () => {
  it('clears immediately on import, clear, asset switch or earlier observation without changing plan inputs', () => {
    setActivePinia(createPinia())
    const research = useEthImpactResearchStore()
    const lab = reactive({
      source: { symbol: 'ETHUSDT' },
      activeRows: [{ date: '2026-10-23', close: 2000 }],
      input: { entryPrice: 2000, targetProfit: 0.3 },
    })
    const input = { ...lab.input }
    const result = useImpactChartOverlay(lab)
    const ready = { phase: 'ready', report: analyzeEthOptionsBundle(makeOptionsFixture()) }
    research.options = ready
    expect(result.value.path[0].nodes).toHaveLength(1)
    lab.source = { symbol: 'BTCUSDT' }
    expect(result.value.path[0].nodes).toEqual([])
    lab.source = { symbol: 'ETHUSDT' }
    lab.activeRows = [{ date: '2026-10-22', close: 2000 }]
    expect(result.value.path[0].nodes).toEqual([])
    lab.activeRows = [{ date: '2026-10-23', close: 2000 }]
    research.options = { phase: 'verifying', report: null }
    expect(result.value.path[0].nodes).toEqual([])
    research.options = ready
    research.clear('options')
    expect(result.value.path[0].nodes).toEqual([])
    expect(lab.input).toEqual(input)
  })
})
