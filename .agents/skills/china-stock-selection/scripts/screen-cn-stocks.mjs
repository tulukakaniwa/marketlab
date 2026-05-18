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
  netCarry,
  netLpEfficiency,
  riskSurface,
  uniswapV3Inventory,
  vixFix,
  volConfidence,
} from '../../../../src/domain/formulas/core.js'
import { ammCurve } from '../../../../src/domain/formulas/amm.js'
import { buildDecisionGraph } from '../../../../src/domain/strategy-planning/orderPlan.js'
import { loadNameMap, resolveInstrumentName } from './selection-helpers.mjs'

const ALCOHOL_SYMBOLS = new Set([
  '600519', '000858', '000568', '002304', '603369',
  '000799', '600809', '000596', '600779',
])

const ROOT = resolve(fileURLToPath(new URL('../../../..', import.meta.url)))
const args = parseArgs(process.argv.slice(2))
const markets = new Set(String(args.market ?? 'A股,港股').split(',').map((item) => item.trim()).filter(Boolean))
const top = positiveInt(args.top, 20)
const minRows = positiveInt(args['min-rows'], 180)
const format = String(args.format ?? 'markdown')
const excludeAlcohol = args['exclude-alcohol'] !== 'false'
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
  if (excludeAlcohol && ALCOHOL_SYMBOLS.has(entry.symbol)) continue
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
  candidates.push(profileInstrument(entry, rows))
}

const ranked = candidates.sort((a, b) => b.score - a.score).slice(0, top)

if (format === 'json') {
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), markets: [...markets], top, minRows, ranked, skipped }, null, 2))
} else {
  printMarkdown(ranked, { markets: [...markets], top, minRows, skipped })
}

// ── 单标的完整分析 ──

function profileInstrument(entry, rows) {
  const latest = rows.at(-1)
  const staleDays = ageInDays(latest.date)
  const formula = buildFormula(entry, rows)
  const nameInfo = resolveInstrumentName(entry, nameMap)
  const amounts = rows.map(r => r.close * r.volume)
  const avgAmt20 = mean(amounts.slice(-20))

  const score = round(Math.min(100,
    scoreCostAnchor(formula) + scoreSynLp(formula) + scoreDeviation(formula) + scoreData(staleDays, rows.length)
  ), 1)
  const status = staleDays > 10 ? '需刷新数据'
    : score >= 65 ? '观察'
    : score >= 40 ? '等待'
    : '剔除'

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
    score, status,
    costNote: costNoteStr(formula),
    lpNote: lpNoteStr(formula),
    zNote: zNoteStr(formula),
    staleDays,
    avgAmt20: Math.round(avgAmt20),
    formula,
  }
}

// ── 完整公式计算 ──

function buildFormula(entry, rows) {
  const tdpy = inferTdpy(entry)
  const marketPath = buildMarketStatePath(rows, tdpy.value)
  const market = marketPath.at(-1)
  const latest = rows.at(-1)
  const iv = Math.max(market?.annualVol ?? 0, 0.01)
  const holdingDays = 20
  const targetReturn = 0.08

  // 成本锚
  const cost = market ? {
    anchor: round(market.costAnchor, 3),
    low: round(market.costLow, 3),
    high: round(market.costHigh, 3),
    distancePct: round((market.costDistance ?? 0) * 100, 2),
    slope5Pct: round((market.costSlope5 ?? 0) * 100, 2),
  } : null

  // z-score 偏离
  const deviation = deviationScore({ costDistance: market?.costDistance ?? 0, annualVol: iv, holdingDays, tradingDaysPerYear: tdpy.value })

  // Delta 成本带
  const deltaBands = getDeltaBands({ entryPrice: latest.close, holdingDays, iv, targetReturn, tradingDaysPerYear: tdpy.value })

  // 期权 + 亚式 + Bachelier
  const strikePrice = latest.close * 1.05
  const optArgs = { entryPrice: latest.close, strikePrice, holdingDays, iv, type: 'call', tradingDaysPerYear: tdpy.value }
  const option = blackScholes(optArgs)
  const asian = asianOption(optArgs)
  const bachelier = bachelierOption({ ...optArgs, normalVol: iv * latest.close })

  // 风险曲面
  const surface = deltaBands ? riskSurface({
    entryPrice: latest.close, strikePrice, holdingDays, iv,
    bandLow: deltaBands.long.low, bandHigh: deltaBands.short.high,
    steps: 12, tradingDaysPerYear: tdpy.value,
  }) : null

  // Gamma PnL
  const gamma = gammaPnl({ gamma: option?.gamma ?? 0, priceChange: (market?.atr ?? 0), positionSize: 1 })

  // LP 库存 (合成模式)
  const rangeWidth = Math.max(market?.atrPercent ?? 0.05, 0.03)
  const synRW = Math.min(rangeWidth, 0.5)
  const synLower = (market?.costAnchor ?? latest.close) * Math.max(1 - synRW, 0.001)
  const synUpper = (market?.costAnchor ?? latest.close) * (1 + synRW)
  const synLp = uniswapV3Inventory({ markPrice: latest.close, lowerPrice: synLower, upperPrice: synUpper, liquidity: 1 })

  // LP 价值历史分位数 (近一年 ≈ 242 个交易日)
  const lpValues = []
  for (let i = Math.max(0, marketPath.length - 242); i < marketPath.length; i++) {
    const m = marketPath[i]
    const r = rows[i]
    if (!m || !r) continue
    const rw = Math.max(m.atrPercent ?? 0.05, 0.03)
    const srw = Math.min(rw, 0.5)
    const lo = m.costAnchor * Math.max(1 - srw, 0.001)
    const up = m.costAnchor * (1 + srw)
    const lp = uniswapV3Inventory({ markPrice: r.close, lowerPrice: lo, upperPrice: up, liquidity: 1 })
    if (lp?.value !== null && Number.isFinite(lp.value)) lpValues.push(lp.value)
  }
  lpValues.sort((a, b) => a - b)
  const lpPercentile = lpValues.length > 0 && synLp?.value !== null && Number.isFinite(synLp.value)
    ? round(lpValues.filter(v => v <= synLp.value).length / lpValues.length * 100, 1)
    : null

  // 流动性指纹
  const fingerprint = liquidityFingerprint({
    entryPrice: market?.costAnchor ?? latest.close, priceGrid: 40,
    lowerFactor: 1 - Math.min(rangeWidth * 2, 0.5),
    upperFactor: 1 + Math.min(rangeWidth * 2, 0.5), segmentCount: 6,
  })

  // AMM 几何 (合成)
  const synAmm = ammCurve({ price: latest.close, invariant: latest.close * latest.close, n: 2, c: 0.003 })

  // 资本效率 + IL
  const ce = capitalEfficiency({ rangeWidth: synRW, skew: 1 })
  const il = impermanentLoss({ markPrice: latest.close, startPrice: market?.costAnchor ?? latest.close, liquidity: 1 })

  // LP 净效率
  const synNetLp = netLpEfficiency({ capitalEfficiency: ce?.efficiency, impermanentLoss: il?.impermanentLoss, feeRate: 0.003 })

  // 资金费率 + 持仓净收益 (合成, 无 perp/spot TWAP 则 null)
  const hasFunding = false // A 股无 perp 数据
  const funding = null
  const carry = null

  // 波动率置信
  const vci = volConfidence({ annualVol: iv, sampleSize: Math.min(120, Math.max(rows.length - 1, 5)), confidenceLevel: 0.68 })

  // 均值回归
  const costSeries = marketPath.map(x => x.costDistance).filter(Number.isFinite)
  const mr = meanReversionHalfLife({ costDistanceSeries: costSeries.slice(-180), tradingDaysPerYear: tdpy.value })

  // VIX Fix
  const recent22 = rows.slice(-22)
  const vix = vixFix({ highestClose: Math.max(...recent22.map(r => r.close)), low: latest.low })

  // 订单决策
  const decisionGraph = buildDecisionGraph({
    market,
    input: { entryPrice: latest.close, holdingDays, iv, targetReturn, tradingDaysPerYear: tdpy.value, strategyProfile: 'balanced' },
    account: null,
  })

  return {
    tdpy,
    cost,
    deviation: {
      z: round(deviation.z, 2),
      regressionProbPct: round(deviation.regressionProb * 100, 1),
      regime: deviation.regime,
      strength: deviation.strength,
    },
    deltaBands: deltaBands ? {
      longLow: round(deltaBands.long.low, 3),
      longCost: round(deltaBands.long.cost, 3),
      longHigh: round(deltaBands.long.high, 3),
      shortLow: round(deltaBands.short.low, 3),
      shortCost: round(deltaBands.short.cost, 3),
      shortHigh: round(deltaBands.short.high, 3),
    } : null,
    options: {
      delta: option ? round(option.delta, 3) : null,
      gamma: option ? round(option.gamma, 6) : null,
      thetaDaily: option ? round(option.thetaDaily, 6) : null,
      asianPrice: asian ? round(asian.price, 3) : null,
      bachelierPrice: bachelier ? round(bachelier.price, 3) : null,
      riskSurfacePoints: surface?.points?.length ?? 0,
      gammaPnl: gamma ? round(gamma.gammaPnl, 6) : null,
    },
    synLp: {
      value: synLp?.value !== null && Number.isFinite(synLp?.value) ? round(synLp.value, 4) : null,
      zone: synLp?.zone ?? null,
      lowerPrice: round(synLower, 3),
      upperPrice: round(synUpper, 3),
      percentile: lpPercentile,
      sampleDays: lpValues.length,
    },
    fingerprint: {
      segments: fingerprint?.segments?.length ?? 0,
      entropy: fingerprint?.stats?.entropy ?? null,
    },
    amm: synAmm ? {
      reserveX: round(synAmm.x, 3), reserveY: round(synAmm.y, 3), k: round(synAmm.k, 3),
    } : null,
    capitalEfficiency: ce ? round(ce.efficiency, 2) : null,
    impermanentLossPct: il ? round((il.impermanentLoss ?? 0) * 100, 2) : null,
    synNetLp: synNetLp ? {
      totalNet: round(synNetLp.totalNet, 4),
      efficient: synNetLp.efficient,
      grossGain: round(synNetLp.grossGain ?? 0, 4),
    } : null,
    funding: { hasFunding, basisEstimate: null, cumulativeFunding: null },
    netCarry: null,
    volConfidence: vci ? {
      lowerPct: round(vci.lower * 100, 1), upperPct: round(vci.upper * 100, 1), quality: vci.quality,
    } : null,
    meanReversion: mr ? {
      halfLifeDays: mr.halfLifeDays === null ? null : round(mr.halfLifeDays, 1), speed: mr.speed,
    } : null,
    vixFix: vix !== null && vix !== undefined ? round(Number(vix) * 100, 2) : null,
    orderPlan: {
      state: decisionGraph.decision?.state ?? '等待',
      blockedReasons: decisionGraph.decision?.blockedReasons ?? [],
    },
  }
}

// ── 评分：成本锚 (30) + 合成LP (45) + z-score (15) + 数据质量 (10) ──
// LP 分位数为核心信号：P<5% 历史极端低位权重最高

function scoreCostAnchor(formula) {
  let s = 0
  const c = formula.cost
  if (!c) return 0
  // 锚方向 — 确认信号 (0-14)
  if (c.slope5Pct > 0) s += 14
  else if (c.slope5Pct > -0.5) s += 10
  else if (c.slope5Pct > -1.5) s += 5
  else if (c.slope5Pct > -2.5) s += 2
  // 价格位置 (0-10)
  if (c.distancePct >= -3 && c.distancePct <= 15) s += 10
  else if (c.distancePct >= -8 && c.distancePct <= 25) s += 7
  // 带内加成 (0-6)
  if (c.distancePct >= 0 && c.distancePct <= 15) s += 6
  return s
}

function scoreSynLp(formula) {
  let s = 0
  const lp = formula.synLp
  if (!lp || lp.value === null) return 0
  const pct = lp.percentile
  // lpValue 分位数 — 核心信号 (0-30)
  if (pct !== null && pct < 5) s += 30
  else if (pct !== null && pct < 10) s += 25
  else if (pct !== null && pct < 25) s += 18
  else if (pct !== null && pct < 50) s += 10
  else if (pct !== null) s += 3
  // zone — token0+低位 = LP囤货最佳点位 (0-10)
  if (lp.zone === 'range') s += 10
  else if (lp.zone === 'token0' && pct !== null && pct < 25) s += 10
  else if (lp.zone === 'token0') s += 4
  // 净效率 (0-5)
  if (formula.synNetLp?.efficient) s += 5
  return s
}

function scoreDeviation(formula) {
  let s = 0
  const d = formula.deviation
  if (!d) return 0
  // 回归概率直接映射 (0-8) — 越确定越加分
  const prob = d.regressionProbPct
  if (prob >= 95) s += 8
  else if (prob >= 85) s += 6
  else if (prob >= 70) s += 4
  else if (prob >= 55) s += 2
  // 折价深度 (0-7) — 越深回归势能越大
  const z = d.z
  if (z <= -3) s += 7
  else if (z <= -2) s += 6
  else if (z <= -1) s += 4
  else if (z < 0) s += 2
  else if (z <= 1) s += 1
  return s
}

function scoreData(stale, total) {
  let s = 5
  if (stale > 10) s -= 5
  if (stale > 30) s -= 5
  if (total >= 500) s += 3
  if (total >= 1000) s += 2
  return Math.max(0, s)
}

// ── 三列输出文本 ──

function costNoteStr(f) {
  const c = f.cost
  if (!c) return 'n/a'
  const dir = c.slope5Pct > 0.5 ? '↑' : c.slope5Pct < -0.5 ? '↓' : '→'
  return `${c.distancePct > 0 ? '+' : ''}${c.distancePct}% ${dir} [${c.low}-${c.high}]`
}

function lpNoteStr(f) {
  const lp = f.synLp
  if (!lp || lp.value === null) return 'n/a'
  const pct = lp.percentile !== null ? `P${lp.percentile}` : '?'
  const eff = f.synNetLp?.efficient ? '+' : '-'
  return `${lp.zone} v${lp.value} ${pct} net${eff}`
}

function zNoteStr(f) {
  const d = f.deviation
  if (!d) return 'n/a'
  return `${d.z > 0 ? '+' : ''}${d.z}σ ${d.regime} ${d.regressionProbPct}%`
}

// ── Markdown ──

function printMarkdown(rows, meta) {
  console.log(`# 国内股票筛选 (成本锚 / LP / z-score)`)
  console.log(``)
  console.log(`Markets: ${meta.markets.join(', ')} | top: ${meta.top} | minRows: ${meta.minRows}`)
  console.log(`公式栈: 价格路径→成本→Δ带→期权→LP→AMM→偏离→曲面→净效率→回归 (无RSI/KDJ/EMA/MA)`)
  console.log(``)
  console.log(`| symbol | name | market | through | status | score | 成本锚 | LP(合成) | z-score |`)
  console.log(`| --- | --- | --- | --- | --- | ---: | --- | --- | --- |`)
  for (const r of rows) {
    console.log(`| ${cell(r.symbol)} | ${cell(r.name)} | ${cell(r.market)} | ${cell(r.dataThrough)} | ${cell(r.status)} | ${r.score} | ${cell(r.costNote)} | ${cell(r.lpNote)} | ${cell(r.zNote)} |`)
  }
  console.log(``)
  console.log(`评分: 成本锚(0-30) + 合成LP(0-45·分位数主导) + z-score(0-15) + 数据质量(0-10)`)
  console.log(`LP分位权重: P<5%=30, P<10%=25, P<25%=18, P<50%=10; zone+netLp加成最多15`)
  console.log(`合成LP: liquidity=1, rangeWidth=ATR推导, 无链上数据依赖`)
  console.log(`完整JSON: --format json 含全量公式字段 (options/deltaBands/fingerprint/amm/mr/volConfidence/orderPlan)`)
  console.log(`本报告仅基于本地OHLCV的研究筛选，不构成投资建议。`)
  if (meta.skipped.length) console.log(`跳过: ${meta.skipped.length} 个标的数据缺失或不足`)
}

// ── 工具函数 ──

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/)
  const rows = []
  for (const line of lines.slice(1)) {
    const [date, open, high, low, close, volume] = line.split(',')
    const row = { date, open: +open, high: +high, low: +low, close: +close, volume: +volume }
    if (row.date && [row.open, row.high, row.low, row.close, row.volume].every(Number.isFinite) && row.close > 0) rows.push(row)
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date))
}

function dataFileFor(entry) {
  return join(dataDir, String(entry.url ?? '').split('/').at(-1))
}

function ageInDays(dateText) {
  const d = new Date(`${dateText}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return Number.POSITIVE_INFINITY
  return Math.floor((Date.now() - d.getTime()) / 86400000)
}

function mean(arr) {
  const v = arr.filter(Number.isFinite)
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0
}

function round(v, d = 2) { const f = 10 ** d; return Math.round(v * f) / f }
function cell(v) { return String(v ?? '').replace(/\|/g, '/') }

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')) }
  catch (e) { fail(`cannot read ${path}: ${e.message}`) }
}

function resolvePath(p) { return resolve(ROOT, String(p)) }
function positiveInt(v, fallback) { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : fallback }

function parseArgs(values) {
  const parsed = {}
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (!v.startsWith('--')) continue
    const key = v.slice(2)
    const next = values[i + 1]
    parsed[key] = (!next || next.startsWith('--')) ? true : (i++, next)
  }
  return parsed
}

function fail(msg) { console.error(msg); process.exit(1) }
