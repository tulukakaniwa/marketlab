import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import OptionPortfolioInputs from '../OptionPortfolioInputs.vue'

describe('OptionPortfolioInputs path scenario command', () => {
  it('把主图投影开关转换为显式命令', async () => {
    const input = {
      entryPrice: 100,
      optionStrategy: 'single',
      optionType: 'put',
      optionSide: 'long',
      optionQuantity: 1,
      optionMultiplier: 1,
      optionWidthPct: 0.05,
      riskFreeRate: 0.04,
      strikePrice: 100,
      optionTenorSessions: 20,
      rangeWidth: 0.1,
      pathUsesScenarioInputs: false,
    }
    const wrapper = mount(OptionPortfolioInputs, { props: { input } })

    await wrapper.find('input[role="switch"]').setValue(true)
    expect(wrapper.emitted('set-path-scenario')?.[0]).toEqual([true])
    expect(input.pathUsesScenarioInputs).toBe(false)
  })
})
