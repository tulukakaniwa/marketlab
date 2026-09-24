import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import CausalModelPanel from '../CausalModelPanel.vue'
import DecisionDrawer from '../DecisionDrawer.vue'

function snapshot() {
  return {
    status: 'ready',
    asOfDate: '2026-01-10',
    state: {
      equilibrium: { price: 103.5 },
      volatility: { annualized: 0.18 },
      dynamics: {
        components: [
          { id: 'reversion', weight: 0.5 },
          { id: 'trend', weight: 0.3 },
          { id: 'shock', weight: 0.2 },
        ],
      },
    },
    passage: {
      status: 'ready',
      side: 'long',
      targetPrice: 103.5,
      riskPrice: 96.6,
      horizonSessions: 200,
      computedHorizonSessions: 128,
      truncated: true,
      targetProbability: 0.5,
      riskProbability: 0.3,
      survivalProbability: 0.2,
      conditionalMedianSessions: { target: 10, risk: 12 },
    },
  }
}

describe('CausalModelPanel', () => {
  it('展示观察日、模型来源和有限期限概率，明确条件触达时间', () => {
    const wrapper = mount(CausalModelPanel, { props: { snapshot: snapshot() } })
    expect(wrapper.text()).toContain('截至 2026-01-10')
    expect(wrapper.text()).toContain('模型估计')
    expect(wrapper.text()).toContain('回归')
    expect(wrapper.text()).toContain('动态均衡锚')
    expect(wrapper.text()).toContain('103.5')
    expect(wrapper.text()).toContain('18.0%')
    expect(wrapper.text()).toContain('扩散尺度窗口 128 会话')
    expect(wrapper.text()).toContain('仅算前 128 会话')
    expect(wrapper.text()).toContain('原窗口 200 会话')
    expect(wrapper.text()).toContain('会话收盘触达')
    expect(wrapper.text()).toContain('条件于期限内')
    expect(wrapper.find('[aria-label="期限内首次触达概率"]').text()).toContain('均未触达20.0%')
  })

  it('无结果时显示缺输入状态，不显示零概率', () => {
    const wrapper = mount(CausalModelPanel, {
      props: { queryState: { status: 'idle', reason: 'missing-tdpy', asOfDate: '2026-01-10' } },
    })
    expect(wrapper.text()).toContain('待识别年交易会话数')
    expect(wrapper.find('[aria-label="期限内首次触达概率"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('0.0%')
  })

  it('未形成双边边界时保留状态估计而不渲染触达概率', () => {
    const value = snapshot()
    value.passage = { status: 'unavailable', reason: 'at-equilibrium' }
    const wrapper = mount(CausalModelPanel, { props: { snapshot: value } })
    expect(wrapper.text()).toContain('已处均衡附近')
    expect(wrapper.text()).toContain('动态均衡锚')
    expect(wrapper.find('[aria-label="期限内首次触达概率"]').exists()).toBe(false)
  })

  it('已保存旧版区块顺序的工作台仍显示并展开新区块', () => {
    localStorage.setItem('lab.decisionSectionOrder.v2', JSON.stringify(['sample', 'facts', 'orders']))
    const wrapper = mount(DecisionDrawer, { props: { graph: {}, replay: {}, profileList: [] } })
    const section = wrapper.findAll('details').find((item) => item.find('summary').text().includes('因果模型'))
    expect(section).toBeDefined()
    expect(section.attributes('open')).toBeDefined()
    expect(wrapper.findComponent(CausalModelPanel).exists()).toBe(true)
    wrapper.unmount()
    localStorage.removeItem('lab.decisionSectionOrder.v2')
  })

  it('粗网格计算明确提示概率近似限制，正常分辨率不额外提示', async () => {
    const value = snapshot()
    value.passage.numerical = { resolutionStatus: 'coarse-relative-to-transition-scale' }
    const wrapper = mount(CausalModelPanel, { props: { snapshot: value } })
    expect(wrapper.text()).toContain('网格分辨率不足 · 概率近似较粗')
    await wrapper.setProps({ snapshot: snapshot() })
    expect(wrapper.text()).not.toContain('网格分辨率不足')
  })
})
