import { computed, onScopeDispose, ref, watch } from 'vue'
import { useEthImpactResearchStore } from '../stores/ethImpactResearchStore.js'
import { buildImpactChartOverlay } from '../domain/market-impact/impactChartOverlay.js'

/** Independent research clock. No writes to the daily formula or order-plan state. */
export function useAlignedImpactView() {
  const research = useEthImpactResearchStore()
  const enabled = ref(false)
  const cursor = ref(0)
  const retentionNotice = ref('')
  onScopeDispose(() => research.live.stop({ persist: false }))
  const live = computed(() => research.liveSelected)
  const market = computed(() => (live.value ? research.live.market : research.market))
  const report = computed(() => (market.value?.phase === 'ready' ? market.value.report : null))
  const allRows = computed(() => report.value?.rows ?? [])
  const active = computed(() => enabled.value && allRows.value.length > 0)
  const rows = computed(() => allRows.value.slice(0, cursor.value + 1))
  const source = computed(() => report.value?.source ?? null)
  const impactMap = computed(() =>
    buildImpactChartOverlay({
      lp: research.lp,
      options: research.options,
      source: source.value,
      rows: rows.value,
      ...(live.value ? { lpHistory: research.live.lpHistory, optionsHistory: research.live.optionsHistory } : {}),
    }),
  )
  watch(
    allRows,
    (next, previous = []) => {
      const following = !previous.length || cursor.value === previous.length - 1
      const date = previous[cursor.value]?.date
      retentionNotice.value =
        !following && next.length && !next.some((row) => row.date === date)
          ? '所选时间已超出保留窗口，已移到最早可用行情。'
          : ''
      cursor.value = following
        ? Math.max(0, next.length - 1)
        : Math.max(
            0,
            next.findIndex((row) => row.date === date),
          )
    },
    { flush: 'sync' },
  )
  let shownActivation = 0
  watch(
    () => [research.live.activation, live.value, allRows.value.length],
    ([activation, selected, length]) => {
      if (selected && length && activation > shownActivation) {
        shownActivation = activation
        enabled.value = true
      }
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
    retentionNotice,
    live,
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
