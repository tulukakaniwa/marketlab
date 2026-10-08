import { mount } from '@vue/test-utils'
import { defineComponent, h, markRaw, onBeforeUnmount, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ChartWorkspace from '../ChartWorkspace.vue'

const state = vi.hoisted(() => ({ workspaces: [] }))
vi.mock('../../composables/useChartWorkspace.js', () => ({
  useChartWorkspace() {
    const engine = markRaw(
      defineComponent({
        props: { drawingScope: { type: String, default: '' } },
        setup(props) {
          const history = ref(0)
          const session = { scope: props.drawingScope, disposed: false }
          state.workspaces.push(session)
          onBeforeUnmount(() => {
            session.disposed = true
          })
          return () => h('button', { onClick: () => history.value++ }, `history:${history.value}`)
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
