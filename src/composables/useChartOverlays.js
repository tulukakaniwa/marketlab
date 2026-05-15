import { persistedReactive } from './usePersisted.js'

/**
 * 主图叠加项开关：10 项布尔值，持久化到 localStorage
 *
 * 设计：
 *   - 默认显示常用项（成本带 / 入场 / 波动 / 量 / replay markers / 当前决策点）
 *   - Δ 子图、权益子图默认关，避免主图被压扁
 *   - persistedReactive 已内置字段级合并，旧 storage 缺字段自动回退默认
 */
const DEFAULTS = {
  costBand: true,
  entryLine: true,
  volBand: true,
  volume: true,
  replayMarkers: true,
  currentDecision: true,
  deltaPane: false,
  equityPane: false,
  kdjPane: true,
  rsiPane: true,
}

export function useChartOverlays() {
  return persistedReactive('lab.chartOverlays.v1', DEFAULTS)
}

export const CHART_OVERLAY_DEFAULTS = DEFAULTS
