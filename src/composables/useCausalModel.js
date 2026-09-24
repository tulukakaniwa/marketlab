import { getCurrentScope, onScopeDispose, shallowRef, watch } from 'vue'
import { buildCausalModelSnapshot } from '../domain/market-model/causalModel.js'

/**
 * Query scheduling belongs to the ViewModel. Only the selected, closed-session
 * prefix reaches the domain query; scenario inputs are deliberately absent.
 * A synchronous invalidation keeps old dates/assets out of the current view.
 */
export function useCausalModel(activeRows, tradingDaysPerYear, sourceKey, query = buildCausalModelSnapshot) {
  const snapshot = shallowRef(null)
  const queryState = shallowRef({ status: 'idle', reason: 'missing-data', sourceKey: '', asOfDate: null })
  let ticket = 0
  let timer = null

  const stop = watch(
    [activeRows, tradingDaysPerYear, sourceKey],
    ([rows, tdpy, key]) => {
      const currentTicket = ++ticket
      if (timer !== null) clearTimeout(timer)
      timer = null
      snapshot.value = null
      const context = { sourceKey: key ?? '', asOfDate: rows?.at(-1)?.date ?? null }
      if (!rows?.length || !Number.isFinite(tdpy) || tdpy <= 0) {
        queryState.value = { ...context, status: 'idle', reason: rows?.length ? 'missing-tdpy' : 'missing-data' }
        return
      }
      queryState.value = { ...context, status: 'computing', reason: null }
      // Capture this prefix; never read a later cursor from inside the callback.
      const prefix = rows.map((row) => ({ ...row }))
      timer = setTimeout(async () => {
        timer = null
        try {
          const result = await query({ rows: prefix, tradingDaysPerYear: tdpy })
          if (ticket !== currentTicket) return
          snapshot.value = { ...result, sourceKey: context.sourceKey }
          queryState.value = { ...context, status: 'ready', reason: null }
        } catch {
          if (ticket !== currentTicket) return
          queryState.value = { ...context, status: 'error', reason: 'query-failed' }
        }
      }, 0)
    },
    { immediate: true, flush: 'sync' },
  )

  function dispose() {
    ticket += 1
    if (timer !== null) clearTimeout(timer)
    timer = null
    stop()
  }
  if (getCurrentScope()) onScopeDispose(dispose)
  return { snapshot, queryState, dispose }
}
