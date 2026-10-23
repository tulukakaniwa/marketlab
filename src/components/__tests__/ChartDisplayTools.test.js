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

  it('保留价格滤波参考的独立开关且不再声称因果均衡', async () => {
    const wrapper = mount(ChartDisplayTools, {
      props: { overlays: { causalEquilibrium: true } },
    })
    const button = wrapper.findAll('button').find((item) => item.text().includes('滤波参考'))
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

  it('量价地图独立切换且等待图表准备后才发出命令', async () => {
    const overlays = { priceReferenceMap: true, costBand: true, stockChipProfile: true }
    const wrapper = mount(ChartDisplayTools, { props: { overlays, ready: false } })
    const button = wrapper.findAll('button').find((item) => item.text() === '量价地图')
    expect(button.attributes('aria-pressed')).toBe('true')
    expect(button.attributes('title')).toContain('OHLCV 代理')
    await button.trigger('click')
    expect(wrapper.emitted('set-overlay')).toBeUndefined()
    await wrapper.setProps({ ready: true })
    await button.trigger('click')
    expect(wrapper.emitted('set-overlay')).toEqual([['priceReferenceMap', false]])
    expect(overlays).toEqual({ priceReferenceMap: true, costBand: true, stockChipProfile: true })
    await wrapper.setProps({ overlays: { ...overlays, priceReferenceMap: false } })
    expect(button.attributes('aria-pressed')).toBe('false')
    await button.trigger('click')
    expect(wrapper.emitted('set-overlay').at(-1)).toEqual(['priceReferenceMap', true])
  })
})
