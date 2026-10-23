import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'

export const ETH_IMPACT_FILE_LIMIT = 100 * 1024 * 1024
const empty = () => ({ phase: 'idle', filename: '', report: null, issues: [], hashVerified: false })
const defaultScenario = () => ({ enabled: false, hedgeRatio: 1, alreadyHedgedEth: 0 })
const makeWorker = () =>
  new Worker(new URL('../workers/ethImpactResearch.worker.js', import.meta.url), { type: 'module' })

/** ViewModel commands own file access and worker lifecycle; domain stays browser-free. */
export function createEthImpactResearchController({ workerFactory = makeWorker } = {}) {
  const lp = shallowRef(empty())
  const options = shallowRef(empty())
  const market = shallowRef(empty())
  const selectedAction = ref(0)
  const optionScenario = ref(defaultScenario())
  const lanes = {
    lp: { state: lp, file: null, worker: null, ticket: 0 },
    options: { state: options, file: null, worker: null, ticket: 0 },
    market: { state: market, file: null, worker: null, ticket: 0 },
  }
  const activeAction = computed(() => lp.value.report?.actions?.[selectedAction.value] ?? null)
  let disposed = false

  function invalidate(lane) {
    lane.ticket += 1
    lane.worker?.terminate()
    lane.worker = null
    return lane.ticket
  }

  async function calculate(kind) {
    const lane = lanes[kind]
    const ticket = invalidate(lane)
    if (disposed || !lane.file) return
    const file = lane.file
    const scenario = { ...optionScenario.value }
    lane.state.value = { ...empty(), phase: 'verifying', filename: file.name }
    if (!Number.isFinite(file.size) || file.size <= 0 || file.size > ETH_IMPACT_FILE_LIMIT) {
      lane.state.value = { ...lane.state.value, phase: 'blocked', issues: ['文件必须为 1 byte 至 100 MiB'] }
      return
    }
    try {
      const buffer = await file.arrayBuffer()
      if (ticket !== lane.ticket || disposed) return
      if (buffer.byteLength > ETH_IMPACT_FILE_LIMIT) throw new Error('file-size-limit')
      const worker = workerFactory()
      lane.worker = worker
      worker.onmessage = ({ data }) => {
        if (ticket !== lane.ticket || disposed || data?.id !== ticket) return
        if (data.phase === 'computing') {
          lane.state.value = { ...lane.state.value, phase: 'computing', hashVerified: true }
          return
        }
        const result = data.result
        if (!result) return
        const report = result.report ?? null
        lane.state.value = {
          filename: file.name,
          report,
          hashVerified: result.hashVerified === true,
          phase: report && report.status !== 'blocked' ? 'ready' : 'blocked',
          issues: result.issues ?? report?.issues ?? ['worker-result-missing'],
        }
        worker.terminate()
        if (lane.worker === worker) lane.worker = null
      }
      worker.onerror = () => {
        if (ticket !== lane.ticket || disposed) return
        lane.state.value = { ...lane.state.value, phase: 'blocked', issues: ['研究计算失败，请重新导入文件'] }
        worker.terminate()
        if (lane.worker === worker) lane.worker = null
      }
      worker.postMessage({ id: ticket, kind, buffer, scenario }, [buffer])
    } catch (error) {
      if (ticket !== lane.ticket || disposed) return
      lane.state.value = { ...lane.state.value, phase: 'blocked', issues: [error.message || '文件读取失败'] }
    }
  }

  function importFile(kind, file) {
    if (disposed || !lanes[kind] || !file) return
    lanes[kind].file = file
    if (kind === 'lp') selectedAction.value = 0
    if (kind === 'options') optionScenario.value = defaultScenario()
    return calculate(kind)
  }

  function selectAction(index) {
    const count = lp.value.report?.actions?.length ?? 0
    if (Number.isInteger(index) && index >= 0 && index < count) selectedAction.value = index
  }

  function setOptionScenario(next) {
    if (disposed) return
    optionScenario.value = { ...optionScenario.value, ...next }
    return calculate('options')
  }

  function clear(kind) {
    const lane = lanes[kind]
    if (!lane) return
    invalidate(lane)
    lane.file = null
    lane.state.value = empty()
    if (kind === 'options') optionScenario.value = defaultScenario()
    if (kind === 'lp') selectedAction.value = 0
  }

  function cancelPending() {
    Object.values(lanes).forEach((lane) => {
      invalidate(lane)
      if (['verifying', 'computing'].includes(lane.state.value.phase)) lane.state.value = empty()
    })
  }

  function dispose() {
    disposed = true
    cancelPending()
  }

  return {
    lp,
    options,
    market,
    selectedAction,
    activeAction,
    optionScenario,
    importFile,
    selectAction,
    setOptionScenario,
    clear,
    cancelPending,
    dispose,
  }
}

export const useEthImpactResearchStore = defineStore('eth-impact-research', () => createEthImpactResearchController())
