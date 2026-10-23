import { defineComponent, onMounted, onUnmounted, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import { createPinia } from 'pinia'
import App from './App.vue'
import { useEthImpactResearchStore } from './stores/ethImpactResearchStore.js'

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
    setChartOverlay: vi.fn(),
    loadSample: vi.fn(),
  },
}))
vi.mock('./stores/labStore.js', () => ({ useLabStore: () => lab }))
vi.mock('./composables/useImpactChartOverlay.js', () => ({ useImpactChartOverlay: () => ref(null) }))
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
  const beforeRows = lab.activeRows
  const pinia = createPinia()
  const wrapper = mount(App, {
    global: {
      plugins: [pinia],
      stubs: {
        TopBar: { template: '<button @click="$emit(\'open-market-impact\')">研究</button>' },
        ChartWorkspace: chart,
        AlignedImpactChart: {
          name: 'AlignedImpactChart',
          props: ['rows', 'source', 'impactMap'],
          template: '<button data-test="daily" @click="$emit(\'return-daily\')">日线</button>',
        },
        LeftPanel: true,
        RightPanel: true,
        RecommendedPoolPage: true,
        MarketImpactResearchDialog: {
          props: ['open'],
          template:
            '<div v-show="open"><button data-test="return" @click="$emit(\'close\')">返回</button><button data-test="chart-link" @click="$emit(\'show-on-chart\')">主图</button></div>',
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
    expect(wrapper.get('[data-test="return"]').element.parentElement.style.display).toBe('none')
    expect(mounted).toHaveBeenCalledTimes(1)
    expect(unmounted).not.toHaveBeenCalled()
    expect(wrapper.get('input').element).toBe(input.element)
    expect(input.element.value).toBe('zoom and drawing state')
    expect(lab.input).toEqual(beforeInput)
    await wrapper.get('button').trigger('click')
    await wrapper.get('[data-test="chart-link"]').trigger('click')
    expect(lab.setChartOverlay).toHaveBeenCalledWith('impactReferenceMap', true)
    expect(lab.loadSample).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'ETHUSDT' }))
    expect(lab.input).toEqual(beforeInput)

    const research = useEthImpactResearchStore(pinia)
    const minuteRows = [0, 1].map((index) => ({
      date: new Date(Date.UTC(2026, 9, 23, 12, 40 + index * 5)).toISOString(),
      closeTime: Date.UTC(2026, 9, 23, 12, 45 + index * 5),
      open: 2400,
      high: 2410,
      low: 2390,
      close: 2405,
      volume: 10,
      isClosed: true,
    }))
    research.market = { phase: 'ready', report: { source: { symbol: 'ETHUSDT', timeframe: '5m' }, rows: minuteRows } }
    await wrapper.get('button').trigger('click')
    await wrapper.get('[data-test="chart-link"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-test="chart"]').element.style.display).toBe('none')
    expect(wrapper.findComponent({ name: 'AlignedImpactChart' }).props('rows')).toEqual(minuteRows)
    expect(wrapper.get('.cols').classes()).toContain('aligned-layout')
    expect(lab.activeRows).toBe(beforeRows)
    expect(lab.input).toEqual(beforeInput)
    expect(unmounted).not.toHaveBeenCalled()
    await wrapper.get('[data-test="daily"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-test="chart"]').element.style.display).not.toBe('none')
    expect(wrapper.get('.cols').classes()).not.toContain('aligned-layout')
    expect(input.element.value).toBe('zoom and drawing state')
    expect(mounted).toHaveBeenCalledTimes(1)

    // Explicit live activation opens the aligned view once; later updates keep
    // both the existing chart instance and any chosen daily view intact.
    research.liveSelected = true
    research.live.activation = 1
    research.live.marketSource = research.market.report.source
    research.live.marketHistory = [{ report: research.market.report }]
    research.live.marketRows = minuteRows
    await flushPromises()
    const liveChart = wrapper.findComponent({ name: 'AlignedImpactChart' }).vm
    research.live.marketRows = [...minuteRows, { ...minuteRows[1], date: '2026-10-23T12:50:00.000Z' }]
    await flushPromises()
    expect(wrapper.findComponent({ name: 'AlignedImpactChart' }).vm).toBe(liveChart)
    expect(lab.activeRows).toBe(beforeRows)
    expect(lab.input).toEqual(beforeInput)
    await wrapper.get('[data-test="daily"]').trigger('click')
    research.live.marketRows = [...research.live.marketRows, { ...minuteRows[1], date: '2026-10-23T12:55:00.000Z' }]
    await flushPromises()
    expect(wrapper.findComponent({ name: 'AlignedImpactChart' }).exists()).toBe(false)
    expect(unmounted).not.toHaveBeenCalled()
  } finally {
    wrapper.unmount()
  }
})
