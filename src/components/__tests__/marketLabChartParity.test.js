import { describe, expect, it } from 'vitest'
import { buildVelaResearchGroups, velaSeriesTitle } from '../../infrastructure/charting/velaResearchAdapter.js'
import { fallbackValue, latestFinitePathPoint, SERIES_META } from '../researchChartLegendMeta.js'
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

describe('Market Lab Vela / HQ chart parity', () => {
  it('Vela preserves every active domain series, gaps, latest-only points and styles', () => {
    const model = queryMarketLabChartSeries(fixture)
    const output = buildVelaResearchGroups(model, 'test')
    const rendered = output.flatMap((group) => group.output.series)
    for (const definition of MARKET_LAB_CHART_INDICATOR_CATALOG) {
      if (definition.id === 'mark') continue // Vela's native current-price line owns the latest close.
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

  it('Historical legend values and the domain envelope read identical formula/constant values', () => {
    const model = queryMarketLabChartSeries(fixture)
    const comparableIds = MARKET_LAB_CHART_INDICATOR_CATALOG.map((item) => item.id).filter(
      (id) => !['equity', 'kdjK', 'kdjJ', 'rsi'].includes(id),
    )

    for (const id of comparableIds) {
      const series = findSeries(model, id)
      const byTime = new Map(series.points.map((point) => [point.time, point.value]))
      rows.forEach((row, index) => {
        const lightValue = fallbackValue(id, index, fixture)
        expect(Number.isFinite(lightValue) ? lightValue : null, `${id}@${row.date}`).toBe(byTime.get(row.date) ?? null)
      })
    }
  })

  it('现价、入场、成本、GetDelta 与 LP 区间始终共用主 K 线价格轴', () => {
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
    expect(buildHqResearchChartConfig(model).overlayIndex[0]).toMatchObject({ Windows: 0, IsShareY: true })
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
    expect(latestFinitePathPoint(rows, activeFixture.formulaPath, 'lpPoolTurnover24h')).toEqual(turnover.points[0])
    expect(fallbackValue('lpPoolTurnover', activeLength - 1, activeFixture)).toBe(
      formulaPath[activeLength - 1].lpPoolTurnover24h,
    )
    expect(fallbackValue('lpPoolTurnover', rows.length - 1, activeFixture)).toBeNull()
  })

  it('causal line preserves gaps and the observation cutoff in both engines, with a shared toggle', () => {
    const causalPath = fixture.causalPath
      .slice(0, 16)
      .map((point, i) => (i === 12 ? { ...point, equilibriumPrice: null } : point))
    const props = { ...fixture, causalPath, overlays: { ...ALL_ON, causalEquilibrium: true } }
    const model = queryMarketLabChartSeries(props)
    const hq = toHqResearchIndexResponse(model, hqResearchApiId('price'))
    const values = hq.outdata.outvar.find((item) => item.name === SERIES_META.causalEquilibrium.title).data
    rows.forEach((row, index) => {
      expect(values[index]).toBe(fallbackValue('causalEquilibrium', index, props) ?? null)
    })
    expect(values[12]).toBeNull()
    expect(values.slice(16)).toEqual([null, null, null, null])
    props.overlays.causalEquilibrium = false
    expect(
      buildVelaResearchGroups(queryMarketLabChartSeries(props), 'lab')
        .flatMap((group) => group.output.series)
        .find((series) => series.id === 'lab:causalEquilibrium'),
    ).toBeUndefined()
    expect(findSeries(queryMarketLabChartSeries(props), 'causalEquilibrium')).toBeUndefined()
    props.overlays.causalEquilibrium = true
    expect(
      buildVelaResearchGroups(queryMarketLabChartSeries(props), 'lab')
        .flatMap((group) => group.output.series)
        .find((series) => series.id === 'lab:causalEquilibrium'),
    ).toBeDefined()
    expect(findSeries(queryMarketLabChartSeries(props), 'causalEquilibrium').points).toEqual(
      findSeries(model, 'causalEquilibrium').points,
    )
  })

  it('HQ responses preserve every active domain series name, color, render mode and aligned values', () => {
    const model = queryMarketLabChartSeries(fixture)
    const config = buildHqResearchChartConfig(model)
    const price = model.groups.find((group) => group.id === 'price')
    const hqGroups = [price, ...config.paneGroups.flat()]

    for (const group of hqGroups) {
      const response = toHqResearchIndexResponse(model, hqResearchApiId(group.id), {})
      expect(response.code, group.id).toBe(0)
      expect(response.outdata.name).toBe(`Lab · ${group.label}`)
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
