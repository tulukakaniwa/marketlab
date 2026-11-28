import { watch } from 'vue'
import { persistedRef } from './usePersisted.js'

export function useTheme() {
  const theme = persistedRef('lab.theme.v2', 'dark')

  function applyTheme(next) {
    if (typeof document === 'undefined') return
    document.documentElement.classList.toggle('dark', next === 'dark')
  }

  applyTheme(theme.value)
  watch(theme, applyTheme)

  function toggleTheme() {
    theme.value = theme.value === 'dark' ? 'light' : 'dark'
  }

  function setTheme(next) {
    theme.value = next === 'dark' ? 'dark' : 'light'
  }

  return {
    theme,
    toggleTheme,
    setTheme,
  }
}
