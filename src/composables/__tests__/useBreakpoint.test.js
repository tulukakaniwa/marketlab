import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { useBreakpoint } from '../useBreakpoint.js'

describe('useBreakpoint', () => {
  let listeners = {}

  beforeEach(() => {
    listeners = {}
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: query === '(max-width: 768px)' ? true : false,
      addEventListener: (_event, cb) => { listeners[query] = cb },
      removeEventListener: () => { delete listeners[query] },
    }))
  })

  function harness() {
    const Comp = defineComponent({
      setup() {
        const bp = useBreakpoint()
        return () => h('div', { 'data-mobile': bp.isMobile.value, 'data-tablet': bp.isTablet.value })
      },
    })
    return mount(Comp)
  }

  it('mobile 媒体匹配时返回 isMobile=true', () => {
    const wrapper = harness()
    expect(wrapper.attributes('data-mobile')).toBe('true')
  })

  it('mq.change 事件后值会同步', async () => {
    const wrapper = harness()
    listeners['(max-width: 768px)']?.()
    listeners['(max-width: 1024px)']?.()
    await wrapper.vm.$nextTick()
    expect(wrapper.attributes('data-tablet')).toBe('false')
  })
})
