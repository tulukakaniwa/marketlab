// src/composables/useBreakpoint.js
// 统一的响应式断点信号，避免组件各自定义 matchMedia。
import { onBeforeUnmount, onMounted, ref } from 'vue'

const QUERIES = {
  mobile: '(max-width: 768px)',
  tablet: '(max-width: 1024px)',
}

export function useBreakpoint() {
  const isMobile = ref(false)
  const isTablet = ref(false)
  let mqMobile = null
  let mqTablet = null

  function syncMobile() { isMobile.value = mqMobile?.matches ?? false }
  function syncTablet() { isTablet.value = mqTablet?.matches ?? false }

  // 同步初始化：保证首次渲染就拿到正确断点值，避免一帧错位
  // SSR 安全：typeof window 守卫会跳过非浏览器环境
  if (typeof window !== 'undefined' && window.matchMedia) {
    mqMobile = window.matchMedia(QUERIES.mobile)
    mqTablet = window.matchMedia(QUERIES.tablet)
    syncMobile()
    syncTablet()
  }

  onMounted(() => {
    mqMobile?.addEventListener('change', syncMobile)
    mqTablet?.addEventListener('change', syncTablet)
  })

  onBeforeUnmount(() => {
    mqMobile?.removeEventListener('change', syncMobile)
    mqTablet?.removeEventListener('change', syncTablet)
  })

  return { isMobile, isTablet }
}
