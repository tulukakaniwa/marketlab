export const CHART_ENGINE_IDS = Object.freeze({
  HQCHART: 'hqchart',
  VELA: 'vela',
})

export const CHART_ENGINE_PROFILES = Object.freeze({
  [CHART_ENGINE_IDS.VELA]: Object.freeze({
    id: CHART_ENGINE_IDS.VELA,
    label: 'Vela 研究图',
    shortLabel: 'Vela',
    description: '公式 / 成本 / 回放',
    status: '领域研究图',
    capabilities: Object.freeze([
      '公式带',
      '成本锚',
      '回放标记',
      '研究副图',
      '原生成交量 / 筹码',
      '原生画线',
      '原生指标 / 图表样式',
      '原生数据窗口 / 对象树',
      '原生设置 / 截图',
    ]),
    unavailable: Object.freeze([]),
  }),
  [CHART_ENGINE_IDS.HQCHART]: Object.freeze({
    id: CHART_ENGINE_IDS.HQCHART,
    label: 'HQ 终端',
    shortLabel: 'HQ',
    description: 'Lab 指标 / HQ 工具',
    status: '双层指标终端',
    capabilities: Object.freeze([
      'Market Lab 公式带',
      '成本锚',
      '自研副图',
      'HQ 通用指标',
      '多周期',
      '高级画线',
      '多空仓尺',
      '右键菜单',
      '研究筹码',
    ]),
    unavailable: Object.freeze(['回放标记']),
  }),
})

export function normalizeChartEngine(value) {
  return Object.hasOwn(CHART_ENGINE_PROFILES, value) ? value : CHART_ENGINE_IDS.VELA
}

export function getChartEngineProfile(value) {
  return CHART_ENGINE_PROFILES[normalizeChartEngine(value)]
}

export function getChartEngineNotice(value) {
  const profile = getChartEngineProfile(value)
  if (!profile.unavailable.length) return ''
  return `${profile.unavailable.join('、')}仍保留在 Vela 研究图，切换不会删除状态。`
}
