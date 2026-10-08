import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'
import { CHART_ENGINE_IDS, normalizeChartEngine } from '../domain/research-visualization/chartEngines.js'
import { persistedRef } from './usePersisted.js'

export function useChartWorkspace({
  loadHqComponent = () => import('../components/HqChartTerminal.vue'),
  loadVelaComponent = () => import('../components/VelaChart.vue'),
} = {}) {
  const storedEngine = persistedRef('lab.chartEngine.v1', CHART_ENGINE_IDS.VELA)
  const components = shallowRef({})
  const states = ref({})
  const fallbackError = ref('')
  const requestedEngine = ref(null)
  const failedEngine = ref(null)
  const loaders = { hqchart: loadHqComponent, vela: loadVelaComponent }
  const generations = { hqchart: 0, vela: 0 }
  let requestSequence = 0
  let lastReady = null
  onScopeDispose(() => {
    requestSequence++
    for (const id of Object.keys(generations)) generations[id]++
  })
  const engine = computed(() => normalizeChartEngine(storedEngine.value))
  const displayEngine = computed(() => {
    const candidate = requestedEngine.value ?? engine.value
    return components.value[candidate] ? candidate : components.value[engine.value] ? engine.value : candidate
  })
  const activeComponent = computed(() => components.value[displayEngine.value] ?? null)
  const loading = computed(() => Boolean(requestedEngine.value) || states.value[engine.value] === 'loading')

  watch(
    engine,
    (next) => {
      if (storedEngine.value !== next) storedEngine.value = next
      if (!components.value[next] && states.value[next] !== 'error') selectEngine(next)
    },
    { immediate: true },
  )

  async function selectEngine(next, { force = false } = {}) {
    const id = normalizeChartEngine(next)
    const request = ++requestSequence
    fallbackError.value = ''
    if (engine.value === id && components.value[id] && !force) {
      requestedEngine.value = null
      return components.value[id]
    }
    requestedEngine.value = id
    if (components.value[id] && !force) return components.value[id]
    const generation = ++generations[id]
    states.value[id] = 'loading'
    try {
      const module = await loaders[id]()
      if (generation !== generations[id]) return null
      const component = module?.default ?? module
      if (!component) throw new Error('图表组件未导出')
      components.value = { ...components.value, [id]: component }
      states.value[id] = 'ready'
      return component
    } catch (error) {
      if (generation !== generations[id]) return null
      states.value[id] = 'error'
      if (request === requestSequence) fallback(error, id)
      return null
    }
  }

  function fallback(error, id = requestedEngine.value ?? engine.value) {
    failedEngine.value = id
    const message = error instanceof Error ? error.message : String(error ?? '')
    fallbackError.value = `${id === 'vela' ? 'Vela 研究图' : 'HQ 专业图'}启动失败：${message}`
    const next = { ...components.value }
    delete next[id]
    components.value = next
    states.value[id] = 'error'
    requestedEngine.value = null
    if (lastReady && lastReady !== id) storedEngine.value = lastReady
    else if (lastReady === id) lastReady = null
  }
  function confirmReady(id) {
    if (id !== (requestedEngine.value ?? engine.value)) return
    if (failedEngine.value === id) {
      fallbackError.value = ''
      failedEngine.value = null
    }
    requestedEngine.value = null
    lastReady = id
    storedEngine.value = id
  }
  function retry() {
    return selectEngine(failedEngine.value ?? engine.value, { force: true })
  }

  return {
    engine,
    displayEngine,
    activeComponent,
    loading,
    requestedEngine,
    failedEngine,
    fallbackError,
    selectEngine,
    fallback,
    confirmReady,
    retry,
  }
}
