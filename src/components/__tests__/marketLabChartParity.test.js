import { describe, expect, it } from 'vitest'
import { buildVelaResearchGroups, velaSeriesTitle } from '../../infrastructure/charting/velaResearchAdapter.js'
import {
  MARKET_LAB_CHART_INDICATOR_CATALOG,
  queryMarketLabChartSeries,
} from '../../domain/research-visualization/marketLabChartIndicators.js'
import {
  buildHqResearchChartConfig,
  hqResearchApiId,
  toHqColor,
  toHqResearchIndexResponse,
} from '../../infrastructure/charting/hqChartResearchAdapter.js'

const ALL_ON = {
  statisticalCenter: true,
  vwapCost: true,
  cohortCost: true,
  supplyDemand: true,
  fundamental: true,
  priceBands: true,
  costBand: true,
  volBand: true,
  lpBand: true,
  entryLine: true,
  executionMarkers: true,
  replayMarkers: true,
  replayMarkerLabels: true,
  currentDecision: true,
  researchMarkers: true,
  greeksPane: true,
  lpPane: true,
  carryPane: true,
  equityPane: true,
  kdjPane: true,
  rsiPane: true,
  volume: true,
}

const rows = Array.from({ length: 20 }, (_, index) => {
  const close = 10 + index * 0.1
  return {
    date: `2026-08-${String(index + 1).padStart(2, '0')}`,
    open: close - 0.05,
    high: close + 0.2,
    low: close - 0.2,
    close,
    volume: 100 + index,
  }
})

const formulaPath = rows.map((row, index) => ({
  date: row.date,
  costAnchor: 10 + index,
  costUpper: 11 + index,
  costLower: 9 + index,
  deltaUpper: 12 + index,
  deltaLower: 8 + index,
  lpLowerPrice: 7 + index,
  lpUpperPrice: 13 + index,
  lpRealPrice: 10.5 + index,
  optionDelta: 0.4 + index / 100,
  optionGamma: 0.03 + index / 1000,
  optionThetaPerSession: -0.02 - index / 1000,
  lpNormalizedDelta: -0.2 + index / 100,
  lpValue: 1000 + index,
  lpRealDivergence: 0.01 + index / 1000,
  lpPoolTurnover24h: 0.2 + index / 100,
  lpPoolTopReserveShare: 0.3 + index / 100,
  capitalEfficiency: 2 + index / 100,
  cumulativeFundingProxy: 0.001 + index / 10000,
  netCarry: 0.002 + index / 10000,
}))

const fixture = {
  rows,
  formulaPath,
  costPath: [],
  causalPath: rows.map((row, index) => ({ date: row.date, equilibriumPrice: index > 7 ? 10 + index / 20 : null })),
  strategyPath: rows.map((row, index) => ({
    date: row.date,
    strategyStop: index > 5 ? 9.4 + index / 25 : null,
    strategyTarget: index > 5 ? 11.6 + index / 25 : null,
  })),
  centerPath: rows.map((row, index) => ({
    date: row.date,
    statisticalCenterPrice: index > 7 ? 10 + index / 30 : null,
    vwapCostPrice: 10 + index / 50,
    cohortCostPrice: 10 + index / 40,
    supplyDemandPrice: 11,
    fundamentalPrice: 12,
    centerStates: {
      statisticalCenter: { status: index > 7 ? 'ready' : 'warming-up' },
      vwapCost: { status: 'ready', source: { kind: 'hlc3-volume' } },
    },
  })),
  overlays: ALL_ON,
  entryPrice: 10.2,
  position: { targetPrice: 13, stopPrice: 9 },
  replay: { equityCurve: rows.map((row, index) => ({ date: row.date, equity: 100_000 + index * 100 })) },
}

describe('Market Lab Vela main-chart & HQ option-series contracts', () => {
  it('Vela preserves every active domain series, gaps, latest-only points and styles', () => {
    const model = queryMarketLabChartSeries(fixture)
    const output = buildVelaResearchGroups(model, 'test')
    const rendered = output.flatMap((group) => group.output.series)
    for (const definition of MARKET_LAB_CHART_INDICATOR_CATALOG) {
      if (definition.id === 'mark') continue
      const input = model.groups.flatMap((group) => group.series).find((series) => series.id === definition.id)
      const series = rendered.find((series) => series.id === `test:${definition.id}`)
      expect(series, definition.id).toBeDefined()
      expect(series.style).toEqual({
        color: definition.color,
        width: definition.lineWidth,
        lineStyle: definition.lineStyle,
      })
      expect(series.title).toBe(velaSeriesTitle(definition))
      const expected = new Map(input.points.map((point) => [point.time, point.value]))
      expect(series.points).toEqual(
        rows.map((row) => ({
          time: Date.parse(`${row.date}T00:00:00Z`),
          value: expected.get(row.date) ?? null,
        })),
      )
    }
    const causal = rendered.find((series) => series.id === 'test:causalEquilibrium')
    expect(causal.points.slice(0, 8).every((point) => point.value === null)).toBe(true)
    const latest = rendered.find((series) => series.id === 'test:lpPoolTurnover')
    expect(latest.kind).toBe('circles')
    expect(latest.points.filter((point) => point.value !== null)).toHaveLength(1)
    expect(output.filter((group) => group.groupId === 'greeks')).toHaveLength(3)
    expect(output.filter((group) => group.groupId === 'lp')).toHaveLength(3)
  })

  it('现价、入场、成本、GetDelta 与 LP 区间始终共用 Vela 主 K 线价格轴', () => {
    const model = queryMarketLabChartSeries(fixture)
    const required = [
      'entry',
      'cost',
      'causalEquilibrium',
      'costUpper',
      'costLower',
      'deltaUpper',
      'deltaLower',
      'lpUpper',
      'lpLower',
    ]

    expect(model.groups.find((group) => group.id === 'price').series.map((series) => series.id)).toEqual(
      expect.arrayContaining(required),
    )
    const velaPrice = buildVelaResearchGroups(model, 'price-test').filter((group) => group.overlay)
    expect(velaPrice.every((group) => group.overlay)).toBe(true)
    expect(velaPrice.flatMap((group) => group.output.series).map((series) => series.id)).toEqual(
      expect.arrayContaining(required.map((id) => `price-test:${id}`)),
    )
  })

  it('latest-only pool snapshots stay anchored to the active formula observation date', () => {
    const activeLength = 10
    const activeFixture = { ...fixture, formulaPath: formulaPath.slice(0, activeLength) }
    const model = queryMarketLabChartSeries(activeFixture)
    const turnover = findSeries(model, 'lpPoolTurnover')
    const concentration = findSeries(model, 'lpPoolConcentration')

    expect(turnover.points).toEqual([
      { time: rows[activeLength - 1].date, value: formulaPath[activeLength - 1].lpPoolTurnover24h },
    ])
    expect(concentration.points).toEqual([
      { time: rows[activeLength - 1].date, value: formulaPath[activeLength - 1].lpPoolTopReserveShare },
    ])
  })

  it('HQ option Greeks adapter preserves Delta / Gamma / Theta scale groups and aligned values', () => {
    const model = queryMarketLabChartSeries(fixture)
    const greeksOnly = {
      dates: model.dates,
      groups: model.groups.filter((group) => group.id === 'greeks'),
    }
    const config = buildHqResearchChartConfig(greeksOnly, { windowOffset: 1 })
    expect(config.paneGroups[0]).toHaveLength(3)

    for (const group of config.paneGroups.flat()) {
      const response = toHqResearchIndexResponse(greeksOnly, hqResearchApiId(group.id), {})
      expect(response.code, group.id).toBe(0)
      expect(response.outdata.date).toEqual(model.dates.map(compactDate))
      expect(response.outdata.outvar).toEqual(group.series.map((series) => expectedHqOutVar(series, model.dates)))
    }
  })
})

function findSeries(model, id) {
  return model.groups.flatMap((group) => group.series).find((series) => series.id === id)
}

function compactDate(value) {
  return Number(String(value).replaceAll('-', ''))
}

function expectedHqOutVar(series, dates) {
  return {
    name: series.label,
    type: series.render === 'point' ? 3 : 0,
    data: alignedValues(series, dates),
    color: toHqColor(series.color),
    linewidth: `LINETHICK${series.lineWidth ?? (series.render === 'point' ? 2 : 1)}`,
    isDotLine: series.lineStyle === 'dotted',
    IsShowTitle: false,
    ...(series.lineStyle === 'dashed' ? { lineDash: [5, 4] } : {}),
  }
}

function alignedValues(series, dates) {
  const byTime = new Map(series.points.map((point) => [point.time, point.value]))
  return dates.map((date) => byTime.get(date) ?? null)
}
