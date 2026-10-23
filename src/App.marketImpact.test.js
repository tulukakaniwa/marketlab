import { defineComponent, onMounted, onUnmounted, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import App from './App.vue'

const { lab } = vi.hoisted(() => ({
  lab: {
    input: { strategyProfile: 'balanced', entryPrice: 2500 },
    rows: [{ close: 2500 }],
    activeRows: [{ close: 2500 }],
    marketSamples: [],
    featureFlags: { replayAutoProfile: false },
    strategyProfileList: [],
    leftPanelOpen: false,
    rightPanelOpen: false,
    leftPanelW: 300,
    rightPanelW: 300,
    activeLeftTab: 'compute',
  },
}))
vi.mock('./stores/labStore.js', () => ({ useLabStore: () => lab }))
vi.mock('./composables/useBreakpoint.js', () => ({ useBreakpoint: () => ({ isCompact: ref(false) }) }))
vi.mock('./composables/usePersisted.js', () => ({
  persistedRef: (_key, value) => ref(value),
  clearPersistedLab: vi.fn(),
}))

it('keeps the same chart mounted and planning inputs unchanged across research open/close', async () => {
  const mounted = vi.fn()
  const unmounted = vi.fn()
  const chart = defineComponent({
    setup() {
      onMounted(mounted)
      onUnmounted(unmounted)
    },
    template: '<div data-test="chart"><input aria-label="chart-state" /></div>',
  })
  const beforeInput = { ...lab.input }
  const wrapper = mount(App, {
    global: {
      stubs: {
        TopBar: { template: '<button @click="$emit(\'open-market-impact\')">研究</button>' },
        ChartWorkspace: chart,
        LeftPanel: true,
        RightPanel: true,
        RecommendedPoolPage: true,
        MarketImpactResearchDialog: {
          props: ['open'],
          template: '<button v-show="open" data-test="return" @click="$emit(\'close\')">返回</button>',
        },
      },
    },
  })
  try {
    const input = wrapper.get('input')
    await input.setValue('zoom and drawing state')
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-test="return"]').isVisible()).toBe(true)
    await wrapper.get('[data-test="return"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-test="return"]').element.style.display).toBe('none')
    expect(mounted).toHaveBeenCalledTimes(1)
    expect(unmounted).not.toHaveBeenCalled()
    expect(wrapper.get('input').element).toBe(input.element)
    expect(input.element.value).toBe('zoom and drawing state')
    expect(lab.input).toEqual(beforeInput)
  } finally {
    wrapper.unmount()
  }
})
