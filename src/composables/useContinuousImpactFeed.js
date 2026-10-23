import { computed, ref, shallowRef } from 'vue'
import { appendResearchSnapshots, mergeResearchMarketRows } from '../domain/market-impact/researchTimeline.js'
import {
  isLoopbackPage,
  LIVE_FILE_LIMIT,
  LIVE_MANIFEST_LIMIT,
  readBoundedResponse,
  validateLiveManifest,
  verifyLiveBundle,
} from './continuousImpactTransport.js'

export const LIVE_PREFERENCE_KEY = 'lab.continuousResearch.enabled.v1'
export function livePreference() {
  try {
    return globalThis.localStorage?.getItem(LIVE_PREFERENCE_KEY) === 'true'
  } catch {
    return false
  }
}
function savePreference(enabled) {
  try {
    globalThis.localStorage?.setItem(LIVE_PREFERENCE_KEY, String(enabled))
  } catch {
    /* Optional local preference. */
  }
}
const makeWorker = () =>
  new Worker(new URL('../workers/ethImpactResearch.worker.js', import.meta.url), { type: 'module' })
const emptyState = () => ({
  phase: 'idle',
  error: '',
  sessionId: '',
  lastSuccessAt: null,
  nextPollAt: null,
  lanes: {},
  issues: [],
})
const fingerprint = (record) => `${record.kind}|${record.availableAt}|${record.receivedAt}|${record.sha256}`

/** Commands poll a same-origin local service; verified history stays separate from manual imports. */
export function createContinuousImpactFeed({
  fetchImpl = (...args) => fetch(...args),
  workerFactory = makeWorker,
  location = globalThis.location,
  now = Date.now,
  pollMs = 15000,
} = {}) {
  const supported = isLoopbackPage(location)
  const running = ref(false)
  const activation = ref(0)
  const state = shallowRef(emptyState())
  const lpHistory = shallowRef([])
  const optionsHistory = shallowRef([])
  const marketHistory = shallowRef([])
  const marketRows = shallowRef([])
  const marketSource = shallowRef(null)
  const lastMarketReport = computed(() => marketHistory.value.at(-1)?.report ?? null)
  const market = computed(() => ({
    phase: lastMarketReport.value ? 'ready' : 'idle',
    report: lastMarketReport.value
      ? { ...lastMarketReport.value, source: marketSource.value, rows: marketRows.value }
      : null,
  }))
  const histories = { lp: lpHistory, options: optionsHistory, market: marketHistory }
  const processed = new Map()
  let ticket = 0
  let timer = null
  let request = null
  let disposed = false
  let busy = false
  let workerId = 0

  function patch(change) {
    state.value = { ...state.value, ...change }
  }
  function schedule() {
    clearTimeout(timer)
    if (!running.value || disposed) return
    patch({ nextPollAt: new Date(now() + pollMs).toISOString() })
    timer = setTimeout(refresh, pollMs)
  }
  function accept(record, report) {
    if (
      record.kind === 'market' &&
      marketSource.value &&
      ['symbol', 'timeframe', 'provider'].some((key) => marketSource.value[key] !== report.source?.[key])
    )
      throw new Error('持续行情来源或周期发生变化，请刷新页面重新接入')
    const history = histories[record.kind]
    const next = appendResearchSnapshots(history.value, [{ ...record, report }], { limit: 288 })
    const accepted = next.snapshots.some((item) => item.id === record.id)
    if (!accepted) throw new Error(next.issues.map((item) => item.reason).join(' · ') || '快照未通过时间核验')
    history.value = next.snapshots
    let issues = next.issues
    if (record.kind === 'market') {
      const merged = mergeResearchMarketRows(marketRows.value, report.rows, { limit: 1000 })
      if (!marketSource.value) marketSource.value = report.source
      if (merged.rows.length !== marketRows.value.length || merged.rows.at(-1)?.date !== marketRows.value.at(-1)?.date)
        marketRows.value = merged.rows
      issues = [...issues, ...merged.issues]
    }
    patch({ issues: [...state.value.issues, ...issues].slice(-20) })
    processed.set(record.id, fingerprint(record))
    // Bound dedup metadata to retained histories and the latest manifest window.
    if (processed.size > 1728) {
      const keep = new Set(Object.values(histories).flatMap((history) => history.value.map((item) => item.id)))
      for (const id of processed.keys()) if (!keep.has(id)) processed.delete(id)
    }
  }

  async function refresh() {
    if (!supported || disposed || busy) return false
    clearTimeout(timer)
    busy = true
    const current = ++ticket
    const controller = new AbortController()
    request = controller
    const timeout = setTimeout(() => controller.abort(), 120000)
    patch({ phase: 'connecting', error: '', nextPollAt: null })
    try {
      const response = await fetchImpl('/api/research-live/manifest', {
        signal: controller.signal,
        cache: 'no-store',
        redirect: 'error',
      })
      const buffer = await readBoundedResponse(response, LIVE_MANIFEST_LIMIT, controller.signal)
      const manifest = validateLiveManifest(JSON.parse(new TextDecoder().decode(buffer)))
      if (current !== ticket || disposed) return false
      patch({
        sessionId: manifest.sessionId,
        lanes: manifest.lanes ?? {},
        retention: manifest.retention ?? null,
        phase: 'verifying',
      })
      const errors = []
      for (const record of [...manifest.records].sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt))) {
        if (current !== ticket || disposed) return false
        const previous = processed.get(record.id)
        if (previous) {
          if (previous !== fingerprint(record)) errors.push('已核验快照的时间被改写，已忽略')
          continue
        }
        try {
          const result = await fetchImpl(`/api/research-live${record.url}`, {
            signal: controller.signal,
            cache: 'no-store',
            redirect: 'error',
          })
          const bytes = await readBoundedResponse(result, LIVE_FILE_LIMIT, controller.signal)
          const report = await verifyLiveBundle({
            record,
            buffer: bytes,
            workerFactory,
            signal: controller.signal,
            id: ++workerId,
          })
          if (current !== ticket || disposed) return false
          accept(record, report)
        } catch (error) {
          if (controller.signal.aborted) throw error
          errors.push(`${record.kind}: ${error.message}`)
        }
      }
      patch({
        phase: errors.length ? 'degraded' : 'ready',
        error: errors.slice(0, 3).join(' · '),
        lastSuccessAt: new Date(now()).toISOString(),
      })
      return !errors.length
    } catch (error) {
      if (current === ticket && !disposed) patch({ phase: 'error', error: error.message || '本地采集服务未启动' })
      return false
    } finally {
      clearTimeout(timeout)
      if (current === ticket) {
        busy = false
        request = null
        schedule()
      }
    }
  }
  function start() {
    if (!supported || disposed || running.value) return false
    running.value = true
    savePreference(true)
    activation.value++
    void refresh()
    return true
  }
  function stop({ persist = true } = {}) {
    running.value = false
    if (persist) savePreference(false)
    ticket++
    clearTimeout(timer)
    request?.abort()
    request = null
    busy = false
    patch({ phase: 'paused', nextPollAt: null })
  }
  function dispose() {
    stop({ persist: false })
    disposed = true
  }
  return {
    supported,
    running,
    activation,
    state,
    lpHistory,
    optionsHistory,
    marketHistory,
    marketRows,
    marketSource,
    market,
    start,
    stop,
    refresh,
    dispose,
  }
}
