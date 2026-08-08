#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inferTdpy } from '../../../../src/domain/market-data/tdpy.js'
import { buildMarketStatePath } from '../../../../src/domain/market-data/cost.js'
import { deriveDrawdownFeatures, deriveDynamicHoldingState, deriveShortHoldWindow, deviationScore, meanReversionHalfLife } from '../../../../src/domain/formulas/core.js'
import {
  CLAIM_CLASS_CONTRACT,
  SYNTHETIC_CK_GEOMETRY_DISCLOSURE,
  buildSyntheticCkGeometryState,
  empiricalDeviationStats,
  isPositiveMonotonicMeanReversion,
  loadNameMap,
  passesAshareShebaoFilter,
  resolveInstrumentName,
} from './selection-helpers.mjs'

const SCHEMA_VERSION = 'china-stock-selection.replay.v1'
const SUPPORTED_MARKETS = new Set(['A股', '港股'])
const SUPPORTED_FORMATS = new Set(['markdown', 'json'])
const SUPPORTED_MODES = new Set(['replay', 'latest'])
const SUPPORTED_TARGET_MODES = new Set(['structure', 'fixed'])
const STATE_CONTRACT = Object.freeze({
  dataState: ['ready', 'provisional', 'stale', 'invalid'],
  scoreStatus: ['not-applicable'],
  candidateStatus: ['需刷新数据', '剔除', '等待', '观察'],
  executionStatus: ['blocked', 'simulation-only'],
})
const REPLAY_CLAIM_CLASSES = Object.freeze({
  costAnchor: 'sample-estimate',
  deviation: 'sample-estimate',
  empiricalDeviation: 'sample-estimate',
  meanReversion: 'sample-estimate',
  syntheticCkGeometry: 'scenario-proxy',
  target: 'scenario-proxy',
  dynamicHolding: 'scenario-proxy',
  historicalReplay: 'sample-estimate',
  execution: 'missing-input',
})
const SUPPORTED_FLAGS = new Set([
  'profile', 'mode', 'market', 'fee', 'require-shebao', 'min-rows', 'format',
  'index', 'data-dir', 'name-map', 'target', 'stop', 'min-z',
  'ck-geometry-max', 'lp-max', 'max-hl', 'min-slope', 'max-slope',
  'min-distance', 'max-distance', 'max-entry-gap', 'min-entry-gap',
  'max-hold', 'min-sell-days', 'target-mode', 'anchor-recovery',
])
const BOOLEAN_FLAGS = new Set(['require-shebao'])
const ROOT = resolve(fileURLToPath(new URL('../../../..', import.meta.url)))
const args = parseArgs(process.argv.slice(2), SUPPORTED_FLAGS, BOOLEAN_FLAGS)
const STRICT_DEFAULTS = {
  targetReturn: 0.03,
  stopLoss: 0.015,
  minZ: 2,
  maxCkGeometryPercentile: 3,
  maxHalfLifeDays: 12,
  minCostSlopePct: -1,
  maxCostSlopePct: 1,
  minCostDistancePct: 10,
  maxCostDistancePct: 16,
  maxEntryGapPct: 0.5,
  minEntryGapPct: -3,
  maxHoldingDays: 5,
  minSellDays: 1,
  targetMode: 'structure',
  anchorRecoveryFraction: 0.875,
}
const SWING_DEFAULTS = {
  targetReturn: 0.04,
  stopLoss: 0.015,
  minZ: 2.5,
  maxCkGeometryPercentile: 5,
  maxHalfLifeDays: 20,
  minCostSlopePct: -1,
  maxCostSlopePct: 0.5,
  minCostDistancePct: 12,
  maxCostDistancePct: 22,
  maxEntryGapPct: 0.5,
  minEntryGapPct: -3,
  maxHoldingDays: 10,
  minSellDays: 1,
  targetMode: 'structure',
  anchorRecoveryFraction: 0.875,
}

const EXCLUDED_SYMBOLS = new Set([
  '600519', '000858', '000568', '002304', '603369', '000799', '600809', '000596', '600779',
  '000002', '600048', '001979',
  '000661', '600346', '600760',
  '000001', '002142', '600000', '600015', '600016', '600036', '600919', '600926', '601009',
  '601166', '601169', '601229', '601288', '601328', '601398', '601658', '601818', '601838',
  '601916', '601939', '601988', '601998',
])

const SHEBAO_WHITELIST = new Set([
  '000408', '000708', '000776', '000786', '000807', '000876', '000963', '000975', '000983',
  '001391', '001979', '002001', '002027', '002028', '002179', '002236', '002311', '002459',
  '002463', '002594', '002648', '002916', '002938', '300122', '300124', '300347', '300413',
  '300433', '300628', '300760', '300832', '300866', '300979', '600019', '600031', '600048',
  '600066', '600085', '600089', '600176', '600183', '600188', '600196', '600219', '600233',
  '600309', '600362', '600415', '600426', '600489', '600547', '600690', '600741', '600803',
  '600930', '600958', '600989', '601012', '601058', '601100', '601111', '601117', '601319',
  '601336', '601377', '601628', '601633', '601872', '601877', '601888', '601898', '601901',
  '603195', '605117', '688036', '688187', '000799', '000988', '002281', '002837',
])

const profileMode = String(args.profile ?? 'strict')
const profiles = buildProfiles(profileMode)
const maxProfileHoldingDays = Math.max(...profiles.map((profile) => profile.maxHoldingDays))
const marketValues = parseMarkets(args.market ?? 'A股')
const mode = enumArg(args.mode ?? 'replay', SUPPORTED_MODES, 'mode')
const format = enumArg(args.format ?? 'markdown', SUPPORTED_FORMATS, 'format')
const requireShebao = booleanArg(args['require-shebao'], false, 'require-shebao')
const requestedFeeRate = finiteArg(args.fee, 0.0011, 'fee', { min: 0, max: 1, maxExclusive: true })
const indexInput = String(args.index ?? 'src/data/stock-index.json')
const dataDirInput = String(args['data-dir'] ?? 'public/data')
const nameMapInput = String(args['name-map'] ?? defaultNameMapPath())
const nameMap = loadNameMap(resolvePath(nameMapInput))
const config = {
  profile: profileMode,
  mode,
  market: marketValues.join(','),
  markets: marketValues,
  feeRate: requestedFeeRate,
  feeAppliedToReturns: mode === 'replay',
  feeModel: {
    requestedRate: requestedFeeRate,
    appliedRate: mode === 'replay' ? requestedFeeRate : null,
    appliedToReturns: mode === 'replay',
    calculation: mode === 'replay' ? 'netReturn=grossReturn-feeRate-once' : 'not-applied-in-latest-observation-mode',
  },
  requireShebao,
  minRows: positiveIntArg(args['min-rows'], 360, 'min-rows'),
  format,
  intrabarPolicy: 'stop-first-conservative-when-both-hit',
  targetTiming: 'signal-context-frozen-target-recomputed-with-next-session-open',
  targetContextPolicy: 'cost-band-deviation-half-life-and-drawdown-frozen-at-signal-close',
  shebaoEvidence: requireShebao ? 'current-static-list-not-point-in-time' : 'disabled',
  profiles,
}
const researchBoundary = {
  status: config.mode === 'replay' ? 'historical-replay-only' : 'latest-observation-only',
  executionStatus: config.mode === 'replay' ? 'simulation-only' : 'blocked',
  reasons: config.mode === 'replay'
    ? ['historical-daily-ohlcv-fill-model', 'not-live-tradability-or-future-expectancy']
    : ['no-return-or-fill-simulation', 'account-risk-budget-and-live-execution-inputs-unavailable'],
}

const index = readJson(resolvePath(indexInput))
if (!Array.isArray(index)) fail(`stock index must be an array: ${indexInput}`)
const dataDir = resolvePath(dataDirInput)
const rowsOut = []
const skipped = []
const coverage = []
let considered = 0

for (const entry of index) {
  if (!config.markets.includes(entry.market)) continue
  considered += 1
  if (EXCLUDED_SYMBOLS.has(entry.symbol)) {
    skipped.push(skipRecord(entry, 'excluded-static-symbol-list'))
    continue
  }
  if (!passesAshareShebaoFilter(entry, SHEBAO_WHITELIST, config.requireShebao)) {
    skipped.push(skipRecord(entry, 'excluded-social-security-whitelist'))
    continue
  }
  const file = join(dataDir, String(entry.url ?? '').split('/').at(-1))
  if (!existsSync(file)) {
    skipped.push(skipRecord(entry, 'missing-csv'))
    continue
  }
  const rows = parseCsv(readFileSync(file, 'utf8'))
  const dataset = datasetProvenance(entry, rows)
  coverage.push(dataset)
  if (rows.length < config.minRows) {
    skipped.push(skipRecord(entry, 'insufficient-rows', { rows: rows.length, minRows: config.minRows }))
    continue
  }
  const instrumentRows = config.mode === 'latest'
    ? scanLatestInstrument(entry, rows, dataset)
    : replayInstrument(entry, rows, dataset)
  if (!instrumentRows.length) {
    skipped.push(skipRecord(entry, config.mode === 'latest' ? 'no-eligible-latest-signal' : 'no-eligible-replay-trade', {
      dataThrough: dataset.dataThrough,
      rows: dataset.rows,
      staleDays: dataset.staleDays,
    }))
    continue
  }
  rowsOut.push(...instrumentRows)
}

const summary = config.mode === 'latest' ? summarizeSignals(rowsOut) : summarize(rowsOut)
const filters = {
  markets: config.markets,
  staticExcludedSymbols: true,
  staticExcludedSymbolCount: EXCLUDED_SYMBOLS.size,
  requireShebaoForAshareOnly: config.requireShebao,
}
const provenance = {
  runtime: '.agents/skills/china-stock-selection/scripts/replay-short-hold.mjs',
  dataModel: 'local-daily-ohlcv',
  index: indexInput,
  dataDir: dataDirInput,
  nameMap: nameMapInput,
}
const freshness = summarizeFreshness(coverage)
const audit = {
  considered,
  dataReady: coverage.filter((item) => item.rows >= config.minRows).length,
  emitted: rowsOut.length,
  skipped: skipped.length,
  skipReasons: countReasons(skipped),
}
if (config.format === 'json') {
  const key = config.mode === 'latest' ? 'signals' : 'trades'
  console.log(JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    config: {
      ...config,
      requireShebaoForAshareOnly: config.requireShebao,
    },
    provenance,
    filters,
    freshness,
    audit,
    stateContract: STATE_CONTRACT,
    claimClassContract: CLAIM_CLASS_CONTRACT,
    claimClasses: REPLAY_CLAIM_CLASSES,
    researchBoundary,
    syntheticCkGeometry: SYNTHETIC_CK_GEOMETRY_DISCLOSURE,
    summary,
    [key]: rowsOut,
    skipped,
  }, null, 2))
} else if (config.mode === 'latest') {
  printLatestMarkdown({ config, summary, signals: rowsOut })
} else {
  printMarkdown({ config, summary, trades: rowsOut })
}

function scanLatestInstrument(entry, rows, dataset) {
  const tdpy = inferTdpy(entry).value
  const marketPath = buildMarketStatePath(rows, tdpy)
  const ckGeometryStates = rows.map((row, index) => buildSyntheticCkGeometryState(marketPath[index], row))
  const ckGeometryValues = ckGeometryStates.map((state) => state?.normalizedValue)
  const signal = buildSignal({ entry, rows, marketPath, ckGeometryValues, tdpy, index: rows.length - 1, dataset })
  if (!signal?.eligible) return []
  const { profileConfig: _profileConfig, replayContext: _replayContext, ...signalRow } = signal
  return [signalRow]
}

function replayInstrument(entry, rows, dataset) {
  const tdpy = inferTdpy(entry).value
  const marketPath = buildMarketStatePath(rows, tdpy)
  const ckGeometryStates = rows.map((row, index) => buildSyntheticCkGeometryState(marketPath[index], row))
  const ckGeometryValues = ckGeometryStates.map((state) => state?.normalizedValue)
  const out = []
  let nextAllowedIndex = 0

  for (let i = 260; i < rows.length - maxProfileHoldingDays - 2; i += 1) {
    if (i < nextAllowedIndex) continue
    const signal = buildSignal({ entry, rows, marketPath, ckGeometryValues, tdpy, index: i, dataset })
    if (!signal?.eligible) continue
    const { profileConfig, replayContext: _replayContext, ...signalRow } = signal
    const trade = simulateTrade(rows, i, profileConfig, signal)
    if (!trade) continue
    out.push({ ...signalRow, ...trade })
    nextAllowedIndex = i + profileConfig.maxHoldingDays + 1
  }
  return out
}

function buildSignal({ entry, rows, marketPath, ckGeometryValues, tdpy, index, dataset }) {
  const row = rows[index]
  const market = marketPath[index]
  if (!market || !Number.isFinite(market.costDistance) || market.costDistance >= 0) return null

  const costDistancePct = Math.abs(market.costDistance * 100)
  const costSlopePct = (market.costSlope5 ?? 0) * 100
  const deviation = deviationScore({
    costDistance: market.costDistance,
    annualVol: Math.max(market.annualVol ?? 0, 0.01),
    holdingDays: 5,
    tradingDaysPerYear: tdpy,
  })

  const ckGeometryPercentile = percentile(
    ckGeometryValues.slice(Math.max(0, index - 241), index + 1),
    ckGeometryValues[index],
  )
  const deviationStats = empiricalDeviationStats(
    marketPath
      .slice(Math.max(0, index - 725), index + 1)
      .map((item) => item?.costDistance),
    market.costDistance,
  )

  const meanReversion = meanReversionHalfLife({
    costDistanceSeries: marketPath.slice(Math.max(0, index - 179), index + 1).map((item) => item?.costDistance).filter(Number.isFinite),
    tradingDaysPerYear: tdpy,
  })
  const halfLife = isPositiveMonotonicMeanReversion(meanReversion) ? meanReversion.halfLifeDays : null

  for (const profile of profiles) {
    if (costDistancePct < profile.minCostDistancePct || costDistancePct > profile.maxCostDistancePct) continue
    if (costSlopePct < profile.minCostSlopePct || costSlopePct > profile.maxCostSlopePct) continue
    if (!deviation || deviation.z > -profile.minZ) continue
    if (!Number.isFinite(ckGeometryPercentile) || ckGeometryPercentile > profile.maxCkGeometryPercentile) continue
    if (!Number.isFinite(halfLife) || halfLife > profile.maxHalfLifeDays) continue

    const target = buildTargetPlan({ row, rows, index, market, profile, deviation, halfLife, costSlopePct })
    if (!target?.eligible) continue
    const dataState = dataStateRecord(dataset.freshness)
    const signalDecision = resolveSignalStatus({ dataState: dataState.status, dynamicHolding: target.dynamicHolding, targetMode: profile.targetMode })

    return {
      profile: profile.name,
      profileTargetPct: Number.isFinite(target.grossReturn) ? round(target.grossReturn * 100, 2) : null,
      profileStopPct: round(profile.stopLoss * 100, 2),
      targetMode: profile.targetMode,
      targetId: target.id,
      targetPrice: Number.isFinite(target.targetPrice) ? round(target.targetPrice, 3) : null,
      symbol: entry.symbol,
      name: dataset.name,
      nameSource: dataset.nameSource,
      market: entry.market,
      source: dataset.source,
      dataThrough: dataset.dataThrough,
      rows: dataset.rows,
      staleDays: dataset.staleDays,
      freshness: dataset.freshness,
      dataState: dataState.status,
      dataStateReasons: dataState.reasons,
      scoreStatus: 'not-applicable',
      provenance: {
        marketSource: dataset.source,
        nameSource: dataset.nameSource,
        dataThrough: dataset.dataThrough,
        rows: dataset.rows,
      },
      candidateStatus: signalDecision.status,
      // Compatibility alias. New consumers must use candidateStatus.
      status: signalDecision.status,
      statusReasons: signalDecision.reasons,
      executionStatus: researchBoundary.executionStatus,
      executionReasons: researchBoundary.reasons,
      claimClasses: REPLAY_CLAIM_CLASSES,
      signalDate: row.date,
      z5: round(deviation.z, 2),
      halfLifeDays: round(halfLife, 1),
      meanReversionRho: round(meanReversion.rho, 6),
      meanReversionDecayMode: meanReversion.decayMode,
      deviationPercentilePct: round(deviation.deviationPercentile * 100, 1),
      deviationTwoSidedTailProbabilityPct: round(deviation.twoSidedTailProbability * 100, 1),
      deviationProbabilitySemantics: deviation.probabilitySemantics,
      empiricalDeviationPercentilePct: nullableRound(deviationStats?.percentilePct, 1),
      empiricalDeviationLowerTailPct: nullableRound(deviationStats?.lowerTailPct, 1),
      empiricalDeviationUpperTailPct: nullableRound(deviationStats?.upperTailPct, 1),
      empiricalDeviationTwoSidedTailPct: nullableRound(deviationStats?.twoSidedTailPct, 1),
      empiricalDeviationSampleSize: deviationStats?.sampleSize ?? 0,
      empiricalDeviationInterpretation: deviationStats?.interpretation ?? null,
      ckGeometryPercentile: round(ckGeometryPercentile, 1),
      ckGeometryModel: SYNTHETIC_CK_GEOMETRY_DISCLOSURE.model,
      ckGeometryInterpretation: SYNTHETIC_CK_GEOMETRY_DISCLOSURE.interpretation,
      costDistancePct: round(market.costDistance * 100, 2),
      costSlopePct: round(costSlopePct, 2),
      expectedHoldDays: Number.isFinite(target.partialRecoveryDays) ? round(target.partialRecoveryDays, 2) : null,
      dynamicHolding: target.dynamicHolding ?? null,
      ...dynamicColumns(target.dynamicHolding),
      eligible: true,
      profileConfig: profile,
      replayContext: { market, deviation, halfLife, costSlopePct, index },
    }
  }

  return null
}

function simulateTrade(rows, signalIndex, profile, signalPlan) {
  const entryIndex = signalIndex + 1
  if (entryIndex + profile.minSellDays >= rows.length) return null
  const signal = rows[signalIndex]
  const entry = rows[entryIndex]
  const entryGap = entry.open / signal.close - 1
  if (entryGap > profile.maxEntryGapPct / 100 || entryGap < profile.minEntryGapPct / 100) return null

  const entryPrice = entry.open
  const entryTarget = recomputeTargetAtEntry({ rows, signalIndex, entry, profile, signalPlan })
  if (!entryTarget?.eligible) return null
  const targetPrice = Number.isFinite(entryTarget.targetPrice)
    ? entryTarget.targetPrice
    : entryPrice * (1 + profile.targetReturn)
  if (targetPrice <= entryPrice) return null
  const stopPrice = entryPrice * (1 - profile.stopLoss)
  const lastExitIndex = Math.min(entryIndex + profile.maxHoldingDays, rows.length - 1)

  for (let i = entryIndex + profile.minSellDays; i <= lastExitIndex; i += 1) {
    const row = rows[i]
    const stopHit = row.low <= stopPrice
    const targetHit = row.high >= targetPrice
    if (stopHit) return tradeResult({
      entry,
      exit: row,
      entryGap,
      entryPrice,
      exitPrice: stopPrice,
      reason: 'stop',
      holdDays: i - entryIndex,
      targetPrice,
      entryTarget,
      signalPlan,
      intrabarBothHit: targetHit,
    })
    if (targetHit) return tradeResult({
      entry,
      exit: row,
      entryGap,
      entryPrice,
      exitPrice: targetPrice,
      reason: 'target',
      holdDays: i - entryIndex,
      targetPrice,
      entryTarget,
      signalPlan,
    })
  }
  const exit = rows[lastExitIndex]
  return tradeResult({ entry, exit, entryGap, entryPrice, exitPrice: exit.close, reason: 'maxHold', holdDays: lastExitIndex - entryIndex, targetPrice, entryTarget, signalPlan })
}

function recomputeTargetAtEntry({ rows, signalIndex, entry, profile, signalPlan }) {
  const context = signalPlan?.replayContext
  if (!context) return null
  return buildTargetPlan({
    row: { ...entry, close: entry.open },
    rows,
    index: signalIndex,
    market: context.market,
    profile,
    deviation: context.deviation,
    halfLife: context.halfLife,
    costSlopePct: context.costSlopePct,
  })
}

function tradeResult({
  entry,
  exit,
  entryGap,
  entryPrice,
  exitPrice,
  reason,
  holdDays,
  targetPrice = null,
  entryTarget = null,
  signalPlan = null,
  intrabarBothHit = false,
}) {
  const grossReturn = exitPrice / entryPrice - 1
  const netReturn = grossReturn - config.feeRate
  return {
    entryDate: entry.date,
    exitDate: exit.date,
    entryGapPct: round(entryGap * 100, 2),
    entryPrice: round(entryPrice, 3),
    exitPrice: round(exitPrice, 3),
    signalTargetPrice: Number.isFinite(signalPlan?.targetPrice) ? round(signalPlan.targetPrice, 3) : null,
    targetPrice: Number.isFinite(targetPrice) ? round(targetPrice, 3) : null,
    targetId: entryTarget?.id ?? signalPlan?.targetId ?? null,
    targetRecomputedAtEntry: true,
    targetTiming: config.targetTiming,
    targetContextPolicy: config.targetContextPolicy,
    reason,
    intrabarBothHit,
    intrabarPolicy: config.intrabarPolicy,
    holdDays,
    grossReturnPct: round(grossReturn * 100, 2),
    netReturnPct: round(netReturn * 100, 2),
  }
}

function buildTargetPlan({ row, rows, index, market, profile, deviation, halfLife, costSlopePct }) {
  const dynamicHolding = deriveDynamicHoldingState({
    zScore: deviation.z,
    halfLifeDays: halfLife,
    entryPrice: row.close,
    anchorPrice: market.costAnchor,
    targetPrices: {
      costLower: market.costLow,
      anchor: market.costAnchor,
    },
    anchorRecoveryFraction: profile.anchorRecoveryFraction,
    minAbsZ: profile.minZ,
    costSlopePct,
    drawdown: deriveDrawdownFeatures({ rows, index }),
    profiles: {
      shortTrade: { minDays: 2, maxDays: profile.maxHoldingDays, minGrossReturn: profile.targetReturn },
      fundCycle: { minDays: 20, maxDays: 120, minGrossReturn: profile.targetReturn },
    },
  })
  if (config.mode === 'replay' && dynamicHolding.holdingPlan.shortTrade.action !== 'execute') return null
  if (config.mode === 'latest' && dynamicHolding.status === '剔除') return null

  if (profile.targetMode === 'fixed') {
    const recoveryFraction = profile.targetReturn / Math.abs(market.costDistance)
    const window = deriveShortHoldWindow({
      zScore: deviation.z,
      halfLifeDays: halfLife,
      costDistance: market.costDistance,
      recoveryFraction,
      minGrossReturn: profile.targetReturn,
      maxHoldingDays: profile.maxHoldingDays,
      minExecutableDays: profile.minSellDays,
      minAbsZ: profile.minZ,
    })
    if (!window?.eligible) return null
    return {
      eligible: true,
      id: 'fixed',
      targetPrice: null,
      grossReturn: profile.targetReturn,
      partialRecoveryDays: window.partialRecoveryDays,
      dynamicHolding: {
        ...dynamicHolding,
        targetInputMode: 'fixed-return-replay-assumption-with-structural-gates',
        syntheticCkGeometryUsedAsTarget: false,
      },
    }
  }
  const selected = dynamicHolding.holdingPlan.shortTrade.target ??
    dynamicHolding.holdingPlan.fundCycle.target ??
    dynamicHolding.milestones.find((item) =>
      ['firstRepair', 'baseAnchor'].includes(item.id) &&
      Number.isFinite(item.grossReturn) && item.grossReturn >= profile.targetReturn &&
      Number.isFinite(item.effectiveTargetPrice) && item.effectiveTargetPrice > row.close &&
      !item.blockedReasons?.includes('target-behind-entry'),
    )
  if (!selected || selected.grossReturn < profile.targetReturn || selected.effectiveTargetPrice <= row.close) return null
  return {
    eligible: true,
    id: selected.id,
    targetPrice: selected.effectiveTargetPrice,
    grossReturn: selected.grossReturn,
    partialRecoveryDays: selected.expectedDays,
    dynamicHolding: {
      ...dynamicHolding,
      targetInputMode: 'cost-band-and-anchor-only',
      syntheticCkGeometryUsedAsTarget: false,
    },
  }
}

function summarize(rows) {
  if (!rows.length) return { trades: 0, byProfile: {} }
  return {
    ...summarizeStats(rows),
    byProfile: Object.fromEntries([...new Set(rows.map((row) => row.profile))].map((profile) => [
      profile,
      summarizeStats(rows.filter((row) => row.profile === profile)),
    ])),
  }
}

function summarizeSignals(rows) {
  return {
    signals: rows.length,
    byProfile: Object.fromEntries([...new Set(rows.map((row) => row.profile))].map((profile) => [
      profile,
      rows.filter((row) => row.profile === profile).length,
    ])),
  }
}

function summarizeStats(rows) {
  const returns = rows.map((row) => row.netReturnPct / 100).sort((a, b) => a - b)
  const avg = returns.reduce((sum, item) => sum + item, 0) / returns.length
  const winCount = rows.filter((row) => row.netReturnPct > 0).length
  const targetCount = rows.filter((row) => row.reason === 'target').length
  const stopCount = rows.filter((row) => row.reason === 'stop').length
  return {
    trades: rows.length,
    winRatePct: round(winCount / rows.length * 100, 2),
    targetHitPct: round(targetCount / rows.length * 100, 2),
    stopPct: round(stopCount / rows.length * 100, 2),
    avgNetPct: round(avg * 100, 2),
    medianNetPct: round(quantile(returns, 0.5) * 100, 2),
    p10NetPct: round(quantile(returns, 0.1) * 100, 2),
    p90NetPct: round(quantile(returns, 0.9) * 100, 2),
    worstNetPct: round(returns[0] * 100, 2),
    bestNetPct: round(returns.at(-1) * 100, 2),
  }
}

function printMarkdown({ config, summary, trades }) {
  console.log(`# T+1 Short-Hold Replay`)
  console.log(``)
  console.log(`Markets: ${config.markets.join(', ')} | profile: ${config.profile} | fee: ${pct(config.feeRate)} applied once to each replay return`)
  console.log(`Source: ${provenance.index} + ${provenance.dataDir} | freshness: ${freshnessText(freshness)}`)
  console.log(`Filters: static-excluded-symbols=${filters.staticExcludedSymbolCount}, A-share shebao=${onOff(filters.requireShebaoForAshareOnly)} | skipped: ${reasonSummary(audit.skipReasons)}`)
  for (const profile of config.profiles) {
    console.log(`- ${profile.name}: ${profile.targetMode} target >=${pct(profile.targetReturn)}, stop ${pct(profile.stopLoss)}, maxHold ${profile.maxHoldingDays}d, z5<=-${profile.minZ}, synthetic CK geometry P<=${profile.maxCkGeometryPercentile}, HL<=${profile.maxHalfLifeDays}d, costDistance ${profile.minCostDistancePct}-${profile.maxCostDistancePct}%`)
  }
  console.log(``)
  console.log(`Trades: ${summary.trades ?? 0} | win ${summary.winRatePct ?? 0}% | target ${summary.targetHitPct ?? 0}% | stop ${summary.stopPct ?? 0}% | avg ${summary.avgNetPct ?? 0}% | median ${summary.medianNetPct ?? 0}%`)
  console.log(`Profile mix: ${formatProfileMix(summary.byProfile)}`)
  console.log(`Risk: p10 ${summary.p10NetPct ?? 0}% | p90 ${summary.p90NetPct ?? 0}% | worst ${summary.worstNetPct ?? 0}% | best ${summary.bestNetPct ?? 0}%`)
  console.log(``)
  console.log(`| profile | status / phase | status reason | target | symbol | name | source | through / rows / age | signal | exit | exit reason | hold | net | z5 | HL | normal P | normal tail | empirical P | CK geom P | costDist | gap |`)
  console.log(`| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |`)
  for (const row of trades.slice(0, 20)) {
    console.log(`| ${row.profile} | ${row.status} / ${row.dynamicPhase ?? '-'} | ${row.statusReasons.join(',')} | ${targetLabel(row)} | ${row.symbol} | ${row.name} | ${row.source} | ${row.dataThrough} / ${row.rows} / ${row.staleDays ?? '?'}d | ${row.signalDate} | ${row.exitDate} | ${row.reason} | ${row.holdDays} | ${row.netReturnPct}% | ${row.z5} | ${row.halfLifeDays} | ${nullablePct(row.deviationPercentilePct)} | ${nullablePct(row.deviationTwoSidedTailProbabilityPct)} | ${nullablePct(row.empiricalDeviationPercentilePct)} | ${nullablePct(row.ckGeometryPercentile)} | ${row.costDistancePct}% | ${row.entryGapPct}% |`)
  }
  console.log(``)
  console.log(`Replay assumptions: signal-day cost band, deviation, half-life and drawdown stay frozen; target return/executability is recomputed with the next-session open. When stop and target are both inside one OHLC bar, stop wins conservatively. Only positive monotonic AR decay is eligible. A requested social-security whitelist is a current static list, not point-in-time history.`)
  console.log(`Research replay only. Normal-reference deviation P/tail and empirical ranks describe extremeness, not mean-reversion probability. Synthetic CK geometry is a normalized shape diagnostic, not a real LP position, token holding, fee income, or investment return; it is not used as a target price. No RSI/KDJ/EMA/MA or external factors are used.`)
}

function printLatestMarkdown({ config, summary, signals }) {
  console.log(`# T+1 Short-Hold Latest Scan`)
  console.log(``)
  console.log(`Markets: ${config.markets.join(', ')} | profile: ${config.profile} | mode: latest | fee: not applied (requested ${pct(config.feeRate)} is ignored because no return is simulated)`)
  console.log(`Source: ${provenance.index} + ${provenance.dataDir} | freshness: ${freshnessText(freshness)}`)
  console.log(`Filters: static-excluded-symbols=${filters.staticExcludedSymbolCount}, A-share shebao=${onOff(filters.requireShebaoForAshareOnly)} | skipped: ${reasonSummary(audit.skipReasons)}`)
  for (const profile of config.profiles) {
    console.log(`- ${profile.name}: ${profile.targetMode} target >=${pct(profile.targetReturn)}, stop ${pct(profile.stopLoss)}, maxHold ${profile.maxHoldingDays}d, z5<=-${profile.minZ}, synthetic CK geometry P<=${profile.maxCkGeometryPercentile}, HL<=${profile.maxHalfLifeDays}d, costDistance ${profile.minCostDistancePct}-${profile.maxCostDistancePct}%`)
  }
  console.log(``)
  console.log(`Signals: ${summary.signals ?? 0} | Profile mix: ${formatSignalProfileMix(summary.byProfile)}`)
  console.log(``)
  console.log(`| profile | status / phase | status reason | target | symbol | name | source | through / rows / age | signal | normal P | normal tail | empirical P | CK geom P | shortReturn | fundReturn | firstReview | base | stretch | short | fund | dynamic reasons |`)
  console.log(`| --- | --- | --- | --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- | ---: | ---: | ---: | --- | --- | --- |`)
  for (const row of signals.slice(0, 30)) {
    console.log(`| ${row.profile} | ${row.status} / ${row.dynamicPhase ?? '-'} | ${row.statusReasons.join(',')} | ${targetLabel(row)} | ${row.symbol} | ${row.name} | ${row.source} | ${row.dataThrough} / ${row.rows} / ${row.staleDays ?? '?'}d | ${row.signalDate} | ${nullablePct(row.deviationPercentilePct)} | ${nullablePct(row.deviationTwoSidedTailProbabilityPct)} | ${nullablePct(row.empiricalDeviationPercentilePct)} | ${nullablePct(row.ckGeometryPercentile)} | ${row.shortReturnRange ?? '-'} | ${row.fundReturnRange ?? '-'} | ${row.firstReviewDays ?? '-'} | ${row.baseAnchorDays ?? '-'} | ${row.stretchDays ?? '-'} | ${row.shortPlan ?? '-'} | ${row.fundPlan ?? '-'} | ${row.waitingReasons || '-'} |`)
  }
  console.log(``)
  console.log(`Observation scan only. Normal-reference deviation P/tail and empirical ranks describe extremeness, not mean-reversion probability. Synthetic CK geometry is a normalized shape diagnostic, not a real LP position, token holding, fee income, or investment return; it is not used as a target price. No RSI/KDJ/EMA/MA or external factors are used.`)
}

function targetLabel(row) {
  return row.targetPrice === null ? `${row.targetId}@${nullablePct(row.profileTargetPct)}` : `${row.targetId}@${row.targetPrice}`
}

function dynamicColumns(dynamicHolding) {
  if (!dynamicHolding) return {}
  const expectation = dynamicHolding.expectation ?? {}
  const shortExpectation = expectation.profileExpectations?.shortTrade
  const fundExpectation = expectation.profileExpectations?.fundCycle
  const short = dynamicHolding.holdingPlan?.shortTrade
  const fund = dynamicHolding.holdingPlan?.fundCycle
  return {
    dynamicStatus: dynamicHolding.status,
    dynamicPhase: dynamicHolding.phaseLabel,
    shortPlan: short ? `${short.status}/${short.action}` : null,
    fundPlan: fund ? `${fund.status}/${fund.action}` : null,
    firstReviewDays: fund?.firstReviewDays ?? expectation.firstRepairDays ?? null,
    baseAnchorDays: expectation.baseAnchorDays ?? null,
    stretchDays: expectation.stretchDays ?? null,
    expectedReturnRange: expectation.baseReturnPct ?? null,
    shortReturnRange: shortExpectation?.expectedReturnRangePct ?? null,
    fundReturnRange: fundExpectation?.expectedReturnRangePct ?? null,
    waitingReasons: dynamicHolding.blockedReasons?.join(',') ?? '',
  }
}

function resolveSignalStatus({ dataState, dynamicHolding, targetMode }) {
  if (dataState === 'stale' || dataState === 'invalid') {
    return {
      status: '需刷新数据',
      reasons: [`data-state-${dataState}`],
    }
  }
  if (!dynamicHolding) {
    return {
      status: '等待',
      reasons: ['dynamic-holding-missing'],
    }
  }
  if (dynamicHolding?.status === '剔除') {
    return {
      status: '剔除',
      reasons: uniqueStrings(['dynamic-holding-excluded', ...(dynamicHolding.blockedReasons ?? [])]),
    }
  }
  if (dynamicHolding?.status === '等待') {
    return {
      status: '等待',
      reasons: uniqueStrings(['dynamic-holding-wait', ...(dynamicHolding.blockedReasons ?? [])]),
    }
  }
  return {
    status: '观察',
    reasons: [
      'profile-thresholds-passed',
      'positive-monotonic-mean-reversion',
      targetMode === 'fixed' ? 'fixed-target-replay-assumption' : 'forward-structural-target-available',
    ],
  }
}

function datasetProvenance(entry, rows) {
  const latest = rows.at(-1)
  const nameInfo = resolveInstrumentName(entry, nameMap)
  const freshness = freshnessRecord(latest?.date, rows.length)
  return {
    symbol: entry.symbol,
    market: entry.market,
    source: entry.source ?? 'local csv',
    name: nameInfo.name,
    nameSource: nameInfo.source,
    dataThrough: latest?.date ?? null,
    rows: rows.length,
    staleDays: freshness.staleDays,
    freshness,
  }
}

function skipRecord(entry, reason, detail = {}) {
  return {
    symbol: entry.symbol,
    market: entry.market,
    source: entry.source ?? 'local csv',
    reason,
    ...detail,
  }
}

function freshnessRecord(dataThrough, rows) {
  const staleDays = ageInDays(dataThrough)
  return {
    status: !Number.isFinite(staleDays) ? 'invalid-date' : staleDays > 10 ? 'stale' : 'current-enough-for-research',
    dataThrough,
    rows,
    staleDays: Number.isFinite(staleDays) ? staleDays : null,
    basis: 'calendar-days-from-latest-local-row',
    staleThresholdDays: 10,
  }
}

function dataStateRecord(freshness) {
  if (freshness.status === 'invalid-date') {
    return { status: 'invalid', reasons: ['latest-local-row-date-invalid'] }
  }
  if (freshness.status === 'stale') {
    return { status: 'stale', reasons: ['data-stale-over-10-calendar-days'] }
  }
  return {
    status: 'provisional',
    reasons: ['local-daily-ohlcv-path-only; corporate-actions-and-live-execution-state-not-verified'],
  }
}

function summarizeFreshness(rows) {
  if (!rows.length) {
    return {
      status: 'no-local-csv-coverage',
      basis: 'calendar-days-from-latest-local-row',
      staleThresholdDays: 10,
      staleInstruments: 0,
    }
  }
  const dates = rows.map((row) => row.dataThrough).filter(Boolean).sort()
  const staleValues = rows.map((row) => row.staleDays).filter(Number.isFinite)
  const staleInstruments = rows.filter((row) => row.freshness.status !== 'current-enough-for-research').length
  return {
    status: staleInstruments > 0 ? 'contains-stale-or-invalid-data' : 'current-enough-for-research',
    oldestDataThrough: dates[0] ?? null,
    newestDataThrough: dates.at(-1) ?? null,
    maxStaleDays: staleValues.length ? Math.max(...staleValues) : null,
    basis: 'calendar-days-from-latest-local-row',
    staleThresholdDays: 10,
    staleInstruments,
  }
}

function countReasons(rows) {
  const counts = {}
  for (const row of rows) counts[row.reason] = (counts[row.reason] ?? 0) + 1
  return counts
}

function ageInDays(dateText) {
  const date = new Date(`${dateText}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return Number.POSITIVE_INFINITY
  return Math.floor((Date.now() - date.getTime()) / 86400000)
}

function parseCsv(text) {
  return text.trim().split(/\r?\n/).slice(1).map((line) => {
    const [date, open, high, low, close, volume] = line.split(',')
    return { date, open: +open, high: +high, low: +low, close: +close, volume: +volume }
  }).filter((row) => row.date && [row.open, row.high, row.low, row.close, row.volume].every(Number.isFinite) && row.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
}

function percentile(values, current) {
  const valid = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (!valid.length || !Number.isFinite(current)) return null
  return valid.filter((value) => value <= current).length / valid.length * 100
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch (error) { fail(`cannot read ${path}: ${error.message}`) }
}

function defaultNameMapPath() {
  const candidates = [
    'skills/china-stock-selection/references/stock-names.json',
    '.agents/skills/china-stock-selection/references/stock-names.json',
    '.claude/skills/china-stock-selection/references/stock-names.json',
  ]
  return candidates.find((candidate) => existsSync(resolvePath(candidate))) ?? candidates[1]
}

function quantile(sorted, q) {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * q)))]
}

function parseArgs(values, supported, booleanFlags) {
  const parsed = {}
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i]
    if (!value.startsWith('--')) fail(`unexpected positional argument "${value}"`)
    const key = value.slice(2)
    if (!supported.has(key)) fail(`unknown option --${key}`)
    const next = values[i + 1]
    if (!next || next.startsWith('--')) {
      if (!booleanFlags.has(key)) fail(`missing value for --${key}`)
      parsed[key] = true
      continue
    }
    parsed[key] = next
    i += 1
  }
  return parsed
}

function buildProfiles(mode) {
  if (mode === 'strict') return [profileFromArgs('strict-5d', STRICT_DEFAULTS)]
  if (mode === 'swing') return [profileFromArgs('swing-10d', SWING_DEFAULTS)]
  if (mode === 'combo') {
    return [
      profileFromArgs('fast-5d', STRICT_DEFAULTS),
      profileFromArgs('swing-10d', SWING_DEFAULTS),
    ]
  }
  fail(`unknown profile "${mode}", expected strict, swing, or combo`)
}

function profileFromArgs(name, defaults) {
  const profile = {
    name,
    targetReturn: finiteArg(args.target, defaults.targetReturn, 'target', { min: 0, max: 1, minExclusive: true, maxExclusive: true }),
    stopLoss: finiteArg(args.stop, defaults.stopLoss, 'stop', { min: 0, max: 1, minExclusive: true, maxExclusive: true }),
    minZ: finiteArg(args['min-z'], defaults.minZ, 'min-z', { min: 0 }),
    maxCkGeometryPercentile: finiteArg(
      args['ck-geometry-max'] ?? args['lp-max'],
      defaults.maxCkGeometryPercentile,
      args['ck-geometry-max'] === undefined && args['lp-max'] !== undefined ? 'lp-max' : 'ck-geometry-max',
      { min: 0, max: 100 },
    ),
    maxHalfLifeDays: finiteArg(args['max-hl'], defaults.maxHalfLifeDays, 'max-hl', { min: 0, minExclusive: true }),
    minCostSlopePct: finiteArg(args['min-slope'], defaults.minCostSlopePct, 'min-slope'),
    maxCostSlopePct: finiteArg(args['max-slope'], defaults.maxCostSlopePct, 'max-slope'),
    minCostDistancePct: finiteArg(args['min-distance'], defaults.minCostDistancePct, 'min-distance', { min: 0 }),
    maxCostDistancePct: finiteArg(args['max-distance'], defaults.maxCostDistancePct, 'max-distance', { min: 0 }),
    maxEntryGapPct: finiteArg(args['max-entry-gap'], defaults.maxEntryGapPct, 'max-entry-gap'),
    minEntryGapPct: finiteArg(args['min-entry-gap'], defaults.minEntryGapPct, 'min-entry-gap'),
    maxHoldingDays: positiveIntArg(args['max-hold'], defaults.maxHoldingDays, 'max-hold'),
    minSellDays: positiveIntArg(args['min-sell-days'], defaults.minSellDays, 'min-sell-days'),
    targetMode: enumArg(args['target-mode'] ?? defaults.targetMode, SUPPORTED_TARGET_MODES, 'target-mode'),
    anchorRecoveryFraction: finiteArg(args['anchor-recovery'], defaults.anchorRecoveryFraction, 'anchor-recovery', { min: 0, max: 1, minExclusive: true }),
  }
  if (profile.minCostSlopePct > profile.maxCostSlopePct) fail('invalid slope bounds: --min-slope must be <= --max-slope')
  if (profile.minCostDistancePct > profile.maxCostDistancePct) fail('invalid distance bounds: --min-distance must be <= --max-distance')
  if (profile.minEntryGapPct > profile.maxEntryGapPct) fail('invalid entry-gap bounds: --min-entry-gap must be <= --max-entry-gap')
  if (profile.minSellDays > profile.maxHoldingDays) fail('invalid holding bounds: --min-sell-days must be <= --max-hold')
  return profile
}

function formatProfileMix(byProfile = {}) {
  const entries = Object.entries(byProfile)
  if (!entries.length) return 'none'
  return entries.map(([profile, stats]) => `${profile} ${stats.trades} (avg ${stats.avgNetPct}%, median ${stats.medianNetPct}%)`).join(' | ')
}

function formatSignalProfileMix(byProfile = {}) {
  const entries = Object.entries(byProfile)
  if (!entries.length) return 'none'
  return entries.map(([profile, count]) => `${profile} ${count}`).join(' | ')
}

function resolvePath(path) { return resolve(ROOT, String(path)) }
function finiteArg(value, fallback, name, {
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY,
  minExclusive = false,
  maxExclusive = false,
} = {}) {
  if (value === undefined) return fallback
  const parsed = Number(value)
  const belowMin = minExclusive ? parsed <= min : parsed < min
  const aboveMax = maxExclusive ? parsed >= max : parsed > max
  if (!Number.isFinite(parsed) || belowMin || aboveMax) {
    const lower = Number.isFinite(min) ? `${minExclusive ? '(' : '['}${min}` : '(-inf'
    const upper = Number.isFinite(max) ? `${max}${maxExclusive ? ')' : ']'}` : 'inf)'
    fail(`invalid --${name} value "${value}", expected a finite number in ${lower}, ${upper}`)
  }
  return parsed
}

function positiveIntArg(value, fallback, name) {
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) fail(`invalid --${name} value "${value}", expected a positive integer`)
  return parsed
}

function parseMarkets(value) {
  const parsed = [...new Set(String(value).split(',').map((item) => item.trim()).filter(Boolean))]
  if (!parsed.length) fail('market must contain A股 or 港股')
  const invalid = parsed.filter((market) => !SUPPORTED_MARKETS.has(market))
  if (invalid.length) fail(`unknown market "${invalid.join(',')}", expected A股, 港股, or A股,港股`)
  return parsed
}

function enumArg(value, supported, name) {
  const normalized = String(value)
  if (!supported.has(normalized)) fail(`unknown ${name} "${normalized}", expected ${[...supported].join(' or ')}`)
  return normalized
}

function booleanArg(value, fallback, name) {
  if (value === undefined) return fallback
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  fail(`invalid --${name} value "${value}", expected true or false`)
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.length > 0))]
}

function onOff(value) { return value ? 'on' : 'off' }

function freshnessText(value) {
  if (value.status === 'no-local-csv-coverage') return value.status
  return `${value.status}, ${value.oldestDataThrough}..${value.newestDataThrough}, maxAge=${value.maxStaleDays ?? '?'}d`
}

function reasonSummary(reasons) {
  const entries = Object.entries(reasons)
  return entries.length ? entries.map(([reason, count]) => `${reason}=${count}`).join(', ') : 'none'
}

function pct(value) { return `${round(value * 100, 2)}%` }
function nullablePct(value) { return Number.isFinite(value) ? `${value}%` : '-' }
function round(value, digits = 2) { const factor = 10 ** digits; return Math.round(value * factor) / factor }
function nullableRound(value, digits = 2) { return Number.isFinite(value) ? round(value, digits) : null }
function fail(message) { console.error(message); process.exit(1) }
