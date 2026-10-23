import { computed, ref, watch } from 'vue'
import { useEthImpactResearchStore } from '../stores/ethImpactResearchStore.js'
import { buildImpactChartOverlay } from '../domain/market-impact/impactChartOverlay.js'

/** Independent research clock. No writes to the daily formula or order-plan state. */
export function useAlignedImpactView() {
  const research = useEthImpactResearchStore()
  const enabled = ref(false)
  const cursor = ref(0)
  const report = computed(() => (research.market?.phase === 'ready' ? research.market.report : null))
  const allRows = computed(() => report.value?.rows ?? [])
  const active = computed(() => enabled.value && allRows.value.length > 0)
  const rows = computed(() => allRows.value.slice(0, cursor.value + 1))
  const source = computed(() => report.value?.source ?? null)
  const impactMap = computed(() =>
    buildImpactChartOverlay({ lp: research.lp, options: research.options, source: source.value, rows: rows.value }),
  )
  watch(
    report,
    () => {
      cursor.value = Math.max(0, allRows.value.length - 1)
    },
    { flush: 'sync' },
  )
  function show() {
    if (!allRows.value.length) return false
    cursor.value = allRows.value.length - 1
    enabled.value = true
    return true
  }
  function setCursor(value) {
    const index = Number(value)
    if (Number.isInteger(index)) cursor.value = Math.max(0, Math.min(index, allRows.value.length - 1))
  }
  return {
    active,
    report,
    allRows,
    rows,
    source,
    impactMap,
    cursor,
    show,
    setCursor,
    close: () => {
      enabled.value = false
    },
  }
}
