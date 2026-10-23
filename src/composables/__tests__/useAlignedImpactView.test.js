import { effectScope } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it } from 'vitest'
import { useAlignedImpactView } from '../useAlignedImpactView.js'
import { useEthImpactResearchStore } from '../../stores/ethImpactResearchStore.js'
import { analyzeEthOptionsBundle } from '../../domain/market-impact/ethOptionsResearch.js'
import { makeOptionsFixture } from '../../domain/market-impact/__tests__/optionsFixtures.js'

const ready = () => ({
  phase: 'ready',
  report: {
    source: { symbol: 'ETHUSDT', timeframe: '5m' },
    rows: ['11:55', '12:00', '12:05'].map((time) => {
      const start = Date.parse(`2026-10-23T${time}:00Z`)
      return { date: new Date(start).toISOString(), close: 2000, closeTime: start + 299999, isClosed: true }
    }),
  },
})

describe('aligned research view', () => {
  it('uses only the observation prefix and does not backdate a snapshot', () => {
    setActivePinia(createPinia())
    const scope = effectScope()
    const view = scope.run(useAlignedImpactView)
    const research = useEthImpactResearchStore()
    expect(view.show()).toBe(false)
    research.market = ready()
    research.options = { phase: 'ready', report: analyzeEthOptionsBundle(makeOptionsFixture()) }
    expect(view.show()).toBe(true)
    expect(view.rows.value).toHaveLength(3)
    const history = view.impactMap.value.path
    expect(history[0].nodes).toEqual([])
    expect(history[1].nodes).toHaveLength(1)
    view.setCursor(0)
    expect(view.rows.value).toHaveLength(1)
    expect(view.impactMap.value.path).toEqual(history.slice(0, 1))
    view.setCursor(1)
    expect(view.impactMap.value.path).toEqual(history.slice(0, 2))
    view.close()
    expect(view.active.value).toBe(false)
    expect(research.market.report.rows).toHaveLength(3)
    scope.stop()
  })

  it('clears stale data synchronously while a replacement import is unverified', () => {
    setActivePinia(createPinia())
    const scope = effectScope()
    const view = scope.run(useAlignedImpactView)
    const research = useEthImpactResearchStore()
    research.market = ready()
    view.show()
    research.market = { phase: 'verifying', report: null }
    expect(view.active.value).toBe(false)
    expect(view.rows.value).toEqual([])
    expect(view.impactMap.value.path).toEqual([])
    research.market = ready()
    expect(view.cursor.value).toBe(2)
    research.clear('market')
    expect(view.active.value).toBe(false)
    scope.stop()
  })
})
