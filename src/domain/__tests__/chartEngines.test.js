import { describe, expect, it } from 'vitest'
import {
  CHART_ENGINE_IDS,
  getChartEngineNotice,
  getChartEngineProfile,
  normalizeChartEngine,
} from '../research-visualization/chartEngines.js'

describe('chart engine profiles', () => {
  it('主图历史持久化值（lightweight / hqchart / 未知）统一无损收敛到 Vela', () => {
    expect(normalizeChartEngine('lightweight')).toBe(CHART_ENGINE_IDS.VELA)
    expect(normalizeChartEngine('hqchart')).toBe(CHART_ENGINE_IDS.VELA)
    expect(normalizeChartEngine('unknown')).toBe(CHART_ENGINE_IDS.VELA)
    expect(getChartEngineProfile(null).label).toBe('Vela 研究图')
  })

  it('HQ 引擎专职期权研究模块，不再承担主图 K 线终端职责', () => {
    const profile = getChartEngineProfile(CHART_ENGINE_IDS.HQCHART_OPTIONS)
    const notice = getChartEngineNotice(CHART_ENGINE_IDS.HQCHART_OPTIONS)
    expect(profile.scope).toBe('options-research')
    expect(profile.capabilities).toContain('期权 Delta / Gamma / Theta 序列')
    expect(notice).toContain('仅服务期权研究模块')
    expect(notice).toContain('Vela')
  })
})
