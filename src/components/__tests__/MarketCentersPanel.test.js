import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import MarketCentersPanel from '../MarketCentersPanel.vue'

describe('independent center formula panel', () => {
  it('uses Vela settings when ready and restores shared editors for HQ or loading failures', async () => {
    const wrapper = mount(MarketCentersPanel, { props: { nativeSettings: true } })
    expect(wrapper.findAll('input[type="number"]')).toHaveLength(0)
    expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(0)
    expect(wrapper.text()).toContain('Indicators')
    expect(wrapper.find('input[type="file"]').exists()).toBe(true)
    await wrapper.find('[data-formula="fundamental"] button').trigger('click')
    expect(wrapper.emitted('center-input-change')[0][0]).toMatchObject({ formula: 'fundamental', key: 'apply' })
    await wrapper.setProps({ nativeSettings: false })
    expect(wrapper.findAll('input[type="number"]').length).toBeGreaterThan(0)
    expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(2)
    wrapper.unmount()
  })
  it('distinguishes unidentified statistics from an available cost proxy and missing scenarios', () => {
    const wrapper = mount(MarketCentersPanel, {
      props: {
        sourceKey: 'asset-a',
        snapshot: {
          asOfDate: '2026-01-01',
          formulas: {
            statisticalCenter: { status: 'unidentified', value: null },
            vwapCost: { status: 'estimated', value: 123, source: { kind: 'hlc3-volume' } },
            supplyDemand: { status: 'missing-input', value: null },
            fundamental: { status: 'missing-input', value: null },
          },
        },
      },
    })
    expect(wrapper.find('[data-formula="statisticalCenter"]').text()).toContain('未识别稳定中枢')
    expect(wrapper.find('[data-formula="statisticalCenter"] b').text()).toBe('—')
    expect(wrapper.find('[data-formula="vwapCost"] b').text()).toBe('123')
    expect(wrapper.find('[data-formula="vwapCost"]').text()).toContain('非实际持仓成本')
    expect(wrapper.find('[data-formula="fundamental"]').text()).toContain('显式情景')
    expect(wrapper.find('[data-formula="cohortCost"]').text()).toContain('随机换手假设')
  })

  it('emits scoped ViewModel commands without mutating incoming config or inventing missing zeroes', async () => {
    const config = { supplyDemand: { enabled: false, a: null } }
    const wrapper = mount(MarketCentersPanel, { props: { config, sourceKey: 'asset-a' } })
    const input = wrapper.find('[data-formula="supplyDemand"] input[type="number"]')
    await input.setValue('150')
    expect(wrapper.emitted('center-input-change').at(-1)[0]).toEqual({
      formula: 'supplyDemand',
      key: 'a',
      value: '150',
      sourceKey: 'asset-a',
    })
    expect(config.supplyDemand.a).toBeNull()
    await input.setValue('')
    expect(wrapper.emitted('center-input-change').at(-1)[0].value).toBe('')
  })

  it('makes a scenario from another observation date visibly stale until explicitly reapplied', () => {
    const wrapper = mount(MarketCentersPanel, {
      props: {
        snapshot: { asOfDate: '2026-01-02', formulas: {} },
        config: { fundamental: { enabled: true, provenance: { asOfDate: '2026-01-01' } } },
      },
    })
    expect(wrapper.find('[data-formula="fundamental"]').text()).toContain('情景属于其他观察日')
    expect(wrapper.find('[data-formula="fundamental"] b').text()).toBe('—')
  })

  it('discards late float files after a newer import, clearing, date change or unmount', async () => {
    const onCenterInputChange = vi.fn()
    const wrapper = mount(MarketCentersPanel, {
      props: {
        onCenterInputChange,
        sourceKey: 'asset-a',
        queryState: { asOfDate: '2026-01-01' },
        config: { cohortCost: { freeFloat: {} } },
      },
    })
    const input = wrapper.find('input[type="file"]')
    let finishOld
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: [
        {
          text: () =>
            new Promise((r) => {
              finishOld = r
            }),
        },
      ],
    })
    await input.trigger('change')
    Object.defineProperty(input.element, 'files', { configurable: true, value: [{ text: async () => '{"new":true}' }] })
    await input.trigger('change')
    finishOld('{"old":true}')
    await Promise.resolve()
    expect(wrapper.emitted('center-input-change')).toHaveLength(1)
    expect(wrapper.emitted('center-input-change')[0][0].value).toBe('{"new":true}')
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: [
        {
          text: () =>
            new Promise((r) => {
              finishOld = r
            }),
        },
      ],
    })
    await input.trigger('change')
    await wrapper.find('[data-formula="cohortCost"] button').trigger('click')
    finishOld('{"restored":true}')
    await Promise.resolve()
    expect(wrapper.emitted('center-input-change')).toHaveLength(2)
    expect(wrapper.emitted('center-input-change')[1][0].value).toBe('')
    await input.trigger('change')
    await wrapper.setProps({ queryState: { asOfDate: '2026-01-02' } })
    finishOld('{}')
    await Promise.resolve()
    expect(wrapper.emitted('center-input-change')).toHaveLength(2)
    await input.trigger('change')
    wrapper.unmount()
    finishOld('{}')
    await Promise.resolve()
    expect(onCenterInputChange).toHaveBeenCalledTimes(2)
  })
})
