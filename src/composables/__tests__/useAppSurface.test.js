import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { APP_SURFACES, isLegacyPoolRedirect, resolveSurfaceFromLocation, useAppSurface } from '../useAppSurface.js'

afterEach(() => {
  window.history.replaceState({}, '', '/')
})

describe('useAppSurface unified entry router', () => {
  it('resolves workbench, eth-replay, and recommended-pool surfaces from URL contracts', () => {
    expect(resolveSurfaceFromLocation({ pathname: '/', search: '', hash: '' })).toBe(APP_SURFACES.WORKBENCH)
    expect(resolveSurfaceFromLocation({ pathname: '/', search: '?view=eth-replay', hash: '' })).toBe(
      APP_SURFACES.ETH_REPLAY,
    )
    expect(resolveSurfaceFromLocation({ pathname: '/recommended-pool/', search: '', hash: '' })).toBe(
      APP_SURFACES.RECOMMENDED_POOL,
    )
    expect(isLegacyPoolRedirect({ pathname: '/', search: '?pool=1', hash: '' })).toBe(true)
    expect(isLegacyPoolRedirect({ pathname: '/', search: '', hash: '#pool' })).toBe(true)
  })

  it('switches surfaces in-app with history pushState and handles Alt+P shortcut', async () => {
    const openPoolAssign = vi.fn()
    let api
    const Harness = defineComponent({
      setup() {
        api = useAppSurface({ openPoolAssign })
        return () => null
      },
    })
    const wrapper = mount(Harness)
    expect(api.surface.value).toBe(APP_SURFACES.WORKBENCH)

    api.navigateSurface(APP_SURFACES.ETH_REPLAY)
    expect(api.surface.value).toBe(APP_SURFACES.ETH_REPLAY)
    expect(window.location.search).toBe('?view=eth-replay')

    api.navigateSurface(APP_SURFACES.WORKBENCH)
    expect(api.surface.value).toBe(APP_SURFACES.WORKBENCH)
    expect(window.location.search).toBe('')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', altKey: true }))
    expect(openPoolAssign).toHaveBeenCalledWith('/recommended-pool/')
    wrapper.unmount()
  })
})
