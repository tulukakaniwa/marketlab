import { getCurrentScope, onScopeDispose, shallowRef, toValue, watch } from 'vue'
import { iteratePriceReferenceMap } from '../domain/research-visualization/priceReferenceMap.js'

const BATCH_SIZE = 32

/** Schedule the bounded-window historical query outside hot computed paths. */
export function usePriceReferenceMap(activeRows, sourceKey, enabled = true, query = null) {
  const snapshot = shallowRef(null)
  const queryState = shallowRef({ status: 'idle', reason: 'missing-data', sourceKey: '', asOfDate: null })
  let ticket = 0
  let timer = null
  let wakePendingBatch = null

  const stop = watch(
    [activeRows, sourceKey, () => toValue(enabled)],
    ([rows, key, isEnabled]) => {
      const currentTicket = ++ticket
      cancelScheduled()
      snapshot.value = null
      const context = { sourceKey: key ?? '', asOfDate: rows?.at(-1)?.date ?? null }
      if (!isEnabled || !rows?.length) {
        queryState.value = { ...context, status: 'idle', reason: isEnabled ? 'missing-data' : 'disabled' }
        return
      }
      queryState.value = { ...context, status: 'computing', reason: null }
      // Capture the selected prefix before deferral. No later asset or cursor
      // can leak into this request, and sparse gaps stay explicit invalid rows.
      const prefix = Array.from(rows, (row) => (row ? { ...row } : row))
      async function run() {
        try {
          if (!(await nextBatch()) || ticket !== currentTicket) return
          let result
          if (query) result = await query({ rows: prefix })
          else {
            const points = iteratePriceReferenceMap({ rows: prefix })
            let next
            do {
              for (let index = 0; index < BATCH_SIZE; index += 1) {
                next = points.next()
                if (next.done) break
              }
              if (next.done) break
              if (!(await nextBatch()) || ticket !== currentTicket) return
            } while (!next.done)
            result = next.value
          }
          if (ticket !== currentTicket) return
          snapshot.value = { ...result, sourceKey: context.sourceKey }
          queryState.value = { ...context, status: 'ready', reason: null }
        } catch {
          if (ticket !== currentTicket) return
          queryState.value = { ...context, status: 'error', reason: 'query-failed' }
        }
      }
      void run()
    },
    { immediate: true, flush: 'sync' },
  )

  function nextBatch() {
    return new Promise((resolve) => {
      wakePendingBatch = resolve
      timer = setTimeout(() => {
        timer = null
        wakePendingBatch = null
        resolve(true)
      }, 0)
    })
  }

  function cancelScheduled() {
    if (timer !== null) clearTimeout(timer)
    timer = null
    wakePendingBatch?.(false)
    wakePendingBatch = null
  }

  function dispose() {
    ticket += 1
    cancelScheduled()
    stop()
    snapshot.value = null
    queryState.value = { ...queryState.value, status: 'idle', reason: 'disposed' }
  }
  if (getCurrentScope()) onScopeDispose(dispose)
  return { snapshot, queryState, dispose }
}
