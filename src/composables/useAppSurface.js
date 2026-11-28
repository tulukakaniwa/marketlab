import { onBeforeUnmount, onMounted, ref } from 'vue'

export const APP_SURFACES = Object.freeze({
  WORKBENCH: 'workbench',
  ETH_REPLAY: 'eth-replay',
  RECOMMENDED_POOL: 'recommended-pool',
})

const STATIC_POOL_PATH = '/recommended-pool/'

export function resolveSurfaceFromLocation(loc = typeof window !== 'undefined' ? window.location : null) {
  if (!loc) return APP_SURFACES.WORKBENCH
  const pathname = (loc.pathname || '').replace(/\/+$/, '')
  if (pathname.startsWith('/recommended-pool')) return APP_SURFACES.RECOMMENDED_POOL
  const params = new URLSearchParams(loc.search || '')
  const view = params.get('view')
  if (view === APP_SURFACES.ETH_REPLAY) return APP_SURFACES.ETH_REPLAY
  if (view === APP_SURFACES.RECOMMENDED_POOL) return APP_SURFACES.RECOMMENDED_POOL
  return APP_SURFACES.WORKBENCH
}

export function isLegacyPoolRedirect(loc = typeof window !== 'undefined' ? window.location : null) {
  if (!loc) return false
  const hash = (loc.hash || '').toLowerCase()
  const params = new URLSearchParams(loc.search || '')
  return hash === '#pool' || hash === '#recommended-pool' || params.get('pool') === '1'
}

/**
 * 全站统一表面路由与全局快捷键控制：
 * 收敛原分散在 main.js（?view=eth-replay）与 App.vue（/recommended-pool、#pool、g p、冲击弹窗）的多套入口。
 */
export function useAppSurface({ onEscapeCompact, openPoolAssign } = {}) {
  const surface = ref(resolveSurfaceFromLocation())
  const impactResearchOpen = ref(false)
  const impactResearchVisited = ref(false)
  let chordTimer = null
  let chordPrev = ''

  function openStaticRecommendedPool() {
    if (typeof openPoolAssign === 'function') {
      openPoolAssign(STATIC_POOL_PATH)
      return
    }
    if (typeof window !== 'undefined') {
      window.location.assign(STATIC_POOL_PATH)
    }
  }

  function navigateSurface(next) {
    const target = Object.values(APP_SURFACES).includes(next) ? next : APP_SURFACES.WORKBENCH
    surface.value = target
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    if (target === APP_SURFACES.WORKBENCH) {
      url.searchParams.delete('view')
      if (url.pathname.replace(/\/+$/, '').startsWith('/recommended-pool')) url.pathname = '/'
      document.title = 'Market Lab'
    } else {
      url.searchParams.set('view', target)
    }
    window.history.pushState({ surface: target }, '', `${url.pathname}${url.search}${url.hash}`)
  }

  function openImpactResearch() {
    impactResearchVisited.value = true
    impactResearchOpen.value = true
  }

  function closeImpactResearch() {
    impactResearchOpen.value = false
  }

  function onPopState() {
    surface.value = resolveSurfaceFromLocation()
  }

  function onGlobalKeydown(event) {
    if (event.key === 'Escape' && onEscapeCompact?.()) {
      return
    }
    const target = event.target
    const tag = target?.tagName?.toLowerCase()
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) return

    if (event.altKey && (event.key === 'p' || event.key === 'P')) {
      event.preventDefault()
      openStaticRecommendedPool()
      return
    }
    const key = event.key?.toLowerCase()
    if (key === 'g') {
      chordPrev = 'g'
      clearTimeout(chordTimer)
      chordTimer = setTimeout(() => {
        chordPrev = ''
      }, 800)
      return
    }
    if (key === 'p' && chordPrev === 'g') {
      chordPrev = ''
      clearTimeout(chordTimer)
      openStaticRecommendedPool()
      return
    }
    chordPrev = ''
  }

  onMounted(() => {
    if (typeof window === 'undefined') return
    if (isLegacyPoolRedirect(window.location)) {
      openStaticRecommendedPool()
      return
    }
    surface.value = resolveSurfaceFromLocation(window.location)
    window.addEventListener('popstate', onPopState)
    window.addEventListener('keydown', onGlobalKeydown)
  })

  onBeforeUnmount(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('popstate', onPopState)
      window.removeEventListener('keydown', onGlobalKeydown)
    }
    if (chordTimer) clearTimeout(chordTimer)
  })

  return {
    surface,
    navigateSurface,
    impactResearchOpen,
    impactResearchVisited,
    openImpactResearch,
    closeImpactResearch,
  }
}
