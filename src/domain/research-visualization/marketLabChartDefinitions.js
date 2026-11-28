import { getMarketLabSeriesStyle } from './marketLabSeriesStyles.js'
import { CENTER_SERIES_CATALOG } from './marketLabCenterSeries.js'

export const MARKET_LAB_CHART_INDICATOR_GROUPS = Object.freeze([
  group('price', '价格层', 'main', 'priceBands'),
  group('greeks', 'Greeks', 'greeks', 'greeksPane'),
  group('lp', 'LP 情景 / 链上', 'lp', 'lpPane'),
  group('carry', 'Funding / Carry', 'carry', 'carryPane'),
  group('equity', '回放权益', 'equity', 'equityPane'),
  group('kdj', 'Lab KDJ', 'kdj', 'kdjPane'),
  group('rsi', 'Lab RSI', 'rsi', 'rsiPane'),
])

export const DEFINITIONS = Object.freeze([
  pathIndicator(
    'causalEquilibrium',
    '价格滤波参考',
    'price',
    'price',
    '#a855f7',
    'main',
    'price.causalEquilibrium',
    'equilibriumPrice',
    {
      source: 'causalPath',
      controls: ['causalEquilibrium'],
    },
  ),
  pathIndicator('cost', '成本锚', 'price', 'price', '#0e7558', 'main', 'price.costBand', 'costAnchor', {
    fallback: ['costPath', 'anchor'],
    controls: ['priceBands', 'costBand'],
  }),
  pathIndicator('costUpper', '成本上沿', 'price', 'price', '#8b5a16', 'main', 'price.costBand', 'costUpper', {
    fallback: ['costPath', 'upper'],
    controls: ['priceBands', 'costBand'],
  }),
  pathIndicator('costLower', '成本下沿', 'price', 'price', '#274f9f', 'main', 'price.costBand', 'costLower', {
    fallback: ['costPath', 'lower'],
    controls: ['priceBands', 'costBand'],
  }),
  pathIndicator(
    'deltaUpper',
    '动态周期 GetDelta 上沿',
    'price',
    'price',
    '#9a4f00',
    'main',
    'price.deltaBand',
    'deltaUpper',
    {
      controls: ['priceBands', 'volBand'],
    },
  ),
  pathIndicator(
    'deltaLower',
    '动态周期 GetDelta 下沿',
    'price',
    'price',
    '#1f5fbf',
    'main',
    'price.deltaBand',
    'deltaLower',
    {
      controls: ['priceBands', 'volBand'],
    },
  ),
  pathIndicator('lpLower', 'LP 动态研究区间下沿', 'price', 'price', '#7a5cff', 'main', 'price.lpBand', 'lpLowerPrice', {
    controls: ['priceBands', 'lpBand'],
  }),
  pathIndicator('lpUpper', 'LP 动态研究区间上沿', 'price', 'price', '#7a5cff', 'main', 'price.lpBand', 'lpUpperPrice', {
    controls: ['priceBands', 'lpBand'],
  }),
  pathIndicator('lpRealPrice', '链上池价', 'price', 'price', '#8b5a16', 'main', 'price.lpRealPrice', 'lpRealPrice', {
    controls: ['priceBands', 'lpBand'],
  }),
  constantIndicator('entry', '入场价', 'price', 'price', '#b3261e', 'main', 'price.entryLine', 'input', 'entryPrice', {
    controls: ['entryLine'],
    state: 'ready',
  }),
  constantIndicator('mark', '现价', 'price', 'price', '#202020', 'main', 'price.currentLine', 'rows', 'close', {
    state: 'ready',
  }),
  constantIndicator(
    'target',
    '模拟目标',
    'price',
    'price',
    '#0e7558',
    'main',
    'markers.execution',
    'position',
    'targetPrice',
    { controls: ['executionMarkers'] },
  ),
  constantIndicator(
    'stop',
    '失效线',
    'price',
    'price',
    '#a93226',
    'main',
    'markers.execution',
    'position',
    'stopPrice',
    { controls: ['executionMarkers'] },
  ),
  pathIndicator(
    'strategyStop',
    '策略防守轨',
    'price',
    'price',
    '#ef4444',
    'main',
    'price.strategyOverlay',
    'strategyStop',
    {
      source: 'strategyPath',
      controls: ['strategyOverlay'],
    },
  ),
  pathIndicator(
    'strategyTarget',
    '策略目标轨',
    'price',
    'price',
    '#10b981',
    'main',
    'price.strategyOverlay',
    'strategyTarget',
    {
      source: 'strategyPath',
      controls: ['strategyOverlay'],
    },
  ),

  pathIndicator('bsDelta', '期权 Delta', 'num', 'greeks', '#a93226', 'greeks', 'paneOn.greeks', 'optionDelta', {
    controls: ['greeksPane'],
  }),
  pathIndicator('bsGamma', '期权 Gamma', 'num', 'greeks', '#8b5a16', 'greeks', 'paneOn.greeks', 'optionGamma', {
    controls: ['greeksPane'],
  }),
  pathIndicator(
    'bsTheta',
    '期权 Theta/交易会话',
    'num',
    'greeks',
    '#274f9f',
    'greeks',
    'paneOn.greeks',
    'optionThetaPerSession',
    { controls: ['greeksPane'] },
  ),

  pathIndicator('lpDelta', 'LP 情景库存暴露', 'ratio', 'lp', '#0e7558', 'lp', 'paneOn.lp', 'lpNormalizedDelta', {
    controls: ['lpPane'],
  }),
  pathIndicator('lpValue', 'LP 情景库存价值', 'price', 'lp', '#7a5cff', 'lp', 'paneOn.lp', 'lpValue', {
    controls: ['lpPane'],
  }),
  pathIndicator('lpRealDiv', '链上池价偏离', 'pct', 'lp', '#8b5a16', 'lp', 'paneOn.lp', 'lpRealDivergence', {
    controls: ['lpPane'],
  }),
  pathIndicator(
    'lpPoolTurnover',
    '真实池24h换手',
    'pct',
    'lp',
    '#b3261e',
    'lp',
    'paneOn.lpPoolCoverage',
    'lpPoolTurnover24h',
    {
      controls: ['lpPane'],
      pointMode: 'latest',
    },
  ),
  pathIndicator(
    'lpPoolConcentration',
    '主池资金占比',
    'ratio',
    'lp',
    '#274f9f',
    'lp',
    'paneOn.lpPoolCoverage',
    'lpPoolTopReserveShare',
    { controls: ['lpPane'], pointMode: 'latest' },
  ),
  pathIndicator('lpCe', 'CK 几何资本效率（情景）', 'num', 'lp', '#8b5a16', 'lp', 'paneOn.lp', 'capitalEfficiency', {
    controls: ['lpPane'],
  }),

  pathIndicator(
    'cumulativeFundingProxy',
    '累计 Funding 代理',
    'pct',
    'carry',
    '#a93226',
    'carry',
    'paneOn.carry',
    'cumulativeFundingProxy',
    { controls: ['carryPane'] },
  ),
  pathIndicator('netCarry', '持仓归因代理', 'pct', 'carry', '#0e7558', 'carry', 'paneOn.carry', 'netCarry', {
    controls: ['carryPane'],
  }),

  derivedIndicator(
    'equity',
    '回放权益',
    'price',
    'equity',
    '#1f5fbf',
    'equity',
    'paneOn.equity',
    'replay',
    'equityCurve.equity',
    {
      controls: ['equityPane'],
      state: 'ready',
    },
  ),
  derivedIndicator('kdjK', 'Lab KDJ K/D 均', 'num', 'kdj', '#cc8400', 'kdj', 'paneOn.kdj', 'computedKDJ', 'meanKD', {
    controls: ['kdjPane'],
  }),
  derivedIndicator('kdjJ', 'Lab KDJ J', 'num', 'kdj', '#4e4e4e', 'kdj', 'paneOn.kdj', 'computedKDJ', 'j', {
    controls: ['kdjPane'],
  }),
  derivedIndicator('rsi', 'Lab RSI', 'num', 'rsi', '#2e2e2e', 'rsi', 'paneOn.rsi', 'computedRSI', 'custom', {
    controls: ['rsiPane'],
  }),
])

export const MARKET_LAB_CHART_INDICATOR_CATALOG = Object.freeze([
  ...CENTER_SERIES_CATALOG,
  ...DEFINITIONS.map((definition) => Object.freeze(publicMeta(definition, definition.sources[0]))),
])

export function publicMeta(definition, source) {
  return {
    id: definition.id,
    label: definition.label,
    color: definition.color,
    unit: definition.unit,
    lineWidth: definition.lineWidth,
    lineStyle: definition.lineStyle,
    render: definition.render,
    group: definition.group,
    pane: definition.pane,
    source: source.source,
    field: source.field,
    sourceField: `${source.source}.${source.field}`,
  }
}

function pathIndicator(id, label, unit, groupId, color, pane, gate, field, options = {}) {
  const sources = [{ source: options.source ?? 'formulaPath', field }]
  if (options.fallback) sources.push({ source: options.fallback[0], field: options.fallback[1] })
  return definition({ id, label, unit, groupId, color, pane, gate, sources, ...options, kind: 'path' })
}

function constantIndicator(id, label, unit, groupId, color, pane, gate, source, field, options = {}) {
  return definition({
    id,
    label,
    unit,
    groupId,
    color,
    pane,
    gate,
    sources: [{ source, field }],
    ...options,
    kind: 'constant',
  })
}

function derivedIndicator(id, label, unit, groupId, color, pane, gate, source, field, options = {}) {
  const kind = id === 'equity' ? 'equity' : id === 'kdjK' ? 'kdj-mean' : id === 'kdjJ' ? 'kdj-j' : 'rsi'
  return definition({ id, label, unit, groupId, color, pane, gate, sources: [{ source, field }], ...options, kind })
}

function definition({
  id,
  label,
  unit,
  groupId,
  color,
  pane,
  gate,
  sources,
  controls = [],
  state = 'estimated',
  pointMode = 'path',
  kind,
}) {
  const sharedStyle = getMarketLabSeriesStyle(id) ?? { label, unit, color, lineWidth: 1, lineStyle: 'solid' }
  return Object.freeze({
    id,
    label: sharedStyle.label,
    unit: sharedStyle.unit,
    group: groupId,
    color: sharedStyle.color,
    lineWidth: sharedStyle.lineWidth,
    lineStyle: sharedStyle.lineStyle,
    pane,
    gate,
    sources,
    controls,
    state,
    pointMode,
    kind,
    render: pointMode === 'latest' ? 'point' : 'line',
  })
}

function group(id, label, pane, overlayKey) {
  return Object.freeze({ id, label, pane, overlayKey })
}
