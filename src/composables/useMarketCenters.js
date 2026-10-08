import { computed, getCurrentScope, onScopeDispose, shallowRef, watch } from 'vue'
import { buildMarketCentersSnapshot, defaultMarketCenterConfig } from '../domain/market-model/marketCenters.js'
import { persistedRef } from './usePersisted.js'

const INPUT_KEYS = {
  statisticalCenter: ['lookback', 'minObservations'],
  vwapCost: ['lookback', 'amountPerVolumeToPrice'],
  supplyDemand: ['enabled', 'a', 'b', 'c', 'd'],
  fundamental: ['enabled', 'nextDividend', 'requiredReturn', 'growthRate'],
}

/** CQRS command owner; source-scoped settings and bounded queries stay outside hot computed state. */
export function useMarketCenters(activeRows, sourceKey, query = buildMarketCentersSnapshot) {
  const settings = persistedRef('lab.marketCenters.v1', {})
  const config = computed(() => {
    const saved = settings.value?.[sourceKey.value] ?? {}
    return Object.fromEntries(
      Object.entries(defaultMarketCenterConfig()).map(([key, defaults]) => [key, { ...defaults, ...saved[key] }]),
    )
  })
  const snapshot = shallowRef(null)
  const queryState = shallowRef({ status: 'idle', reason: 'missing-history', sourceKey: '', asOfDate: null })
  let ticket = 0
  let timer = null
  const stop = watch(
    [activeRows, sourceKey, config],
    ([rows, key, parameters]) => {
      const currentTicket = ++ticket
      if (timer !== null) clearTimeout(timer)
      timer = null
      snapshot.value = null
      const context = { sourceKey: key ?? '', asOfDate: rows?.at(-1)?.date ?? null }
      if (!rows?.length || !key) {
        queryState.value = { ...context, status: 'idle', reason: 'missing-history' }
        return
      }
      queryState.value = { ...context, status: 'computing', reason: null }
      const prefix = rows.map((row) => ({ ...row }))
      const captured = JSON.parse(JSON.stringify(parameters))
      timer = setTimeout(async () => {
        timer = null
        try {
          const result = await query({ rows: prefix, config: captured })
          if (ticket !== currentTicket) return
          snapshot.value = { ...result, sourceKey: context.sourceKey }
          queryState.value = { ...context, status: 'ready', reason: null }
        } catch {
          if (ticket === currentTicket) queryState.value = { ...context, status: 'error', reason: 'query-failed' }
        }
      }, 0)
    },
    { immediate: true, flush: 'sync', deep: true },
  )

  function setInput({ formula, key, value, sourceKey: commandScope } = {}) {
    const scope = sourceKey.value
    const date = activeRows.value?.at(-1)?.date
    if (!scope || !date || (commandScope !== undefined && commandScope !== scope)) return false
    const next = JSON.parse(JSON.stringify(config.value))
    if (formula === 'cohortCost' && key === 'document') {
      try {
        next.cohortCost.freeFloat = value ? JSON.parse(value) : null
        next.cohortCost.importError = null
      } catch {
        next.cohortCost.freeFloat = null
        next.cohortCost.importError = 'JSON 格式无效'
      }
    } else {
      const apply = key === 'apply' && ['supplyDemand', 'fundamental'].includes(formula)
      if (!apply && !INPUT_KEYS[formula]?.includes(key)) return false
      const parsed = key === 'enabled' ? value === true : value === '' || value === null ? null : Number(value)
      if (key !== 'enabled' && parsed !== null && !Number.isFinite(parsed)) return false
      if (!apply && next[formula][key] === parsed) return true
      if (apply) next[formula].enabled = true
      else next[formula][key] = parsed
      if (['supplyDemand', 'fundamental'].includes(formula)) {
        next[formula].provenance = {
          kind: 'scenario',
          source: 'user-declared-scenario',
          asOfDate: date,
          availableAt: `${date}:close`,
        }
      }
    }
    settings.value = { ...settings.value, [scope]: next }
    return true
  }

  function dispose() {
    ++ticket
    if (timer !== null) clearTimeout(timer)
    stop()
  }
  if (getCurrentScope()) onScopeDispose(dispose)
  return { config, snapshot, queryState, setInput, dispose }
}
