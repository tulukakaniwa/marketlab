// 推荐股票池 v3：声明式可勾选可调权评分模型
//
// 核心改造：
//   - 每个维度声明为 { id, label, weight, enabled, requires, score(metrics, ctx) }
//   - 评分主流程 computeBuyScore 不写死维度数，只遍历 config
//   - UI / URL 调权：调用方传入 overrides（部分启用/禁用 + 改权重），
//     buildScoreConfig 合并出最终配置
//   - 数据缺失（requires 字段缺失）自动跳过该维度，剩余维度按比例归一
//   - "接飞刀豁免"：z ≤ -1.5 且回归概率 ≥ 85% 时，锚向下不再硬扣，给予中位分

import {
  meanReversionHalfLife,
  volConfidence,
  deviationScore,
  getDeltaBands,
} from '../formulas/core.js'

// tiers 用「当前启用维度满分」的百分比表达：focus = 满分 × 65%
export const DEFAULT_TIER_THRESHOLDS = Object.freeze({
  focus: 0.65,
  wait: 0.40,
})

// 构造每个维度的统一形态。score(metrics, ctx) 返回 [0, 1] 的"达成度"
// （null 表示该维度数据缺失，应跳过；0 表示启用但条件不满足拿满分）。
function dim({ id, label, weight, enabled = true, requires = [], score, optional = false }) {
  return { id, label, weight, enabled, requires, score, optional }
}

// 标准库：所有可勾选维度
export const DIMENSION_LIBRARY = [
  // 1. lpValue 历史百分位（30）
  dim({
    id: 'lpValuePercentile',
    label: 'lpValue 1 年百分位',
    weight: 30,
    requires: ['lpValuePercentile'],
    score: (m) => inverseLinear(m.lpValuePercentile, 0.05, 0.50),
  }),
  // 2. z 偏离（25）
  dim({
    id: 'zScore',
    label: 'z 偏离（成本带）',
    weight: 25,
    requires: ['zScore'],
    score: (m) => inverseLinear(m.zScore, -3.0, 0),
  }),
  // 3. LP zone（20）
  dim({
    id: 'lpZone',
    label: 'LP zone 仓位',
    weight: 20,
    requires: ['lpZone'],
    score: (m) => zoneScore(m.lpZone),
  }),
  // 4. 成本锚 5 日斜率（15） — 接飞刀豁免见 score 内
  dim({
    id: 'costSlope',
    label: '成本锚 5 日斜率',
    weight: 15,
    requires: ['costSlope5'],
    score: (m, ctx) => {
      const linear = forwardLinear(m.costSlope5, -0.025, 0.005)
      // 接飞刀豁免：z ≤ -1.5 且回归 ≥ 85% 时，锚↓也不再硬扣
      if (ctx?.options?.allowCatchKnife
        && Number.isFinite(m.zScore) && m.zScore <= -1.5
        && Number.isFinite(m.regressionProbability) && m.regressionProbability >= 0.85) {
        return Math.max(linear, 0.5)
      }
      return linear
    },
  }),
  // 5. KDJ J（10）
  dim({
    id: 'jValue',
    label: 'KDJ J 值',
    weight: 10,
    enabled: true,
    requires: ['j'],
    score: (m) => inverseLinear(m.j, 0, 20),
  }),
  // 6. RSI（默认关，可勾）
  dim({
    id: 'rsi',
    label: 'RSI（超卖）',
    weight: 10,
    enabled: false,
    requires: ['rsi'],
    score: (m) => inverseLinear(m.rsi, 0, 35),
  }),
  // 7. LP 3 年比值（max/min ≥ 2 才算周期低点）
  dim({
    id: 'lpRatio3y',
    label: 'LP 3 年 max/min',
    weight: 15,
    requires: ['lpValueRatio3y'],
    score: (m) => forwardLinear(m.lpValueRatio3y, 1.2, 2.5),
  }),
  // 8. 半衰期（HL 越短越好；HL>90 几乎无回归）
  dim({
    id: 'halfLife',
    label: '均值回归半衰期',
    weight: 10,
    enabled: false,
    requires: ['halfLifeDays'],
    score: (m) => {
      const hl = m.halfLifeDays
      if (!Number.isFinite(hl) || hl <= 0) return 0
      // ≤30 天满分，≥120 天零分
      return inverseLinear(hl, 30, 120)
    },
  }),
  // 9. 半衰期可信度（volConfidence quality + |z| 极端度）
  dim({
    id: 'volConfidence',
    label: '半衰期可信度',
    weight: 5,
    enabled: false,
    requires: ['volConfidenceScore'],
    score: (m) => clamp01(m.volConfidenceScore),
  }),
  // 10. 社保 Q1 白名单（可选加分项 +5）
  dim({
    id: 'socialSecurityWhitelist',
    label: '社保 Q1 白名单',
    weight: 5,
    enabled: false,
    optional: true,    // optional=true：未命中不参与归一计算（视为 missing）
    requires: ['socialSecurityWhitelisted'],
    score: (m) => m.socialSecurityWhitelisted ? 1 : null,
  }),
]

export const DEFAULT_OPTIONS = Object.freeze({
  // 接飞刀豁免：z ≤ -1.5 且回归 ≥ 85% 时锚↓不硬扣
  allowCatchKnife: true,
})

/**
 * 合并默认维度库 + 用户 overrides 形成最终评分配置。
 * overrides 形如：[{ id, enabled?, weight? }]
 */
export function buildScoreConfig(overrides = []) {
  const map = new Map()
  for (const d of DIMENSION_LIBRARY) map.set(d.id, { ...d })
  for (const o of overrides ?? []) {
    if (!o || !o.id || !map.has(o.id)) continue
    const cur = map.get(o.id)
    if (typeof o.enabled === 'boolean') cur.enabled = o.enabled
    if (Number.isFinite(o.weight) && o.weight >= 0) cur.weight = o.weight
  }
  return [...map.values()]
}

/**
 * 计算单只股票的 buyScore（原始加权和，不归一化）。
 *   - 启用 + 数据充分 + 评分有效的维度：贡献 ratio × weight
 *   - disabled / missing 维度：直接跳过，不进入分母（也不补满）
 *   - 取消某个维度的权重 → 总分上限随之下降；buyScore 与"当前启用维度的满分"成同一坐标系
 *   options.dimensions 是评分维度数组（默认 buildScoreConfig() ）
 *   options.allowCatchKnife 控制接飞刀豁免（默认开）
 */
export function computeBuyScore(metrics, options = {}) {
  const safe = metrics ?? {}
  const dims = options.dimensions ?? buildScoreConfig()
  const ctx = { options: { ...DEFAULT_OPTIONS, ...options } }

  const result = { score: 0, dimensions: {}, hits: [], catchKnife: false, maxScore: 0, activeWeight: 0 }
  let totalScore = 0
  let activeWeight = 0

  for (const d of dims) {
    if (!d.enabled || d.weight <= 0) {
      result.dimensions[d.id] = { ratio: 0, score: 0, weight: d.weight, label: d.label, disabled: true }
      continue
    }
    const ready = d.requires.every((k) => safe[k] !== null && safe[k] !== undefined && (typeof safe[k] !== 'number' || Number.isFinite(safe[k])))
    if (!ready) {
      result.dimensions[d.id] = { ratio: 0, score: 0, weight: d.weight, label: d.label, missing: true }
      continue
    }
    const r = d.score(safe, ctx)
    if (r === null) {
      // optional 维度未命中 → 当作 missing，不进总分上限
      // 非 optional 维度评分函数返回 null（理论上不应发生）→ 视为 missing
      result.dimensions[d.id] = { ratio: 0, score: 0, weight: d.weight, label: d.label, missing: true }
      continue
    }
    const ratio = clamp01(r)
    const score = ratio * d.weight
    result.dimensions[d.id] = { ratio, score: round2(score), weight: d.weight, label: d.label }
    totalScore += score
    activeWeight += d.weight
  }

  // 启用维度的"接飞刀豁免"标志
  if (ctx.options.allowCatchKnife
    && Number.isFinite(safe.zScore) && safe.zScore <= -1.5
    && Number.isFinite(safe.regressionProbability) && safe.regressionProbability >= 0.85) {
    result.catchKnife = true
  }

  result.score = round1(totalScore)
  result.maxScore = round1(activeWeight)
  result.activeWeight = activeWeight

  // 命中条件（维度评分 ≥ 80% 满分）
  for (const d of dims) {
    const r = result.dimensions[d.id]
    if (!r || r.disabled || r.missing) continue
    if (r.ratio >= 0.8) {
      result.hits.push(formatHit(d.id, safe))
    }
  }
  if (result.catchKnife) result.hits.push('接飞刀豁免（强回归）')

  return result
}

/**
 * 生成推荐股票池（按三档分级）。
 *
 * options:
 *   - dimensions  评分维度数组
 *   - allowCatchKnife  接飞刀豁免开关
 *   - tiers       { focus, wait } 阈值
 *   - topN        每档最多展示数量
 *   - generatedAt  ISO 时间
 */
export function generateRecommendedStockPool(candidates, options = {}) {
  const dimensions = options.dimensions ?? buildScoreConfig()
  const tiers = options.tiers ?? DEFAULT_TIER_THRESHOLDS
  const topN = Number.isFinite(options.topN) && options.topN > 0 ? Math.floor(options.topN) : 10
  const allowCatchKnife = options.allowCatchKnife ?? DEFAULT_OPTIONS.allowCatchKnife
  const list = Array.isArray(candidates) ? candidates : []
  const generatedAt = options.generatedAt ?? new Date().toISOString()

  const scored = []
  for (const candidate of list) {
    if (!candidate || !candidate.symbol) continue
    const m = { ...(candidate.metrics ?? {}) }
    const metrics = { ...m, ...deriveRecommendedStockDecisionMetrics(m) }
    const result = computeBuyScore(metrics, { dimensions, allowCatchKnife })
    if (!Number.isFinite(result.score)) continue
    scored.push({
      symbol: candidate.symbol,
      label: candidate.label ?? candidate.symbol,
      market: candidate.market ?? '',
      metrics,
      buyScore: result.score,
      maxScore: result.maxScore,
      dimensions: result.dimensions,
      hits: result.hits,
      catchKnife: result.catchKnife,
      tier: classify(result.score, result.maxScore, tiers),
      narrative: buildNarrative({
        label: candidate.label ?? candidate.symbol,
        score: result.score,
        maxScore: result.maxScore,
        dimensions: result.dimensions,
        catchKnife: result.catchKnife,
        metrics,
      }),
    })
  }

  scored.sort((a, b) => b.buyScore - a.buyScore)

  const focusItems = scored.filter((s) => s.tier === 'focus').slice(0, topN)
  const waitItems = scored.filter((s) => s.tier === 'wait').slice(0, topN)
  const items = [...focusItems, ...waitItems]

  return {
    generatedAt,
    generatedDate: generatedAt.slice(0, 10),
    totalCandidates: list.length,
    scoredCount: scored.length,
    topN,
    tiers,
    options: { allowCatchKnife },
    dimensions: dimensions.map((d) => ({ id: d.id, label: d.label, weight: d.weight, enabled: d.enabled, optional: d.optional })),
    items,
    focusItems,
    waitItems,
    logic:
      '本次推荐采用做市商多维对齐模型：每个维度可独立勾选并调整权重；buyScore 是「启用维度的原始加权和」' +
      '（取消任何一个维度，总分上限自动下降）。当 buyScore ≥ 当前满分上限的 65% 进入「重点关注」，' +
      '40%~65% 为「等待」（常见瓶颈是成本锚还在↓，但若 z ≤ -1.5σ 且回归概率 ≥ 85%，会触发"接飞刀豁免"）。',
    riskNote: '左侧买入不代表立即反转，仍需注意继续下跌和趋势延续风险。维度分数高仅代表统计层面的偏离/低位，不构成投资建议。',
  }
}

// ── 派生计算（半衰期 / 持仓周期 / 买卖点） ────────────────────────────

export function deriveRecommendedStockDecisionMetrics(metrics) {
  const out = {}
  // 半衰期 + 速度
  if (Array.isArray(metrics.costDistanceSeries) && metrics.costDistanceSeries.length >= 30) {
    const hl = meanReversionHalfLife({
      costDistanceSeries: metrics.costDistanceSeries,
      tradingDaysPerYear: metrics.tradingDaysPerYear || 252,
    })
    if (hl) {
      out.halfLifeDays = Number.isFinite(hl.halfLifeDays) ? round1(hl.halfLifeDays) : null
      out.halfLifeSpeed = hl.speed
      out.halfLifeRho = round2(hl.rho)
      // 持仓周期 = HL × 2，回到锚 = HL × 3
      if (Number.isFinite(out.halfLifeDays) && out.halfLifeDays > 0) {
        out.holdingDays = Math.round(out.halfLifeDays * 2)
        out.recoveryDays = Math.round(out.halfLifeDays * 3)
      }
    }
  }
  // 波动率置信度（quality 字符串 → 数字 0~1）
  if (Number.isFinite(metrics.annualVol) && Number.isFinite(metrics.tradingDays)) {
    const vc = volConfidence({ annualVol: metrics.annualVol, sampleSize: metrics.tradingDays })
    if (vc) {
      const qualityScore = vc.quality === '高精度' ? 1 : vc.quality === '中精度' ? 0.7 : vc.quality === '低精度' ? 0.4 : 0.1
      // 与 |z| 极端度合成：|z|≥3 上调 +0.2
      const zBoost = Number.isFinite(metrics.zScore) ? Math.min(0.3, Math.max(0, (Math.abs(metrics.zScore) - 1) * 0.1)) : 0
      out.volConfidenceQuality = vc.quality
      out.volConfidenceScore = clamp01(qualityScore + zBoost)
    }
  }
  // 买卖点：买点 = Delta 上沿、卖点 = 成本带下沿
  if (Number.isFinite(metrics.costAnchor) && Number.isFinite(metrics.annualVol) && metrics.annualVol > 0) {
    const deltaBands = getDeltaBands({
      entryPrice: metrics.costAnchor,
      holdingDays: out.holdingDays || 30,
      iv: metrics.annualVol,
      targetReturn: 0.3,
      tradingDaysPerYear: metrics.tradingDaysPerYear || 252,
    })
    if (deltaBands?.long?.high) out.entryTargetPrice = round2(deltaBands.long.high)
  }
  if (Number.isFinite(metrics.costLow)) out.takeProfitPrice = round2(metrics.costLow)
  return out
}

// ── 工具函数 ───────────────────────────────────────────────────────────

function inverseLinear(value, fullPoint, zeroPoint) {
  const v = Number(value)
  if (!Number.isFinite(v)) return null
  if (zeroPoint === fullPoint) return 0
  return clamp01((v - zeroPoint) / (fullPoint - zeroPoint))
}

function forwardLinear(value, lowPoint, highPoint) {
  const v = Number(value)
  if (!Number.isFinite(v)) return null
  if (highPoint === lowPoint) return 0
  return clamp01((v - lowPoint) / (highPoint - lowPoint))
}

function zoneScore(zone) {
  if (zone === 'token0') return 1
  if (zone === 'range') return 0.45
  if (zone === 'token1') return 0
  return null
}

function clamp01(v) {
  if (!Number.isFinite(v)) return 0
  if (v < 0) return 0
  if (v > 1) return 1
  return v
}

function classify(score, maxScore, tiers) {
  if (!Number.isFinite(maxScore) || maxScore <= 0) return 'skip'
  const ratio = score / maxScore
  if (ratio >= tiers.focus) return 'focus'
  if (ratio >= tiers.wait) return 'wait'
  return 'skip'
}

function round1(v) { return Number.isFinite(v) ? Math.round(v * 10) / 10 : 0 }
function round2(v) { return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0 }

function formatHit(id, m) {
  switch (id) {
    case 'lpValuePercentile': return `lpValue P${(m.lpValuePercentile * 100).toFixed(1)}%`
    case 'zScore':            return `z=${m.zScore.toFixed(2)}σ`
    case 'lpZone':            return 'token0 折价囤货'
    case 'costSlope':         return '成本锚↑'
    case 'jValue':            return `J=${m.j.toFixed(2)}`
    case 'rsi':               return `RSI=${m.rsi.toFixed(2)}`
    case 'lpRatio3y':         return `LP 3 年 ${m.lpValueRatio3y.toFixed(2)}×`
    case 'halfLife':          return `HL=${Math.round(m.halfLifeDays)}天`
    case 'volConfidence':     return '半衰期可信'
    case 'socialSecurityWhitelist': return '社保 Q1 白名单'
    default: return id
  }
}

// ── 文案 ───────────────────────────────────────────────────────────────

function buildNarrative({ label, score, maxScore, dimensions, catchKnife, metrics }) {
  const lines = []

  // 主结论
  const ratio = maxScore > 0 ? score / maxScore : 0
  const scoreStr = `${score}/${maxScore} 分（${(ratio * 100).toFixed(0)}%）`
  if (ratio >= 0.85) lines.push(`${label} 综合 ${scoreStr}。做市商模型告诉你：你在历史最低价囤满了货。`)
  else if (ratio >= 0.65) lines.push(`${label} 综合 ${scoreStr}。多个维度对齐，左侧关注价值高。`)
  else if (ratio >= 0.40) lines.push(`${label} 综合 ${scoreStr}。有亮点但缺关键确认，等一等。`)
  else lines.push(`${label} 综合 ${scoreStr}。维度未对齐，暂不入选。`)

  // lpValue P
  const p = metrics.lpValuePercentile
  if (Number.isFinite(p)) {
    const pPct = (p * 100).toFixed(1)
    if (p <= 0.05) lines.push(`lpValue 近一年 P${pPct}%，${(100 - p * 100).toFixed(1)}% 的时间都比现在贵——做市商角度处在历史最便宜区间。`)
    else if (p <= 0.30) lines.push(`lpValue P${pPct}%，处于近一年低位区域。`)
    else if (p <= 0.70) lines.push(`lpValue P${pPct}%，位置中性。`)
    else lines.push(`lpValue P${pPct}%，近一年大部分时间都比现在便宜——你现在进货的价格不划算。`)
  }

  // LP 3 年比值
  if (Number.isFinite(metrics.lpValueRatio3y)) {
    const r = metrics.lpValueRatio3y
    if (r >= 2) lines.push(`3 年 max/min=${r.toFixed(2)}×，确实翻过倍——属于真周期低点。`)
    else lines.push(`3 年 max/min=${r.toFixed(2)}×，还没翻过倍——可能只是价值陷阱，不是真周期底。`)
  }

  // z + 回归
  if (Number.isFinite(metrics.zScore) && Number.isFinite(metrics.regressionProbability)) {
    const z = metrics.zScore
    const prob = (metrics.regressionProbability * 100).toFixed(1)
    if (z <= -2.5) lines.push(`z=${z.toFixed(2)}σ，回归概率 ${prob}%——纯随机偏离这么深的概率极低，价格大概率往回拉。`)
    else if (z <= -1.5) lines.push(`z=${z.toFixed(2)}σ，回归概率 ${prob}%，统计学信号不错。`)
    else if (z <= -0.5) lines.push(`z=${z.toFixed(2)}σ，价格略低于成本锚。`)
    else if (z <= 0.5) lines.push(`z=${z.toFixed(2)}σ，价格贴在成本锚上下。`)
    else lines.push(`z=${z.toFixed(2)}σ，价格已偏离到锚之上——溢价区。`)
  }

  // LP zone
  if (metrics.lpZone === 'token0') lines.push(`LP 仓位 100% ${label}（zone=token0），手里的货是打折买的。`)
  else if (metrics.lpZone === 'token1') lines.push(`LP 仓位已卖成现金（zone=token1）——货已出完。`)
  else if (metrics.lpZone === 'range') lines.push(`LP 在 range 区间内做市，双向报价赚手续费。`)

  // 锚趋势 + 接飞刀
  if (Number.isFinite(metrics.costSlope5)) {
    const dir = metrics.anchorDirection
    if (dir === 'up') lines.push(`成本锚 5 日斜率 ${formatPct(metrics.costSlope5)}（↑），公允成本上移，趋势已掉头。`)
    else if (dir === 'flat') lines.push(`成本锚 5 日斜率 ${formatPct(metrics.costSlope5)}（→），底部已焊住。`)
    else if (dir === 'down') {
      if (catchKnife) lines.push(`成本锚 5 日斜率 ${formatPct(metrics.costSlope5)}（↓），但 z 已极端 + 回归概率 ≥ 85%，触发"接飞刀豁免"，回归力道足够拉回。`)
      else lines.push(`唯一没亮绿灯的：成本锚 5 日斜率 ${formatPct(metrics.costSlope5)}（↓），"底"可能还没焊死，等锚走平再加码。`)
    }
  }

  // 半衰期 + 持仓周期
  if (Number.isFinite(metrics.halfLifeDays)) {
    lines.push(`半衰期 ${metrics.halfLifeDays} 天（${metrics.halfLifeSpeed}），持仓周期 ≈ ${metrics.holdingDays} 天，回到锚 ≈ ${metrics.recoveryDays} 天。`)
  }

  // 买卖点
  if (Number.isFinite(metrics.entryTargetPrice) || Number.isFinite(metrics.takeProfitPrice)) {
    const buy = Number.isFinite(metrics.entryTargetPrice) ? `买点 ≈ Delta 上沿 ${metrics.entryTargetPrice}` : ''
    const sell = Number.isFinite(metrics.takeProfitPrice) ? `卖点 ≈ 成本带下沿 ${metrics.takeProfitPrice}` : ''
    lines.push([buy, sell].filter(Boolean).join('，'))
  }

  // 社保白名单
  if (metrics.socialSecurityWhitelisted) {
    lines.push(`社保 Q1 重仓名单中，机构筹码托底。`)
  }

  return lines.join(' ')
}

function formatPct(v) {
  if (!Number.isFinite(v)) return '—'
  return `${v > 0 ? '+' : ''}${(v * 100).toFixed(2)}%`
}

// 暴露给外部用：用于在浏览器端动态算回归概率（前端权重调节时不必再去算 z）
export function regressionProbabilityFromZ(z) {
  if (!Number.isFinite(z)) return null
  const abs = Math.abs(z)
  const cdf = standardNormalCdf(abs)
  return Math.max(0, Math.min(1, 2 * cdf - 1))
}

function standardNormalCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x))
  const d = 0.3989422804014337 * Math.exp(-x * x / 2)
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  return x >= 0 ? 1 - p : p
}

// （留作向后兼容；deviationScore 等暂未直接用，但保留以便后续扩展）
void deviationScore
