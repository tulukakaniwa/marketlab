import { persistedReactive } from './usePersisted.js'

/**
 * 主图叠加项开关，持久化到 localStorage
 *
 * 设计：
 *   - 默认优先保护 K 线阅读面积，显示成本带 / 入场 / 波动 / 量 / 当前点
 *   - replay 默认显示轻量买卖位置，但文字标签、指标子图需要显式打开
 *   - persistedReactive 已内置字段级合并，旧 storage 缺字段自动回退默认
 */
const DEFAULTS = {
  costBand: true,
  entryLine: true,
  volBand: true,
  volume: true,
  replayMarkers: true,
  replayMarkerLabels: false,
  currentDecision: true,
  deltaPane: false,
  equityPane: false,
  kdjPane: false,
  rsiPane: false,
}

export function useChartOverlays() {
  return persistedReactive('lab.chartOverlays.v5', DEFAULTS)
}

export const CHART_OVERLAY_DEFAULTS = DEFAULTS
