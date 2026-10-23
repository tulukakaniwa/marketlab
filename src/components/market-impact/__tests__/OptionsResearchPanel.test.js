import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import OptionsResearchPanel from '../OptionsResearchPanel.vue'

function render(dataOrigin) {
  return mount(OptionsResearchPanel, {
    props: {
      report: {
        dataOrigin,
        status: 'ready',
        summary: { tradeCount: 0 },
        tradeRows: [],
        scenario: { status: 'disabled' },
      },
      scenario: { enabled: false, hedgeRatio: 1, alreadyHedgedEth: 0 },
    },
  })
}

describe('options research provenance presentation', () => {
  it('labels a fully computable fixture as synthetic, never as real observations', () => {
    const wrapper = render('synthetic-fixture')
    expect(wrapper.text()).toContain('合成测试成交与快照')
    expect(wrapper.text()).toContain('合成样本 · 可计算')
    expect(wrapper.text()).not.toContain('真实成交')
    expect(wrapper.text()).not.toContain('观测数据')
    expect(wrapper.get('input[type="checkbox"]').element.checked).toBe(false)
  })

  it('uses observation wording only for explicitly observed provenance', () => {
    const wrapper = render('observed')
    expect(wrapper.text()).toContain('真实成交与捕获时快照')
    expect(wrapper.text()).toContain('观测数据 · 可计算')
  })

  it('keeps missing provenance unconfirmed even when data is computable', () => {
    const wrapper = render(undefined)
    expect(wrapper.text()).toContain('来源未确认的成交与快照')
    expect(wrapper.text()).not.toContain('真实成交')
    expect(wrapper.text()).not.toContain('观测数据')
  })
})
