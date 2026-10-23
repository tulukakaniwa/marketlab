import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import MarketImpactResearchDialog from './MarketImpactResearchDialog.vue'

vi.mock('./EthImpactLab.vue', () => ({ default: { template: '<input aria-label="research-state" />' } }))
let wrapper
const dialogMethods = Object.fromEntries(
  ['showModal', 'close'].map((name) => [name, Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name)]),
)
beforeEach(() => {
  for (const name of ['showModal', 'close']) {
    Object.defineProperty(HTMLDialogElement.prototype, name, {
      configurable: true,
      value: function () {
        this.open = name === 'showModal'
      },
    })
  }
})
afterEach(() => {
  wrapper?.unmount()
  for (const [name, descriptor] of Object.entries(dialogMethods)) {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor)
    else delete HTMLDialogElement.prototype[name]
  }
  vi.restoreAllMocks()
})

describe('embedded market impact research', () => {
  it('returns to the workbench and preserves the same research instance when reopened', async () => {
    wrapper = mount(MarketImpactResearchDialog, { props: { open: true } })
    const dialog = wrapper.get('dialog').element
    const input = wrapper.get('input')
    await input.setValue('retained state')
    expect(dialog.open).toBe(true)
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '返回行情图')
      .trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
    await wrapper.setProps({ open: false })
    expect(dialog.open).toBe(false)
    await wrapper.setProps({ open: true })
    expect(dialog.open).toBe(true)
    expect(wrapper.get('input').element).toBe(input.element)
    expect(input.element.value).toBe('retained state')
  })

  it('routes Escape to the parent open state', async () => {
    wrapper = mount(MarketImpactResearchDialog, { props: { open: true } })
    await wrapper.get('dialog').trigger('cancel')
    expect(wrapper.emitted('close')).toHaveLength(1)
    await wrapper.setProps({ open: false })
    expect(wrapper.get('dialog').element.open).toBe(false)
  })

  it('requests chart overlay without changing imported data', async () => {
    wrapper = mount(MarketImpactResearchDialog, { props: { open: true } })
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '叠加到 ETH K 线')
      .trigger('click')
    expect(wrapper.emitted('show-on-chart')).toHaveLength(1)
    expect(wrapper.emitted('close')).toBeUndefined()
  })
})
