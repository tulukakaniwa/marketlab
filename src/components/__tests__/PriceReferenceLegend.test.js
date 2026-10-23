import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PriceReferenceLegend from '../PriceReferenceLegend.vue'

const node = { price: 125.25, share: 0.1234, intensity: 1, side: 'above', isPoc: true }
const first = { date: '2026-10-08', status: 'ready', sampleSize: 60, nodes: [node] }
const last = { ...first, date: '2026-10-09', nodes: [{ ...node, price: 195.75, side: 'below' }] }
const snapshot = {
  source: 'ohlcv-volume-proxy',
  sourceKey: 'stock-a',
  asOfDate: last.date,
  lookbackSessions: 60,
  path: [first, last],
}
const query = { status: 'ready', sourceKey: 'stock-a', asOfDate: last.date }

describe('price reference legend', () => {
  it('reads the hovered historical date and never backfills it with the latest nodes', async () => {
    const wrapper = mount(PriceReferenceLegend, { props: { snapshot, query, date: first.date } })
    expect(wrapper.find('time').text()).toBe(first.date)
    expect(wrapper.find('summary').text()).toContain('125.25')
    expect(wrapper.text()).not.toContain('195.75')
    expect(wrapper.find('tbody').text()).toContain('12.3%')
    await wrapper.setProps({ date: last.date })
    expect(wrapper.find('summary').text()).toContain('195.75')
    expect(wrapper.text()).not.toContain('125.25')
    for (const date of ['2026-10-01', '2026-10-10']) {
      await wrapper.setProps({ date })
      expect(wrapper.findAll('.price-reference-node')).toHaveLength(0)
      expect(wrapper.find('table').exists()).toBe(false)
    }
  })
  it('shows proxy source, density semantics and the existing cost-band visibility', async () => {
    const wrapper = mount(PriceReferenceLegend, { props: { snapshot, query, date: first.date } })
    expect(wrapper.find('.price-reference-source').text()).toBe('OHLCV 代理')
    expect(wrapper.text()).toContain('60 会话')
    expect(wrapper.text()).toContain('点大小＝当日窗口内相对密度')
    expect(wrapper.text()).toContain('不代表真实持仓、挂单或 Gamma 暴露')
    expect(wrapper.text()).toContain('淡色区：已有成本带')
    await wrapper.setProps({ bandVisible: false })
    expect(wrapper.text()).toContain('成本带填色已关闭')
    expect(wrapper.text()).not.toContain('淡色区：已有成本带')
  })
  it('clears stale snapshots while computing or after failure and rejects mismatched source/date contexts', async () => {
    const wrapper = mount(PriceReferenceLegend, { props: { snapshot, query, date: first.date } })
    expect(wrapper.findAll('.price-reference-node')).toHaveLength(1)
    const pendingStates = [
      { ...query, status: 'computing' },
      { ...query, status: 'error' },
      { ...query, status: 'idle' },
      { ...query, sourceKey: 'stock-b' },
      { ...query, asOfDate: '2026-10-10' },
    ]
    for (const state of pendingStates) {
      await wrapper.setProps({ query: state })
      expect(wrapper.findAll('.price-reference-node')).toHaveLength(0)
      expect(wrapper.find('table').exists()).toBe(false)
      if (state.status === 'computing') expect(wrapper.text()).toContain('计算中')
      if (state.status === 'error') expect(wrapper.text()).toContain('暂不可用')
    }
    await wrapper.setProps({ query })
    expect(wrapper.findAll('.price-reference-node')).toHaveLength(1)
  })
  it.each([
    ['warming-up', '预热中'],
    ['invalid-data', '数据缺口'],
    ['no-volume', '无有效成交量'],
  ])('does not display nodes for a %s observation', (status, label) => {
    const wrapper = mount(PriceReferenceLegend, {
      props: { date: first.date, snapshot: { ...snapshot, path: [{ ...first, status }] } },
    })
    expect(wrapper.text()).toContain(label)
    expect(wrapper.findAll('.price-reference-node')).toHaveLength(0)
  })
  it('preserves useful significant digits for small-price assets', () => {
    const wrapper = mount(PriceReferenceLegend, {
      props: {
        date: first.date,
        snapshot: { ...snapshot, path: [{ ...first, nodes: [{ ...node, price: 0.0000123456 }] }] },
      },
    })
    expect(wrapper.find('.price-reference-node b').text()).toBe('0.0000123456')
    expect(wrapper.find('tbody').text()).toContain('0.0000123456')
  })
})
