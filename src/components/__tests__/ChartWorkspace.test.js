import { mount } from '@vue/test-utils'
import { defineComponent, h, markRaw, onBeforeUnmount, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ChartWorkspace from '../ChartWorkspace.vue'

const state = vi.hoisted(() => ({ workspaces: [] }))
vi.mock('../../composables/useChartWorkspace.js', () => ({
  useChartWorkspace() {
    const engine = markRaw(
      defineComponent({
        name: 'TestNativeChart',
        props: {
          drawingScope: { type: String, default: '' },
          centerPath: { type: Array, default: () => [] },
          centerConfig: { type: Object, default: () => ({}) },
        },
        emits: ['center-input-change', 'ready', 'loading-change', 'fatal-error'],
        setup(props, { emit }) {
          const history = ref(0)
          const session = { scope: props.drawingScope, disposed: false }
          state.workspaces.push(session)
          onBeforeUnmount(() => {
            session.disposed = true
          })
          return () =>
            h(
              'button',
              {
                onClick: () => {
                  history.value++
                  emit('center-input-change', {
                    formula: 'vwapCost',
                    key: 'lookback',
                    value: 90,
                    sourceKey: props.drawingScope,
                  })
                },
              },
              `history:${history.value}`,
            )
        },
      }),
    )
    return {
      activeComponent: ref(engine),
      displayEngine: ref('vela'),
      engine: ref('vela'),
      requestedEngine: ref(null),
      loading: ref(false),
      fallbackError: ref(''),
      confirmReady: vi.fn(),
      fallback: vi.fn(),
      selectEngine: vi.fn(),
      retry: vi.fn(),
    }
  },
}))
beforeEach(() => {
  state.workspaces.length = 0
})

describe('native chart history scope', () => {
  it('passes independent center outputs/config to the native view and forwards its command unchanged', async () => {
    const centerPath = [{ date: '2026-10-08', vwapCostPrice: 10 }]
    const centerConfig = { vwapCost: { lookback: 120 } }
    const wrapper = mount(ChartWorkspace, {
      props: {
        rows: [],
        costPath: [],
        formulaPath: [],
        entryPrice: 10,
        replay: {},
        overlays: {},
        input: {},
        drawingScope: 'BTC',
        centerPath,
        centerConfig,
      },
    })
    const engine = wrapper.getComponent({ name: 'TestNativeChart' })
    expect(engine.props('centerPath')).toEqual(centerPath)
    expect(engine.props('centerConfig')).toEqual(centerConfig)
    engine.vm.$emit('ready')
    expect(wrapper.emitted('native-settings-change').at(-1)).toEqual([true])
    engine.vm.$emit('loading-change', true)
    expect(wrapper.emitted('native-settings-change').at(-1)).toEqual([false])
    engine.vm.$emit('ready')
    engine.vm.$emit('fatal-error', new Error('unavailable'))
    expect(wrapper.emitted('native-settings-change').at(-1)).toEqual([false])
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('center-input-change')).toEqual([
      [{ formula: 'vwapCost', key: 'lookback', value: 90, sourceKey: 'BTC' }],
    ])
    wrapper.unmount()
  })
  it('keeps history for data updates and creates a fresh native session for another source', async () => {
    const wrapper = mount(ChartWorkspace, {
      props: {
        rows: [],
        costPath: [],
        formulaPath: [],
        entryPrice: 10,
        replay: {},
        overlays: {},
        input: {},
        drawingScope: 'BTC',
      },
    })
    await wrapper.get('button').trigger('click')
    expect(wrapper.text()).toBe('history:1')
    await wrapper.setProps({ rows: [{ date: '2026-10-08', close: 10 }] })
    expect(wrapper.text()).toBe('history:1')
    expect(state.workspaces).toHaveLength(1)
    await wrapper.setProps({ drawingScope: '600519' })
    expect(wrapper.text()).toBe('history:0')
    expect(state.workspaces[0]).toEqual({ scope: 'BTC', disposed: true })
    expect(state.workspaces[1]).toEqual({ scope: '600519', disposed: false })
    wrapper.unmount()
    expect(state.workspaces[1].disposed).toBe(true)
  })
})
