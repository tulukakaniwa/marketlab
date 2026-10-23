import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ImpactReferenceLegend from '../ImpactReferenceLegend.vue'
import { buildImpactChartOverlay } from '../../domain/market-impact/impactChartOverlay.js'
import { analyzeEthOptionsBundle } from '../../domain/market-impact/ethOptionsResearch.js'
import { makeOptionsFixture } from '../../domain/market-impact/__tests__/optionsFixtures.js'

const snapshot = () =>
  buildImpactChartOverlay({
    source: { symbol: 'ETHUSDT', interval: '1日' },
    options: { phase: 'ready', report: analyzeEthOptionsBundle(makeOptionsFixture()) },
    rows: [
      { date: '2026-10-22', close: 2000 },
      { date: '2026-10-23', close: 2000 },
    ],
  })

describe('impact level legend', () => {
  it('uses the hovered historical point instead of leaking latest levels', async () => {
    const wrapper = mount(ImpactReferenceLegend, { props: { snapshot: snapshot(), date: '2026-10-23' } })
    expect(wrapper.text()).toContain('美元近似')
    expect(wrapper.text()).toContain('合成样本')
    expect(wrapper.text()).toContain('150 ETH')
    expect(wrapper.findAll('tbody tr')).toHaveLength(1)
    await wrapper.setProps({ date: '2026-10-22' })
    expect(wrapper.text()).toContain('晚于观察时间')
    expect(wrapper.find('table').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('150 ETH')
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('open-research')).toHaveLength(1)
    wrapper.unmount()
  })
  it('does not add an empty research rail before imports', () => {
    const wrapper = mount(ImpactReferenceLegend, { props: { snapshot: null } })
    expect(wrapper.find('details').exists()).toBe(false)
    wrapper.unmount()
  })
  it('labels minute evidence with the completed time rather than the candle open time', () => {
    const date = '2026-10-23T12:00:00.000Z'
    const completedAt = '2026-10-23T12:05:00.000Z'
    const result = buildImpactChartOverlay({
      source: { symbol: 'ETHUSDT', timeframe: '5m' },
      options: analyzeEthOptionsBundle(makeOptionsFixture()),
      rows: [{ date, close: 2000, completedAt }],
    })
    const wrapper = mount(ImpactReferenceLegend, { props: { snapshot: result, date } })
    expect(wrapper.get('summary time').text()).toBe(`收盘 ${completedAt}`)
    expect(wrapper.get('caption').text()).toContain(completedAt)
    wrapper.unmount()
  })
  it('labels expired continuous evidence and its first received time instead of showing stale values', () => {
    const report = analyzeEthOptionsBundle(makeOptionsFixture())
    const date = '2026-10-23T12:20:00.000Z'
    const result = buildImpactChartOverlay({
      source: { symbol: 'ETHUSDT', timeframe: '5m' },
      optionsHistory: [
        { id: 'test', availableAt: report.summary.availableAt, receivedAt: '2026-10-23T12:01:00.000Z', report },
      ],
      rows: [{ date, close: 2000, closeTime: Date.parse('2026-10-23T12:25:00.000Z') }],
    })
    const wrapper = mount(ImpactReferenceLegend, { props: { snapshot: result, date } })
    expect(wrapper.text()).toContain('快照已过期')
    expect(wrapper.text()).toContain('首次接入 2026-10-23T12:01:00.000Z')
    expect(wrapper.find('table').exists()).toBe(false)
    wrapper.unmount()
  })
})
