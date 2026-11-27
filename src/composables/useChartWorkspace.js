import { computed, onScopeDispose, ref, shallowRef } from 'vue'
import { CHART_ENGINE_IDS } from '../domain/research-visualization/chartEngines.js'

/**
 * 主行情工作台唯一绑定 Vela 研究图；异步加载并支持启动异常后的显式重试。
 */
export function useChartWorkspace({ loadVelaComponent = () => import('../components/VelaChart.vue') } = {}) {
  const activeComponent = shallowRef(null)
  const state = ref('idle')
  const fallbackError = ref('')
  const engine = ref(CHART_ENGINE_IDS.VELA)
  let generation = 0

  onScopeDispose(() => {
    generation++
  })

  const loading = computed(() => state.value === 'loading')

  async function load({ force = false } = {}) {
    if (activeComponent.value && !force) return activeComponent.value
    const current = ++generation
    fallbackError.value = ''
    state.value = 'loading'
    try {
      const module = await loadVelaComponent()
      if (current !== generation) return null
      const component = module?.default ?? module
      if (!component) throw new Error('Vela 图表组件未导出')
      activeComponent.value = component
      state.value = 'ready'
      return component
    } catch (error) {
      if (current !== generation) return null
      fallback(error)
      return null
    }
  }

  function fallback(error) {
    const message = error instanceof Error ? error.message : String(error ?? '')
    fallbackError.value = `Vela 研究图启动失败：${message}`
    activeComponent.value = null
    state.value = 'error'
  }

  function confirmReady() {
    fallbackError.value = ''
    state.value = 'ready'
  }

  function retry() {
    return load({ force: true })
  }

  load()

  return {
    engine,
    displayEngine: engine,
    activeComponent,
    loading,
    fallbackError,
    fallback,
    confirmReady,
    retry,
  }
}
