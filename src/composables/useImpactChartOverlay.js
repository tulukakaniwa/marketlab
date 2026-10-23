import { computed } from 'vue'
import { useEthImpactResearchStore } from '../stores/ethImpactResearchStore.js'
import { buildImpactChartOverlay } from '../domain/market-impact/impactChartOverlay.js'

/** Read-only projection. Imported research never enters the order-plan graph. */
export function useImpactChartOverlay(lab) {
  const research = useEthImpactResearchStore()
  return computed(() =>
    buildImpactChartOverlay({
      lp: research.lp,
      options: research.options,
      source: lab.source,
      rows: lab.activeRows,
    }),
  )
}
