import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ChartDisplayTools from '../ChartDisplayTools.vue'

describe('ChartDisplayTools', () => {
  it('直接显示成交量、筹码和主图对数状态并发出切换命令', async () => {
    const wrapper = mount(ChartDisplayTools, {
      props: { overlays: { volume: true, stockChipProfile: false } },
    })

    const buttons = wrapper.findAll('button')
    expect(wrapper.text()).toContain('成交量')
    expect(wrapper.text()).toContain('筹码')
    expect(wrapper.text()).toContain('主图 Log')
    expect(buttons[0].attributes('aria-pressed')).toBe('true')
    expect(buttons[1].attributes('aria-pressed')).toBe('false')

    await buttons[0].trigger('click')
    await buttons[1].trigger('click')
    expect(wrapper.emitted('set-overlay')).toEqual([
      ['volume', false],
      ['stockChipProfile', true],
    ])
  })

  it('提供因果均衡线的独立开关', async () => {
    const wrapper = mount(ChartDisplayTools, {
      props: { overlays: { causalEquilibrium: true } },
    })
    const button = wrapper.findAll('button').find((item) => item.text().includes('因果均衡'))
    expect(button.attributes('aria-pressed')).toBe('true')
    await button.trigger('click')
    expect(wrapper.emitted('set-overlay')).toEqual([['causalEquilibrium', false]])
    await wrapper.setProps({ overlays: { causalEquilibrium: false } })
    expect(button.attributes('aria-pressed')).toBe('false')
  })

  it('窄屏禁用筹码但保留成交量开关', async () => {
    const wrapper = mount(ChartDisplayTools, {
      props: {
        overlays: { volume: true, stockChipProfile: true },
        chipAvailable: false,
      },
    })
    const buttons = wrapper.findAll('button')
    expect(buttons[1].attributes()).toHaveProperty('disabled')
    await buttons[1].trigger('click')
    expect(wrapper.emitted('set-overlay')).toBeUndefined()
  })
})
