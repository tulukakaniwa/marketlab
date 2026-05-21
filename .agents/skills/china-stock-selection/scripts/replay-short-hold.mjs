#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inferTdpy } from '../../../../src/domain/market-data/tdpy.js'
import { buildMarketStatePath } from '../../../../src/domain/market-data/cost.js'
import { deriveDrawdownFeatures, deriveDynamicHoldingState, deriveShortHoldWindow, deviationScore, meanReversionHalfLife, uniswapV3Inventory } from '../../../../src/domain/formulas/core.js'

const ROOT = resolve(fileURLToPath(new URL('../../../..', import.meta.url)))
const args = parseArgs(process.argv.slice(2))
const STRICT_DEFAULTS = {
  targetReturn: 0.03,
  stopLoss: 0.015,
  minZ: 2,
  maxLpPercentile: 3,
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
  maxLpPercentile: 5,
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
const config = {
  profile: profileMode,
  mode: String(args.mode ?? 'replay'),
  market: String(args.market ?? 'A股'),
  feeRate: num(args.fee, 0.0011),
  requireShebao: args['require-shebao'] === 'true',
  minRows: intArg(args['min-rows'], 360),
  format: String(args.format ?? 'markdown'),
  profiles,
}
if (!['replay', 'latest'].includes(config.mode)) fail(`unknown mode "${config.mode}", expected replay or latest`)

const index = readJson(resolvePath(args.index ?? 'src/data/stock-index.json'))
const dataDir = resolvePath(args['data-dir'] ?? 'public/data')
const rowsOut = []

for (const entry of index) {
  if (entry.market !== config.market) continue
  if (EXCLUDED_SYMBOLS.has(entry.symbol)) continue
  if (config.requireShebao && !SHEBAO_WHITELIST.has(entry.symbol)) continue
  const file = join(dataDir, String(entry.url ?? '').split('/').at(-1))
  if (!existsSync(file)) continue
  const rows = parseCsv(readFileSync(file, 'utf8'))
  if (rows.length < config.minRows) continue
  rowsOut.push(...(config.mode === 'latest' ? scanLatestInstrument(entry, rows) : replayInstrument(entry, rows)))
}

const summary = config.mode === 'latest' ? summarizeSignals(rowsOut) : summarize(rowsOut)
if (config.format === 'json') {
  const key = config.mode === 'latest' ? 'signals' : 'trades'
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), config, summary, [key]: rowsOut }, null, 2))
} else if (config.mode === 'latest') {
  printLatestMarkdown({ config, summary, signals: rowsOut })
} else {
  printMarkdown({ config, summary, trades: rowsOut })
}

function scanLatestInstrument(entry, rows) {
  const tdpy = inferTdpy(entry).value
  const marketPath = buildMarketStatePath(rows, tdpy)
  const lpStates = rows.map((row, index) => syntheticLpState(marketPath[index], row))
  const lpValues = lpStates.map((state) => state?.value)
  const signal = buildSignal({ entry, rows, marketPath, lpValues, lpStates, tdpy, index: rows.length - 1 })
  if (!signal?.eligible) return []
  const { profileConfig, ...signalRow } = signal
  return [signalRow]
}

function replayInstrument(entry, rows) {
  const tdpy = inferTdpy(entry).value
  const marketPath = buildMarketStatePath(rows, tdpy)
  const lpStates = rows.map((row, index) => syntheticLpState(marketPath[index], row))
  const lpValues = lpStates.map((state) => state?.value)
  const out = []
  let nextAllowedIndex = 0

  for (let i = 260; i < rows.length - maxProfileHoldingDays - 2; i += 1) {
    if (i < nextAllowedIndex) continue
    const signal = buildSignal({ entry, rows, marketPath, lpValues, lpStates, tdpy, index: i })
    if (!signal?.eligible) continue
    const { profileConfig, ...signalRow } = signal
    const trade = simulateTrade(rows, i, profileConfig, signal)
    if (!trade) continue
    out.push({ ...signalRow, ...trade })
    nextAllowedIndex = i + profileConfig.maxHoldingDays + 1
  }
  return out
}

function buildSignal({ entry, rows, marketPath, lpValues, lpStates, tdpy, index }) {
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

  const lpPercentile = percentile(lpValues.slice(Math.max(0, index - 241), index + 1), lpValues[index])

  const halfLife = meanReversionHalfLife({
    costDistanceSeries: marketPath.slice(Math.max(0, index - 179), index + 1).map((item) => item?.costDistance).filter(Number.isFinite),
    tradingDaysPerYear: tdpy,
  })?.halfLifeDays

  for (const profile of profiles) {
    if (costDistancePct < profile.minCostDistancePct || costDistancePct > profile.maxCostDistancePct) continue
    if (costSlopePct < profile.minCostSlopePct || costSlopePct > profile.maxCostSlopePct) continue
    if (!deviation || deviation.z > -profile.minZ) continue
    if (!Number.isFinite(lpPercentile) || lpPercentile > profile.maxLpPercentile) continue
    if (!Number.isFinite(halfLife) || halfLife > profile.maxHalfLifeDays) continue

    const target = buildTargetPlan({ row, rows, index, market, lpState: lpStates?.[index], profile, deviation, halfLife, lpPercentile, costSlopePct })
    if (!target?.eligible) continue

    return {
      profile: profile.name,
      profileTargetPct: Number.isFinite(target.grossReturn) ? round(target.grossReturn * 100, 2) : null,
      profileStopPct: round(profile.stopLoss * 100, 2),
      targetMode: profile.targetMode,
      targetId: target.id,
      targetPrice: Number.isFinite(target.targetPrice) ? round(target.targetPrice, 3) : null,
      symbol: entry.symbol,
      name: entry.label ?? entry.symbol,
      signalDate: row.date,
      z5: round(deviation.z, 2),
      halfLifeDays: round(halfLife, 1),
      lpPercentile: round(lpPercentile, 1),
      costDistancePct: round(market.costDistance * 100, 2),
      costSlopePct: round(costSlopePct, 2),
      expectedHoldDays: Number.isFinite(target.partialRecoveryDays) ? round(target.partialRecoveryDays, 2) : null,
      dynamicHolding: target.dynamicHolding ?? null,
      ...dynamicColumns(target.dynamicHolding),
      eligible: true,
      profileConfig: profile,
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
  const targetPrice = Number.isFinite(signalPlan?.targetPrice) ? signalPlan.targetPrice : entryPrice * (1 + profile.targetReturn)
  if (targetPrice <= entryPrice) return null
  const stopPrice = entryPrice * (1 - profile.stopLoss)
  const lastExitIndex = Math.min(entryIndex + profile.maxHoldingDays, rows.length - 1)

  for (let i = entryIndex + profile.minSellDays; i <= lastExitIndex; i += 1) {
    const row = rows[i]
    if (row.low <= stopPrice) return tradeResult({ entry, exit: row, entryGap, entryPrice, exitPrice: stopPrice, reason: 'stop', holdDays: i - entryIndex })
    if (row.high >= targetPrice) return tradeResult({ entry, exit: row, entryGap, entryPrice, exitPrice: targetPrice, reason: 'target', holdDays: i - entryIndex })
  }
  const exit = rows[lastExitIndex]
  return tradeResult({ entry, exit, entryGap, entryPrice, exitPrice: exit.close, reason: 'maxHold', holdDays: lastExitIndex - entryIndex })
}

function tradeResult({ entry, exit, entryGap, entryPrice, exitPrice, reason, holdDays }) {
  const grossReturn = exitPrice / entryPrice - 1
  const netReturn = grossReturn - config.feeRate
  return {
    entryDate: entry.date,
    exitDate: exit.date,
    entryGapPct: round(entryGap * 100, 2),
    entryPrice: round(entryPrice, 3),
    exitPrice: round(exitPrice, 3),
    reason,
    holdDays,
    grossReturnPct: round(grossReturn * 100, 2),
    netReturnPct: round(netReturn * 100, 2),
  }
}

function buildTargetPlan({ row, rows, index, market, lpState, profile, deviation, halfLife, lpPercentile, costSlopePct }) {
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
    }
  }

  const dynamicHolding = deriveDynamicHoldingState({
    zScore: deviation.z,
    halfLifeDays: halfLife,
    entryPrice: row.close,
    anchorPrice: market.costAnchor,
    targetPrices: {
      costLower: market.costLow,
      anchor: market.costAnchor,
      lpUpper: lpState?.upperPrice,
    },
    anchorRecoveryFraction: profile.anchorRecoveryFraction,
    minAbsZ: profile.minZ,
    lpPercentile,
    costSlopePct,
    drawdown: deriveDrawdownFeatures({ rows, index }),
    profiles: {
      shortTrade: { minDays: 2, maxDays: profile.maxHoldingDays, minGrossReturn: profile.targetReturn },
      fundCycle: { minDays: 20, maxDays: 120, minGrossReturn: profile.targetReturn },
    },
  })
  if (config.mode === 'replay' && dynamicHolding.holdingPlan.shortTrade.action !== 'execute') return null
  if (config.mode === 'latest' && dynamicHolding.status === '剔除') return null
  const selected = dynamicHolding.holdingPlan.shortTrade.target ?? dynamicHolding.holdingPlan.fundCycle.target ?? dynamicHolding.milestones.find((item) => item.id === 'firstRepair') ?? dynamicHolding.milestones.find((item) => item.id === 'baseAnchor')
  if (!selected) return null
  return {
    eligible: true,
    id: selected.id,
    targetPrice: selected.effectiveTargetPrice,
    grossReturn: selected.grossReturn,
    partialRecoveryDays: selected.expectedDays,
    dynamicHolding,
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
  console.log(`Market: ${config.market} | profile: ${config.profile} | fee: ${pct(config.feeRate)}`)
  for (const profile of config.profiles) {
    console.log(`- ${profile.name}: ${profile.targetMode} target >=${pct(profile.targetReturn)}, stop ${pct(profile.stopLoss)}, maxHold ${profile.maxHoldingDays}d, z5<=-${profile.minZ}, LP P<=${profile.maxLpPercentile}, HL<=${profile.maxHalfLifeDays}d, costDistance ${profile.minCostDistancePct}-${profile.maxCostDistancePct}%`)
  }
  console.log(``)
  console.log(`Trades: ${summary.trades ?? 0} | win ${summary.winRatePct ?? 0}% | target ${summary.targetHitPct ?? 0}% | stop ${summary.stopPct ?? 0}% | avg ${summary.avgNetPct ?? 0}% | median ${summary.medianNetPct ?? 0}%`)
  console.log(`Profile mix: ${formatProfileMix(summary.byProfile)}`)
  console.log(`Risk: p10 ${summary.p10NetPct ?? 0}% | p90 ${summary.p90NetPct ?? 0}% | worst ${summary.worstNetPct ?? 0}% | best ${summary.bestNetPct ?? 0}%`)
  console.log(``)
  console.log(`| profile | state | target | symbol | name | signal | exit | reason | hold | net | z5 | HL | LP P | costDist | gap |`)
  console.log(`| --- | --- | --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |`)
  for (const row of trades.slice(0, 20)) {
    console.log(`| ${row.profile} | ${row.dynamicPhase ?? '-'} | ${targetLabel(row)} | ${row.symbol} | ${row.name} | ${row.signalDate} | ${row.exitDate} | ${row.reason} | ${row.holdDays} | ${row.netReturnPct}% | ${row.z5} | ${row.halfLifeDays} | ${row.lpPercentile} | ${row.costDistancePct}% | ${row.entryGapPct}% |`)
  }
  console.log(``)
  console.log(`Research replay only. It uses local OHLCV plus Market Lab formulas, with no RSI/KDJ/EMA/MA or external factors.`)
}

function printLatestMarkdown({ config, summary, signals }) {
  console.log(`# T+1 Short-Hold Latest Scan`)
  console.log(``)
  console.log(`Market: ${config.market} | profile: ${config.profile} | mode: latest | fee: ${pct(config.feeRate)}`)
  for (const profile of config.profiles) {
    console.log(`- ${profile.name}: ${profile.targetMode} target >=${pct(profile.targetReturn)}, stop ${pct(profile.stopLoss)}, maxHold ${profile.maxHoldingDays}d, z5<=-${profile.minZ}, LP P<=${profile.maxLpPercentile}, HL<=${profile.maxHalfLifeDays}d, costDistance ${profile.minCostDistancePct}-${profile.maxCostDistancePct}%`)
  }
  console.log(``)
  console.log(`Signals: ${summary.signals ?? 0} | Profile mix: ${formatSignalProfileMix(summary.byProfile)}`)
  console.log(``)
  console.log(`| profile | state | target | symbol | name | signal | shortReturn | fundReturn | firstReview | base | stretch | short | fund | reasons |`)
  console.log(`| --- | --- | --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | --- | --- | --- |`)
  for (const row of signals.slice(0, 30)) {
    console.log(`| ${row.profile} | ${row.dynamicPhase ?? '-'} | ${targetLabel(row)} | ${row.symbol} | ${row.name} | ${row.signalDate} | ${row.shortReturnRange ?? '-'} | ${row.fundReturnRange ?? '-'} | ${row.firstReviewDays ?? '-'} | ${row.baseAnchorDays ?? '-'} | ${row.stretchDays ?? '-'} | ${row.shortPlan ?? '-'} | ${row.fundPlan ?? '-'} | ${row.waitingReasons || '-'} |`)
  }
  console.log(``)
  console.log(`Observation scan only. It uses local OHLCV plus Market Lab formulas, with no RSI/KDJ/EMA/MA or external factors.`)
}

function syntheticLpState(market, row) {
  if (!market || !row || !Number.isFinite(market.costAnchor)) return null
  const width = Math.min(Math.max(market.atrPercent ?? 0.05, 0.03), 0.5)
  const lower = market.costAnchor * Math.max(1 - width, 0.001)
  const upper = market.costAnchor * (1 + width)
  const lp = uniswapV3Inventory({ markPrice: row.close, lowerPrice: lower, upperPrice: upper, liquidity: 1 })
  if (!Number.isFinite(lp?.value)) return null
  return { value: lp.value, lowerPrice: lower, upperPrice: upper }
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

function quantile(sorted, q) {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * q)))]
}

function parseArgs(values) {
  const parsed = {}
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i]
    if (!value.startsWith('--')) continue
    const key = value.slice(2)
    const next = values[i + 1]
    parsed[key] = (!next || next.startsWith('--')) ? true : (i++, next)
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
  return {
    name,
    targetReturn: num(args.target, defaults.targetReturn),
    stopLoss: num(args.stop, defaults.stopLoss),
    minZ: num(args['min-z'], defaults.minZ),
    maxLpPercentile: num(args['lp-max'], defaults.maxLpPercentile),
    maxHalfLifeDays: num(args['max-hl'], defaults.maxHalfLifeDays),
    minCostSlopePct: num(args['min-slope'], defaults.minCostSlopePct),
    maxCostSlopePct: num(args['max-slope'], defaults.maxCostSlopePct),
    minCostDistancePct: num(args['min-distance'], defaults.minCostDistancePct),
    maxCostDistancePct: num(args['max-distance'], defaults.maxCostDistancePct),
    maxEntryGapPct: num(args['max-entry-gap'], defaults.maxEntryGapPct),
    minEntryGapPct: num(args['min-entry-gap'], defaults.minEntryGapPct),
    maxHoldingDays: intArg(args['max-hold'], defaults.maxHoldingDays),
    minSellDays: intArg(args['min-sell-days'], defaults.minSellDays),
    targetMode: String(args['target-mode'] ?? defaults.targetMode),
    anchorRecoveryFraction: num(args['anchor-recovery'], defaults.anchorRecoveryFraction),
  }
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
function num(value, fallback) { const n = Number(value); return Number.isFinite(n) ? n : fallback }
function intArg(value, fallback) { const n = Number(value); return Number.isInteger(n) && n > 0 ? n : fallback }
function pct(value) { return `${round(value * 100, 2)}%` }
function nullablePct(value) { return Number.isFinite(value) ? `${value}%` : '-' }
function round(value, digits = 2) { const factor = 10 ** digits; return Math.round(value * factor) / factor }
function fail(message) { console.error(message); process.exit(1) }
