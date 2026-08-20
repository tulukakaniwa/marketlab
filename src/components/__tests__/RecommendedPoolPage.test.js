import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import RecommendedPoolPage from '../RecommendedPoolPage.vue'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('RecommendedPoolPage', () => {
  it('renders the canonical status contract and Agent conclusion without promoting a high diagnostic score', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          schemaVersion: 'market-lab.recommended-pool-report.v4',
          totalCandidates: 2,
          topN: 10,
          canonicalSummary: {
            audit: { considered: 316, dataReady: 2 },
            statusCounts: { 观察: 0, 等待: 1, 剔除: 1, 需刷新数据: 0 },
            latestSignalCount: 0,
          },
          agentReview: {
            status: 'reviewed',
            agent: { name: 'Codex' },
            conclusion: { summary: '本轮没有通过观察门禁的标的。' },
          },
          candidatesAll: [
            {
              symbol: '600085',
              label: '同仁堂',
              market: 'A股',
              score: 99,
              candidateStatus: '等待',
              executionStatus: 'blocked',
              dataThrough: '2026-08-19',
            },
            {
              symbol: '000001',
              label: '示例剔除项',
              market: 'A股',
              score: 80,
              candidateStatus: '剔除',
              executionStatus: 'blocked',
              dataThrough: '2026-08-19',
            },
          ],
        }),
      })),
    )

    const wrapper = mount(RecommendedPoolPage)
    await flushPromises()

    expect(wrapper.text()).toContain('316 → 2')
    expect(wrapper.text()).toContain('Codex 已复核')
    expect(wrapper.text()).toContain('本轮没有通过观察门禁的标的。')
    expect(wrapper.text()).toContain('同仁堂')
    expect(wrapper.text()).toContain('99')
    expect(wrapper.text()).toContain('等待')
    expect(wrapper.text()).toContain('blocked')
    expect(wrapper.text()).not.toContain('研究关注')
  })
})
