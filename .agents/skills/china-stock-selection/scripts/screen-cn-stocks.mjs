#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inferTdpy } from '../../../../src/domain/market-data/tdpy.js'
import { buildMarketStatePath } from '../../../../src/domain/market-data/cost.js'
import {
  asianOption,
  bachelierOption,
  blackScholes,
  capitalEfficiency,
  deviationScore,
  gammaPnl,
  getDeltaBands,
  impermanentLoss,
  liquidityFingerprint,
  meanReversionHalfLife,
  riskSurface,
  vixFix,
  volConfidence,
} from '../../../../src/domain/formulas/core.js'
import { formulaStages } from '../../../../src/domain/formulas/registry.js'
import { computeRSI } from '../../../../src/domain/indicators/rsi.js'
import { computeKDJ } from '../../../../src/domain/indicators/kdj.js'
import { buildDecisionGraph } from '../../../../src/domain/strategy-planning/orderPlan.js'
import { buildScenario, loadNameMap, resolveInstrumentName, scenarioText } from './selection-helpers.mjs'

const ROOT = resolve(fileURLToPath(new URL('../../../..', import.meta.url)))
const args = parseArgs(process.argv.slice(2))
const markets = new Set(String(args.market ?? 'A股,港股').split(',').map((item) => item.trim()).filter(Boolean))
const top = positiveInt(args.top, 20)
const minRows = positiveInt(args['min-rows'], 180)
const format = String(args.format ?? 'markdown')
const indexPath = resolvePath(args.index ?? 'src/data/stock-index.json')
const dataDir = resolvePath(args['data-dir'] ?? 'public/data')
const nameMapPath = resolvePath(args['name-map'] ?? '.agents/skills/china-stock-selection/references/stock-names.json')
const nameMap = loadNameMap(nameMapPath)

const index = readJson(indexPath)
if (!Array.isArray(index)) fail(`stock index must be an array: ${indexPath}`)

const candidates = []
const skipped = []

for (const entry of index) {
  if (!markets.has(entry.market)) continue
  const file = dataFileFor(entry)
  if (!existsSync(file)) {
    skipped.push({ symbol: entry.symbol, reason: 'missing csv' })
    continue
  }

  const rows = parseCsv(readFileSync(file, 'utf8'))
  if (rows.length < minRows) {
    skipped.push({ symbol: entry.symbol, reason: `only ${rows.length} rows` })
    continue
  }

  const profile = profileInstrument(entry, rows)
  candidates.push(profile)
}

const ranked = candidates
  .sort((a, b) => b.score - a.score || b.return60 - a.return60)
  .slice(0, top)

if (format === 'json') {
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), markets: [...markets], top, minRows, ranked, skipped }, null, 2))
} else {
  printMarkdown(ranked, { markets: [...markets], top, minRows, skipped })
}

function profileInstrument(entry, rows) {
  const latest = rows.at(-1)
  const formula = buildFormulaAssist(entry, rows)
  const nameInfo = resolveInstrumentName(entry, nameMap)
  const closes = rows.map((row) => row.close)
  const volumes = rows.map((row) => row.volume)
  const amounts = rows.map((row) => row.close * row.volume)
  const ma20 = meanLast(closes, 20)
  const ma60 = meanLast(closes, 60)
  const ma120 = meanLast(closes, 120)
  const return20 = pctChange(closes.at(-21), latest.close)
  const return60 = pctChange(closes.at(-61), latest.close)
  const return120 = pctChange(closes.at(-121), latest.close)
  const avgAmount20 = meanLast(amounts, 20)
  const avgAmount60 = meanLast(amounts, 60)
  const volumeRatio = ratio(meanLast(volumes, 20), meanLast(volumes, 60))
  const atrPct = averageTrueRangePct(rows, 14)
  const drawdown120 = maxDrawdown(closes.slice(-120))
  const staleDays = ageInDays(latest.date)

  const trendScore = scoreTrend(latest.close, ma20, ma60, ma120)
  const momentumScore = scoreMomentum(return20, return60, return120)
  const liquidityScore = scoreLiquidity(avgAmount20, volumeRatio)
  const formulaScore = scoreFormulaAssist(formula)
  const riskScore = scoreRisk(atrPct, drawdown120, staleDays, formula)
  const rawScore = trendScore + momentumScore + liquidityScore + riskScore + formulaScore
  const score = round(Math.min(100, rawScore / 1.2), 1)
  const status = statusFor(score, staleDays, atrPct, drawdown120)

  return {
    symbol: entry.symbol,
    label: entry.label ?? entry.symbol,
    name: nameInfo.name,
    nameSource: nameInfo.source,
    market: entry.market,
    source: entry.source ?? 'local csv',
    dataThrough: latest.date,
    rows: rows.length,
    close: round(latest.close, 3),
    score,
    status,
    signal: signalText({ latest, ma20, ma60, return60, formula }),
    risk: riskText({ atrPct, drawdown120, staleDays, formula }),
    formulaNote: formulaNote(formula),
    scenario: buildScenario({ close: latest.close, atrPct, drawdown120, formula, status }),
    blockedFormulaInputs: formula.blockedFormulaInputs,
    formula,
    return20: round(return20, 2),
    return60: round(return60, 2),
    return120: round(return120, 2),
    atrPct: round(atrPct, 2),
    drawdown120: round(drawdown120, 2),
    avgAmount20: Math.round(avgAmount20),
    volumeRatio: round(volumeRatio, 2),
  }
}

function buildFormulaAssist(entry, rows) {
  const tdpy = inferTdpy(entry)
  const marketPath = buildMarketStatePath(rows, tdpy.value)
  const market = marketPath.at(-1)
  const latest = rows.at(-1)
  const holdingDays = 20
  const iv = Math.max(market?.annualVol ?? 0, 0.01)
  const targetReturn = 0.08
  const strikePrice = latest.close * 1.05
  const deltaBands = getDeltaBands({
    entryPrice: latest.close,
    holdingDays,
    iv,
    targetReturn,
    tradingDaysPerYear: tdpy.value,
  })
  const deviation = deviationScore({
    costDistance: market?.costDistance ?? 0,
    annualVol: iv,
    holdingDays,
    tradingDaysPerYear: tdpy.value,
  })
  const costSeries = marketPath.map((item) => item.costDistance).filter(Number.isFinite)
  const meanReversion = meanReversionHalfLife({ costDistanceSeries: costSeries.slice(-180), tradingDaysPerYear: tdpy.value })
  const volCi = volConfidence({ annualVol: iv, sampleSize: Math.min(120, Math.max(rows.length - 1, 5)), confidenceLevel: 0.68 })
  const recent22 = rows.slice(-22)
  const highestClose = Math.max(...recent22.map((row) => row.close))
  const vix = vixFix({ highestClose, low: latest.low })
  const rsi = computeRSI(rows).at(-1)
  const kdj = computeKDJ(rows).at(-1)
  const optionArgs = { entryPrice: latest.close, strikePrice, holdingDays, iv, type: 'call', tradingDaysPerYear: tdpy.value }
  const option = blackScholes(optionArgs)
  const asian = asianOption(optionArgs)
  const bachelier = bachelierOption({
    entryPrice: latest.close,
    strikePrice,
    holdingDays,
    normalVol: iv * latest.close,
    type: 'call',
    tradingDaysPerYear: tdpy.value,
  })
  const surface = deltaBands
    ? riskSurface({
      entryPrice: latest.close,
      strikePrice,
      holdingDays,
      iv,
      bandLow: deltaBands.long.low,
      bandHigh: deltaBands.short.high,
      steps: 12,
      tradingDaysPerYear: tdpy.value,
    })
    : null
  const gamma = gammaPnl({ gamma: option?.gamma ?? 0, priceChange: (market?.atr ?? 0), positionSize: 1 })
  const rangeWidth = Math.max(market?.atrPercent ?? 0.05, 0.03)
  const efficiency = capitalEfficiency({ rangeWidth: Math.min(rangeWidth, 0.5), skew: 1 })
  const il = impermanentLoss({ markPrice: latest.close, startPrice: market?.costAnchor ?? latest.close, liquidity: 1 })
  const fingerprint = liquidityFingerprint({
    entryPrice: market?.costAnchor ?? latest.close,
    priceGrid: 40,
    lowerFactor: 1 - Math.min(rangeWidth * 2, 0.5),
    upperFactor: 1 + Math.min(rangeWidth * 2, 0.5),
    segmentCount: 6,
  })
  const decisionGraph = buildDecisionGraph({
    market,
    input: { entryPrice: latest.close, holdingDays, iv, targetReturn, tradingDaysPerYear: tdpy.value, strategyProfile: 'balanced' },
    account: null,
  })

  return {
    tdpy,
    cost: market ? {
      anchor: round(market.costAnchor, 3),
      low: round(market.costLow, 3),
      high: round(market.costHigh, 3),
      distancePct: round((market.costDistance ?? 0) * 100, 2),
      slope5Pct: round((market.costSlope5 ?? 0) * 100, 2),
    } : null,
    volatility: market ? {
      annualVolPct: round(iv * 100, 2),
      atrPct: round((market.atrPercent ?? 0) * 100, 2),
      vixFixPct: round((vix ?? 0) * 100, 2),
    } : null,
    deltaBands: deltaBands ? summarizeBands(deltaBands) : null,
    deviation: deviation ? {
      z: round(deviation.z, 2),
      regressionProbPct: round(deviation.regressionProb * 100, 1),
      strength: deviation.strength,
      regime: deviation.regime,
    } : null,
    meanReversion: meanReversion ? {
      halfLifeDays: meanReversion.halfLifeDays === null ? null : round(meanReversion.halfLifeDays, 1),
      speed: meanReversion.speed,
    } : null,
    volConfidence: volCi ? {
      lowerPct: round(volCi.lower * 100, 1),
      upperPct: round(volCi.upper * 100, 1),
      quality: volCi.quality,
    } : null,
    indicators: {
      rsi: rsi?.raw === null ? null : round(rsi?.raw ?? 0, 1),
      rsiCustom: rsi?.custom === null ? null : round(rsi?.custom ?? 0, 1),
      k: kdj?.k === null ? null : round(kdj?.k ?? 0, 1),
      d: kdj?.d === null ? null : round(kdj?.d ?? 0, 1),
      j: kdj?.j === null ? null : round(kdj?.j ?? 0, 1),
    },
    stress: {
      optionDelta: option ? round(option.delta, 3) : null,
      optionGamma: option ? round(option.gamma, 6) : null,
      asianPrice: asian ? round(asian.price, 3) : null,
      bachelierPrice: bachelier ? round(bachelier.price, 3) : null,
      riskSurfacePoints: surface?.points?.length ?? 0,
      gammaPnl: gamma ? round(gamma.gammaPnl, 6) : null,
      capitalEfficiency: efficiency ? round(efficiency.efficiency, 2) : null,
      impermanentLossPct: il ? round((il.impermanentLoss ?? 0) * 100, 2) : null,
      liquiditySegments: fingerprint?.segments?.length ?? 0,
    },
    orderPlan: {
      state: decisionGraph.decision?.state ?? '等待',
      action: decisionGraph.position?.action ?? decisionGraph.decision?.timing?.action ?? '未触发',
      blockedReasons: decisionGraph.decision?.blockedReasons ?? [],
      missingInputs: decisionGraph.decision?.missingInputs ?? [],
    },
    blockedFormulaInputs: blockedFormulaInputs(entry),
  }
}

function summarizeBands(bands) {
  return {
    longLow: round(bands.long.low, 3),
    longCost: round(bands.long.cost, 3),
    longHigh: round(bands.long.high, 3),
    shortLow: round(bands.short.low, 3),
    shortCost: round(bands.short.cost, 3),
    shortHigh: round(bands.short.high, 3),
  }
}

function blockedFormulaInputs(entry) {
  const stockOnly = ['lp-inventory', 'amm-geometry', 'funding', 'portfolio', 'net-lp-efficiency', 'net-carry']
  return formulaStages
    .filter((stage) => stockOnly.includes(stage.id))
    .map((stage) => `${stage.id}: ${entry.market} OHLCV lacks ${stage.inputs.join('/')}`)
}

function scoreTrend(close, ma20, ma60, ma120) {
  let score = 0
  if (close > ma20) score += 10
  if (close > ma60) score += 10
  if (close > ma120) score += 10
  if (ma20 > ma60 && ma60 > ma120) score += 10
  return score
}

function scoreMomentum(return20, return60, return120) {
  let score = 0
  if (return20 > 0) score += 6
  if (return60 > 0) score += 8
  if (return120 > 0) score += 8
  if (return20 > 35) score -= 5
  if (return60 > 80) score -= 5
  return Math.max(0, score)
}

function scoreLiquidity(avgAmount20, volumeRatio) {
  const amountScore = Math.min(14, Math.max(0, Math.log10(Math.max(avgAmount20, 1)) - 5) * 3.5)
  const ratioScore = volumeRatio >= 0.7 ? 6 : volumeRatio >= 0.4 ? 3 : 0
  return amountScore + ratioScore
}

function scoreRisk(atrPct, drawdown120, staleDays, formula) {
  let score = 15
  if (atrPct > 4) score -= 4
  if (atrPct > 7) score -= 4
  if (drawdown120 < -25) score -= 4
  if (staleDays > 10) score -= 5
  if (staleDays > 30) score -= 5
  if (formula?.volConfidence?.quality === '不可靠') score -= 3
  if (formula?.meanReversion?.speed === '极慢') score -= 2
  return Math.max(0, score)
}

function scoreFormulaAssist(formula) {
  let score = 0
  const distance = formula?.cost?.distancePct ?? 0
  const z = Math.abs(formula?.deviation?.z ?? 0)
  if (distance > 0 && distance < 20) score += 4
  if (z >= 0.5 && z <= 2.5) score += 4
  if (formula?.deltaBands) score += 4
  if (['极快', '快', '中'].includes(formula?.meanReversion?.speed)) score += 3
  if (['高精度', '中精度'].includes(formula?.volConfidence?.quality)) score += 3
  if ((formula?.indicators?.rsi ?? 0) >= 45 && (formula?.indicators?.rsi ?? 0) <= 75) score += 3
  if ((formula?.indicators?.j ?? 0) > (formula?.indicators?.d ?? 0)) score += 2
  return score
}

function statusFor(score, staleDays, atrPct, drawdown120) {
  if (staleDays > 10) return '需刷新数据'
  if (score >= 70 && atrPct <= 7 && drawdown120 > -30) return '观察'
  if (score >= 50) return '等待'
  return '剔除'
}

function signalText(values) {
  const trend = values.latest.close > values.ma20 && values.ma20 > values.ma60 ? 'trend aligned' : 'trend mixed'
  const momentum = values.return60 > 0 ? `60d ${round(values.return60, 1)}%` : `60d ${round(values.return60, 1)}% weak`
  const deviation = values.formula?.deviation
    ? `${values.formula.deviation.regime} ${values.formula.deviation.z}σ`
    : 'deviation n/a'
  return `${trend}; ${momentum}; ${deviation}`
}

function riskText({ atrPct, drawdown120, staleDays, formula }) {
  const parts = [`ATR ${round(atrPct, 1)}%`, `DD120 ${round(drawdown120, 1)}%`]
  if (formula?.meanReversion?.speed) parts.push(`HL ${formula.meanReversion.speed}`)
  if (formula?.volConfidence?.quality) parts.push(`vol ${formula.volConfidence.quality}`)
  if (staleDays > 10) parts.push(`stale ${staleDays}d`)
  return parts.join('; ')
}

function formulaNote(formula) {
  const cost = formula?.cost ? `cost ${formula.cost.distancePct}%` : 'cost n/a'
  const deviation = formula?.deviation ? `dev ${formula.deviation.z}σ` : 'dev n/a'
  const band = formula?.deltaBands ? `band ${formula.deltaBands.longLow}-${formula.deltaBands.shortHigh}` : 'band n/a'
  const mr = formula?.meanReversion ? `HL ${formula.meanReversion.speed}` : 'HL n/a'
  const vol = formula?.volConfidence ? `vol ${formula.volConfidence.quality}` : 'vol n/a'
  const order = formula?.orderPlan ? `order ${formula.orderPlan.state}` : 'order n/a'
  const blocked = `blocked ${formula?.blockedFormulaInputs?.length ?? 0}`
  return `${cost}; ${deviation}; ${band}; ${mr}; ${vol}; ${order}; ${blocked}`
}

function printMarkdown(rows, meta) {
  console.log(`# China-market stock screen`)
  console.log(``)
  console.log(`Markets: ${meta.markets.join(', ')} | top: ${meta.top} | minRows: ${meta.minRows}`)
  console.log(``)
  console.log(`| symbol | name | market | dataThrough | status | score | signal | risk | formula | scenario | source |`)
  console.log(`| --- | --- | --- | --- | --- | ---: | --- | --- | --- | --- | --- |`)
  for (const row of rows) {
    console.log(`| ${cell(row.symbol)} | ${cell(row.name)} | ${cell(row.market)} | ${cell(row.dataThrough)} | ${cell(row.status)} | ${row.score} | ${cell(row.signal)} | ${cell(row.risk)} | ${cell(row.formulaNote)} | ${cell(scenarioText(row.scenario))} | ${cell(row.source)} |`)
  }
  console.log(``)
  console.log(`Formula coverage: ${formulaStages.length} registry stages are accounted for. Direct OHLCV formulas are scored; LP/AMM/funding/portfolio formulas are reported as missing-input or research-only for domestic stocks unless real inputs are supplied.`)
  console.log(`Name coverage: local name overrides are convenience labels; unresolved or time-sensitive names should be verified from a current market source before publishing.`)
  console.log(`Note: this is a local OHLCV research screen, not investment advice. Refresh data before making current-market decisions.`)
  if (meta.skipped.length) {
    console.log(`Skipped: ${meta.skipped.length} instruments with missing or shallow data.`)
  }
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/)
  const rows = []
  for (const line of lines.slice(1)) {
    const [date, open, high, low, close, volume] = line.split(',')
    const row = { date, open: Number(open), high: Number(high), low: Number(low), close: Number(close), volume: Number(volume) }
    if (isValidRow(row)) rows.push(row)
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date))
}

function isValidRow(row) {
  return row.date && [row.open, row.high, row.low, row.close, row.volume].every(Number.isFinite) && row.close > 0
}

function dataFileFor(entry) {
  const name = String(entry.url ?? '').split('/').at(-1)
  return join(dataDir, name)
}

function averageTrueRangePct(rows, period) {
  const slice = rows.slice(-period - 1)
  const ranges = []
  for (let index = 1; index < slice.length; index++) {
    const row = slice[index]
    const prevClose = slice[index - 1].close
    ranges.push(Math.max(row.high - row.low, Math.abs(row.high - prevClose), Math.abs(row.low - prevClose)))
  }
  return ratio(mean(ranges), rows.at(-1).close) * 100
}

function maxDrawdown(values) {
  let peak = values[0] ?? 0
  let worst = 0
  for (const value of values) {
    peak = Math.max(peak, value)
    worst = Math.min(worst, pctChange(peak, value))
  }
  return worst
}

function ageInDays(dateText) {
  const date = new Date(`${dateText}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return Number.POSITIVE_INFINITY
  return Math.floor((Date.now() - date.getTime()) / 86400000)
}

function meanLast(values, count) {
  return mean(values.slice(-count))
}

function mean(values) {
  const usable = values.filter(Number.isFinite)
  if (!usable.length) return 0
  return usable.reduce((sum, value) => sum + value, 0) / usable.length
}

function pctChange(start, end) {
  if (!Number.isFinite(start) || start === 0 || !Number.isFinite(end)) return 0
  return ((end - start) / start) * 100
}

function ratio(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return 0
  return numerator / denominator
}

function round(value, digits = 2) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function cell(value) {
  return String(value ?? '').replace(/\|/g, '/')
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    fail(`cannot read JSON ${path}: ${error.message}`)
  }
}

function resolvePath(path) {
  return resolve(ROOT, String(path))
}

function positiveInt(value, fallback) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function parseArgs(values) {
  const parsed = {}
  for (let index = 0; index < values.length; index++) {
    const value = values[index]
    if (!value.startsWith('--')) continue
    const key = value.slice(2)
    const next = values[index + 1]
    if (!next || next.startsWith('--')) {
      parsed[key] = true
    } else {
      parsed[key] = next
      index++
    }
  }
  return parsed
}

function fail(message) {
  console.error(message)
  process.exit(1)
}
