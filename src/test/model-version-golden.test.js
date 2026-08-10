import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { buildCostPath, buildMarketStatePath } from '../domain/market-data/cost.js'
import { buildFormulaPath } from '../domain/market-data/formulaPath.js'
import { MARKET_MODEL_VERSION } from '../domain/market-data/modelVersion.js'
import { loadCsv } from './helpers/loadCsv.js'

const GOLDENS = [
  {
    symbol: 'BTCUSDT',
    path: 'public/data/BTCUSDT-1d.csv',
    tradingDaysPerYear: 365,
    rows: 2045,
    latestDate: '2026-08-07',
    latestWindow: { cost: 45, recent: 6, vol: 45 },
    latestCost: { anchor: 62992.2626309, lower: 60583.36345745, upper: 65401.16180435 },
    latestFormula: {
      horizonSessions: 8,
      side: 'short',
      cycleStartPrice: 66956.15,
      targetPrice: 65401.16180435013,
      recoveryFraction: 0.39228869,
      deltaLower: 57134.25758254,
      deltaUpper: 65782.09088212,
      lpLower: 60811.32089145,
      lpUpper: 65251.42182725,
    },
    july2: {
      prefixRows: 2009,
      window: { cost: 44, recent: 6, vol: 44 },
      horizonSessions: 12,
      deltaLower: 55557.9504411,
      deltaUpper: 70207.64589099,
    },
    deltaCoverage: { validPoints: 2028, segments: 6 },
    pathDigest: '16796c2f9eede0dff1b9f4fc6b90bbac4325961bb0b2c8a851d770036e470fb9',
  },
  {
    symbol: '002594',
    path: 'public/data/002594-1d.csv',
    tradingDaysPerYear: 242,
    rows: 1356,
    latestDate: '2026-08-07',
    latestWindow: { cost: 36, recent: 6, vol: 36 },
    latestCost: { anchor: 88.43765175, lower: 83.53218775, upper: 93.34311576 },
    latestFormula: {
      horizonSessions: 6,
      side: 'short',
      cycleStartPrice: 96.59,
      targetPrice: 93.34311575712906,
      recoveryFraction: 0.39827595,
      deltaLower: 78.25890814,
      deltaUpper: 93.41761909,
      lpLower: 84.60839369,
      lpUpper: 92.4402167,
    },
    july2: {
      prefixRows: 1330,
      window: { cost: 36, recent: 6, vol: 36 },
      horizonSessions: 12,
      deltaLower: 77.83222439,
      deltaUpper: 95.7645309,
    },
    deltaCoverage: { validPoints: 1346, segments: 4 },
    pathDigest: 'ad069a07a4896ab14dd026940e151c2c181cabec3269cd649c3d596a9b226651',
  },
  {
    symbol: '601698',
    path: 'public/data/601698-1d.csv',
    tradingDaysPerYear: 242,
    rows: 1356,
    latestDate: '2026-08-07',
    latestWindow: { cost: 36, recent: 6, vol: 36 },
    latestCost: { anchor: 28.70568801, lower: 26.03626888, upper: 31.37510714 },
    latestFormula: {
      horizonSessions: 10,
      side: 'long',
      cycleStartPrice: 23.57,
      targetPrice: 26.036268881681373,
      recoveryFraction: 0.48022171,
      deltaLower: 22.12242963,
      deltaUpper: 32.46099669,
      lpLower: 26.08168848,
      lpUpper: 31.59368017,
    },
    july2: {
      prefixRows: 1330,
      window: { cost: 36, recent: 6, vol: 36 },
      horizonSessions: 11,
      deltaLower: 25.51745455,
      deltaUpper: 35.47691031,
    },
    deltaCoverage: { validPoints: 1337, segments: 5 },
    pathDigest: '4567d5fc3a2d6cf935f74991f3acae843ddd1238d99560610eb1eb11caa5f6ee',
  },
]

for (const golden of GOLDENS) {
  describe(`${golden.symbol} ${MARKET_MODEL_VERSION} golden`, () => {
    // 行情文件可以正常追加；golden 永远锁定版本发布日之前的不可变前缀。
    const rows = loadCsv(golden.path).filter((row) => row.date <= golden.latestDate)
    const marketPath = buildMarketStatePath(rows, golden.tradingDaysPerYear)
    const costPath = buildCostPath(rows, null, golden.tradingDaysPerYear)
    const formulaPath = buildFormulaPath(rows, {
      deltaSlope: 0.3,
      tradingDaysPerYear: golden.tradingDaysPerYear,
    })
    const latestMarket = marketPath.at(-1)
    const latestCost = costPath.at(-1)
    const latestFormula = formulaPath.at(-1)
    const july2 = formulaPath.find((point) => point.date === '2026-07-02')

    it('显式携带同一模型版本、窗口、Delta 锚、tdpy 与观察日', () => {
      expect(rows).toHaveLength(golden.rows)
      for (const point of [latestMarket, latestCost]) {
        expect(point.modelVersion).toBe(MARKET_MODEL_VERSION)
        expect(point.modelContext).toEqual({
          windowSpec: {
            ...golden.latestWindow,
            mode: 'adaptive-prefix',
            visiblePrefixRows: golden.rows,
            futureRowsUsed: false,
          },
          deltaAnchorSource: 'adaptive-prefix-cost-anchor',
          tradingDaysPerYear: golden.tradingDaysPerYear,
          observationDate: golden.latestDate,
        })
      }
      expect(latestFormula.modelVersion).toBe(MARKET_MODEL_VERSION)
      expect(latestFormula.modelContext).toMatchObject({
        windowSpec: {
          ...golden.latestWindow,
          mode: 'adaptive-prefix',
          visiblePrefixRows: golden.rows,
          futureRowsUsed: false,
        },
        deltaAnchorSource: 'adaptive-prefix-cost-anchor',
        tradingDaysPerYear: golden.tradingDaysPerYear,
        observationDate: golden.latestDate,
        bandAnchor: latestFormula.costAnchor,
        volatility: { value: latestFormula.iv, source: 'rolling-log-return-volatility' },
        deltaSlope: { value: 0.3, source: 'input' },
        formulaHorizon: {
          sessions: golden.latestFormula.horizonSessions,
          mode: 'formula-derived',
          status: 'eligible',
          side: golden.latestFormula.side,
          cycleStartPrice: golden.latestFormula.cycleStartPrice,
          targetPrice: golden.latestFormula.targetPrice,
        },
      })
      expect(july2.modelContext).toMatchObject({
        windowSpec: {
          ...golden.july2.window,
          mode: 'adaptive-prefix',
          visiblePrefixRows: golden.july2.prefixRows,
          futureRowsUsed: false,
        },
        deltaAnchorSource: 'adaptive-prefix-cost-anchor',
        tradingDaysPerYear: golden.tradingDaysPerYear,
        observationDate: '2026-07-02',
        bandAnchor: july2.costAnchor,
        volatility: { value: july2.iv, source: 'rolling-log-return-volatility' },
        deltaSlope: { value: 0.3, source: 'input' },
        formulaHorizon: {
          sessions: golden.july2.horizonSessions,
          mode: 'formula-derived',
          status: 'eligible',
          side: 'long',
          targetSource: 'adaptive-cost-lower',
        },
      })
    })

    it('锁定最新成本带与 2026-07-02 GetDelta 上下沿', () => {
      expect(roundCost(latestMarket)).toEqual(golden.latestCost)
      expect(roundCostPoint(latestCost)).toEqual(golden.latestCost)
      expect({
        horizonSessions: july2.formulaHorizonSessions,
        deltaLower: round(july2.deltaLower),
        deltaUpper: round(july2.deltaUpper),
      }).toEqual({
        horizonSessions: golden.july2.horizonSessions,
        deltaLower: golden.july2.deltaLower,
        deltaUpper: golden.july2.deltaUpper,
      })
      expect({
        horizonSessions: latestFormula.formulaHorizonSessions,
        recoveryFraction: round(latestFormula.recoveryFraction),
        deltaLower: round(latestFormula.deltaLower),
        deltaUpper: round(latestFormula.deltaUpper),
        lpLower: round(latestFormula.lpLowerPrice),
        lpUpper: round(latestFormula.lpUpperPrice),
      }).toEqual({
        horizonSessions: golden.latestFormula.horizonSessions,
        recoveryFraction: golden.latestFormula.recoveryFraction,
        deltaLower: golden.latestFormula.deltaLower,
        deltaUpper: golden.latestFormula.deltaUpper,
        lpLower: golden.latestFormula.lpLower,
        lpUpper: golden.latestFormula.lpUpper,
      })
    })

    it('锁定最新 Delta fieldState 与稀疏路径分段', () => {
      expect(deltaStateGolden(latestFormula.fieldStates.deltaUpper)).toEqual({
        source: 'delta-band',
        status: 'implemented',
        inputMode: 'formula-derived',
        missingInputs: [],
        blockedReasons: [],
        isSynthetic: true,
        modelVersion: MARKET_MODEL_VERSION,
        deltaAnchorSource: 'adaptive-prefix-cost-anchor',
        tradingDaysPerYear: golden.tradingDaysPerYear,
        observationDate: golden.latestDate,
        horizonStatus: 'eligible',
        horizonReason: null,
        horizonSampleSize: golden.rows,
      })
      expect(deltaCoverage(formulaPath)).toEqual(golden.deltaCoverage)
      expect(formulaPathDigest(formulaPath)).toBe(golden.pathDigest)
    })
  })
}

function roundCost(market) {
  return { anchor: round(market.costAnchor), lower: round(market.costLow), upper: round(market.costHigh) }
}

function roundCostPoint(cost) {
  return { anchor: round(cost.anchor), lower: round(cost.lower), upper: round(cost.upper) }
}

function round(value) {
  return Number(value.toFixed(8))
}

function deltaStateGolden(state) {
  return {
    source: state.source,
    status: state.status,
    inputMode: state.inputMode,
    missingInputs: state.missingInputs,
    blockedReasons: state.blockedReasons,
    isSynthetic: state.isSynthetic,
    modelVersion: state.context.modelVersion,
    deltaAnchorSource: state.context.deltaAnchorSource,
    tradingDaysPerYear: state.context.tradingDaysPerYear,
    observationDate: state.context.observationDate,
    horizonStatus: state.context.horizon.status,
    horizonReason: state.context.horizon.reason ?? null,
    horizonSampleSize: state.context.horizon.meanReversion.sampleSize,
  }
}

function deltaCoverage(path) {
  let validPoints = 0
  let segments = 0
  let previousValid = false
  for (const point of path) {
    const valid = [point.deltaLower, point.deltaCost, point.deltaUpper].every(Number.isFinite)
    if (valid) {
      validPoints += 1
      if (!previousValid) segments += 1
    }
    previousValid = valid
  }
  return { validPoints, segments }
}

function formulaPathDigest(path) {
  const projection = path.map((point) => [
    point.date,
    point.modelVersion,
    point.modelContext?.windowSpec?.cost,
    point.modelContext?.windowSpec?.recent,
    point.modelContext?.windowSpec?.vol,
    point.modelContext?.windowSpec?.visiblePrefixRows,
    roundedOrNull(point.modelContext?.bandAnchor),
    roundedOrNull(point.modelContext?.volatility?.value),
    point.modelContext?.volatility?.source,
    roundedOrNull(point.modelContext?.deltaSlope?.value),
    point.modelContext?.deltaSlope?.source,
    point.modelContext?.formulaHorizon?.mode,
    point.modelContext?.formulaHorizon?.status,
    roundedOrNull(point.modelContext?.formulaHorizon?.sessions),
    point.modelContext?.formulaHorizon?.side,
    roundedOrNull(point.modelContext?.formulaHorizon?.cycleStartPrice),
    roundedOrNull(point.modelContext?.formulaHorizon?.targetPrice),
    point.modelContext?.formulaHorizon?.targetSource,
    roundedOrNull(point.costAnchor),
    roundedOrNull(point.costLower),
    roundedOrNull(point.costUpper),
    roundedOrNull(point.deltaLower),
    roundedOrNull(point.deltaCost),
    roundedOrNull(point.deltaUpper),
    point.fieldStates?.deltaUpper?.status,
    (point.fieldStates?.deltaUpper?.blockedReasons ?? []).join(','),
  ])
  return createHash('sha256').update(JSON.stringify(projection)).digest('hex')
}

function roundedOrNull(value) {
  return Number.isFinite(value) ? Number(value.toFixed(10)) : null
}
