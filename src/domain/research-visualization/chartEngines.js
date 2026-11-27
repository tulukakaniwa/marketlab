export const CHART_ENGINE_IDS = Object.freeze({
  VELA: 'vela',
  HQCHART_OPTIONS: 'hqchart-options',
})

export const CHART_ENGINE_PROFILES = Object.freeze({
  [CHART_ENGINE_IDS.VELA]: Object.freeze({
    id: CHART_ENGINE_IDS.VELA,
    label: 'Vela 研究图',
    shortLabel: 'Vela',
    scope: 'main-kline',
    description: '主图唯一 K 线 / 成本 / 公式带引擎',
    status: '领域研究主图',
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
  [CHART_ENGINE_IDS.HQCHART_OPTIONS]: Object.freeze({
    id: CHART_ENGINE_IDS.HQCHART_OPTIONS,
    label: 'HQ 期权研究图',
    shortLabel: 'HQ 期权',
    scope: 'options-research',
    description: '期权 Greeks / 组合敏感度按需终端',
    status: '期权专项引擎',
    capabilities: Object.freeze(['期权 Delta / Gamma / Theta 序列', '标的与期权多轴同步十字线', '按需懒加载']),
    unavailable: Object.freeze(['主图 K 线终端']),
  }),
})

/** 主行情工作台唯一引擎为 Vela；历史持久化的 lightweight / hqchart 自动无损迁移到 Vela。 */
export function normalizeChartEngine(_value) {
  return CHART_ENGINE_IDS.VELA
}

export function getChartEngineProfile(value) {
  if (value === CHART_ENGINE_IDS.HQCHART_OPTIONS) return CHART_ENGINE_PROFILES[CHART_ENGINE_IDS.HQCHART_OPTIONS]
  return CHART_ENGINE_PROFILES[CHART_ENGINE_IDS.VELA]
}

export function getChartEngineNotice(value) {
  const profile = getChartEngineProfile(value)
  if (!profile.unavailable.length) return ''
  return `${profile.label}仅服务期权研究模块；${profile.unavailable.join('、')}统一由 Vela 承载。`
}
