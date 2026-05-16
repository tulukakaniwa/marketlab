export const CHART_OVERLAY_TOGGLES = [
  { key: 'priceBands', label: '价格带组' },
  { key: 'greeksPane', label: 'Greeks 子图' },
  { key: 'lpPane', label: 'LP 子图' },
  { key: 'carryPane', label: 'Carry 子图' },
  { key: 'executionMarkers', label: '执行标记' },
  { key: 'researchMarkers', label: '研究标记' },
  { key: 'costBand', label: '成本锚带' },
  { key: 'entryLine', label: '入场价线' },
  { key: 'volBand', label: '波动带' },
  { key: 'volume', label: '成交量' },
  { key: 'replayMarkers', label: '回放标记' },
  { key: 'replayMarkerLabels', label: '回放文字' },
  { key: 'currentDecision', label: '当前状态点' },
  { key: 'equityPane', label: '权益子图' },
  { key: 'kdjPane', label: 'KDJ 子图' },
  { key: 'rsiPane', label: 'RSI 子图' },
]

export const CHART_OVERLAY_KEYS = CHART_OVERLAY_TOGGLES.map((toggle) => toggle.key)
