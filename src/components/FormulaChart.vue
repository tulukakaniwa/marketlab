<script setup>
import { computed } from 'vue'
import { formulaStages } from '../domain/formulas/registry.js'
import { ammCurve, asianOption, deviationScore, gammaPnl, liquidityFingerprint, meanReversionHalfLife, netCarry, netLpEfficiency, riskSurface, volConfidence } from '../domain/formulas/core.js'

const props = defineProps({
  formulaId: { type: String, required: true },
  graph: { type: Object, required: true },
  market: { type: Object, default: null },
  rows: { type: Array, default: () => [] },
  costPath: { type: Array, default: () => [] },
})

const stage = computed(() => formulaStages.find((s) => s.id === props.formulaId))

function fmt(v) { return Number.isFinite(v) ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(v) : '—' }
function f4(v) { return Number.isFinite(v) ? v.toFixed(4) : '—' }
function pctFmt(v) { return Number.isFinite(v) ? `${(v * 100).toFixed(2)}%` : '—' }

/* ── path: 价格路径摘要 ── */
const pathData = computed(() => {
  const r = props.rows
  if (!r?.length) return null
  const first = r[0]; const last = r.at(-1)
  const totalReturn = last.close / first.close - 1
  const logReturn = Math.log(last.close / first.close)
  const annualVol = props.market?.annualVol ?? 0
  return { count: r.length, firstDate: first.date, lastDate: last.date, firstClose: first.close, lastClose: last.close, totalReturn, logReturn, annualVol }
})

/* ── cost: 市场成本 ── */
const costData = computed(() => {
  const m = props.market; if (!m) return null
  return { anchor: m.costAnchor, recent: m.costRecent, low: m.costLow, high: m.costHigh, distance: m.costDistance, price: m.markPrice, slope: m.costSlope5 }
})

/* ── volatility ── */
const volData = computed(() => {
  const m = props.market; const g = props.graph
  if (!m) return null
  return { annualVol: m.annualVol, atr: m.atrPercent, momentum5: m.momentum5, momentum20: m.momentum20, iv: g.inputs?.iv }
})

/* ── delta-band ── */
const bandData = computed(() => {
  const b = props.graph.deltaBands; const mp = props.market?.markPrice
  if (!b || !mp) return null
  const all = [b.long.low, b.long.cost, b.long.high, b.short.cost, b.short.high, mp]
  const min = Math.min(...all) * 0.9
  const max = Math.max(...all) * 1.1
  const range = max - min; const s = (v) => (v - min) / range
  return { min, max, range, longLow: s(b.long.low), longCost: s(b.long.cost), longHigh: s(b.long.high), shortLow: s(b.short.low), shortCost: s(b.short.cost), shortHigh: s(b.short.high), price: s(mp), wave: b.wave, ratio: b.longRatio, raw: b }
})

/* ── greeks ── */
const greeksData = computed(() => {
  const o = props.graph.option; if (!o) return null
  return { price: o.price, delta: o.delta, gamma: o.gamma, theta: o.theta, vega: o.vega, d1: o.d1, d2: o.d2 }
})

/* ── lp-inventory + V2 + IL ── */
const lpData = computed(() => {
  const v3 = props.graph.lpV3; const v2 = props.graph.lp; const il = props.graph.impermanentLoss
  return { v3, v2, il }
})
const syH = (v) => PT + (1 - v) * (200 - PT - PB)
const lpV3Curve = computed(() => {
  const mp = props.market?.markPrice || props.graph.inputs?.entryPrice
  if (!mp) return ''
  try {
    const lo = mp * 0.5; const hi = mp * 2; const n = 50
    const rangeW = Number(props.graph.inputs?.rangeWidth) || 0.1
    const skew = Math.max(Number(props.graph.inputs?.skew) || 1, 0.01)
    const lowerP = props.graph.lpV3Hedged?.lowerPrice || mp * Math.max(1 - rangeW, 0.001)
    const upperP = props.graph.lpV3Hedged?.upperPrice || mp * (1 + rangeW * skew)
    const L = Math.max(Number(props.graph.inputs?.liquidity) || 1, 0.001)
    const pts = []; const svgH = 200 - PT - PB
    for (let i = 0; i <= n; i++) {
      const p = lo + (hi - lo) * i / n
      let val = 0
      if (p <= lowerP) val = L * (1 / Math.sqrt(lowerP) - 1 / Math.sqrt(upperP)) * p
      else if (p >= upperP) val = L * (Math.sqrt(upperP) - Math.sqrt(lowerP))
      else val = L * (1 / Math.sqrt(p) - 1 / Math.sqrt(upperP)) * p + L * (Math.sqrt(p) - Math.sqrt(lowerP))
      if (Number.isFinite(val)) pts.push({ price: p, value: val })
    }
    if (!pts.length) return ''
    const maxV = Math.max(...pts.map(p => p.value), 0.01)
    const minV = Math.min(...pts.map(p => p.value), 0)
    const rng = maxV - minV || 1
    return pts.map(p => `${PL + ((p.price - lo) / (hi - lo)) * pw},${PT + svgH * (1 - (p.value - minV) / rng)}`).join(' ')
  } catch { return '' }
})
const lpV3Marker = computed(() => {
  try {
    const mp = props.market?.markPrice; if (!mp) return { cx: PL, cy: syH(0.5) }
    const lo = mp * 0.5; const hi = mp * 2
    return { cx: PL + ((mp - lo) / (hi - lo)) * pw, cy: syH(0.5) }
  } catch { return { cx: PL, cy: syH(0.5) } }
})
const lpV3Bounds = computed(() => {
  try {
    const mp = props.market?.markPrice; if (!mp) return { loX: PL, hiX: PL + pw }
    const lo = mp * 0.5; const hi = mp * 2
    const rangeW = Number(props.graph.inputs?.rangeWidth) || 0.1
    const skew = Math.max(Number(props.graph.inputs?.skew) || 1, 0.01)
    const lp = props.graph.lpV3Hedged?.lowerPrice || mp * Math.max(1 - rangeW, 0.001)
    const up = props.graph.lpV3Hedged?.upperPrice || mp * (1 + rangeW * skew)
    return { loX: PL + ((lp - lo) / (hi - lo)) * pw, hiX: PL + ((up - lo) / (hi - lo)) * pw }
  } catch { return { loX: PL, hiX: PL + pw } }
})

/* ── capital-efficiency ── */
const ceData = computed(() => { const e = props.graph.efficiency; return e ? { efficiency: e.efficiency, lower: e.lower, upper: e.upper } : null })
const ceCurve = computed(() => {
  try {
    const n = 50; const pts = []
    for (let i = 1; i <= n; i++) {
      const w = i / n; const lo = 1 - w; const up = 1 + w
      if (lo <= 0) continue
      const eff = 1 / (1 - Math.pow(lo / up, 0.25))
      if (!Number.isFinite(eff) || eff > 100) continue
      const x = PL + (w / 1.0) * pw; const y = sy(Math.min(1, eff / 50))
      if (Number.isFinite(x) && Number.isFinite(y)) pts.push(`${x},${y}`)
    }
    return pts.join(' ')
  } catch { return '' }
})
const ceDot = computed(() => {
  try {
    const e = props.graph.efficiency; if (!e) return { cx: PL, cy: sy(0) }
    const w = 1 - e.lower
    const cx = PL + Math.min(1, w) * pw
    const cy = sy(Math.min(1, e.efficiency / 50))
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return { cx: PL, cy: sy(0) }
    return { cx, cy }
  } catch { return { cx: PL, cy: sy(0) } }
})

/* ── funding ── */
const fundData = computed(() => { const f = props.graph.funding; return f ? { ratio: f.ratio, funding: f.funding } : null })

/* ── portfolio ── */
const portData = computed(() => {
  const p = props.graph.portfolio; const h = props.graph.lpV3Hedged
  if (!Number.isFinite(p)) return null
  return { total: p, lpPnl: h?.lpPnl ?? 0, hedgePnl: h?.hedgePnl ?? 0, feeIncome: h?.feeIncome ?? 0, optionVal: props.graph.option?.price ?? 0 }
})
const waterfallBars = computed(() => {
  const p = portData.value; if (!p) return []
  const items = [
    { label: 'LP PnL', val: p.lpPnl || 0 },
    { label: '对冲', val: p.hedgePnl || 0 },
    { label: '手续费', val: p.feeIncome || 0 },
    { label: '期权', val: p.optionVal || 0 },
  ]
  const maxAbs = Math.max(...items.map(i => Math.abs(i.val)), 1)
  const barW = Math.min(60, Math.max(20, (pw - 40) / items.length))
  const gap = Math.max(4, (pw - barW * items.length) / (items.length + 1))
  return items.map((item, i) => {
    const x = PL + gap + i * (barW + gap)
    const h = Math.max(2, Math.min(ph * 0.8, (Math.abs(item.val || 0) / maxAbs) * ph * 0.8))
    const y = (item.val || 0) >= 0 ? sy(0) - h : sy(0)
    const fill = (item.val || 0) >= 0 ? 'var(--green)' : 'var(--red)'
    return { x, y, w: barW, h, fill, label: item.label, val: item.val || 0 }
  })
})

/* ── asian-option ── */
const asianData = computed(() => {
  const m = props.market; const g = props.graph
  const ep = m?.markPrice || g.inputs?.entryPrice
  const iv = m?.annualVol || g.inputs?.iv
  if (!ep || !iv) return null
  return asianOption({ entryPrice: ep, strikePrice: ep * 1.05, holdingDays: g.inputs?.holdingDays || 30, iv, riskFreeRate: 0.04, type: 'put' })
})

/* ── amm-geometry ── */
const ammData = computed(() => {
  const mp = props.market?.markPrice || props.graph.inputs?.entryPrice
  if (!mp) return null
  return ammCurve({ price: mp, invariant: mp, n: 50 })
})

/* ── liquidity-fingerprint ── */
const fingerprintData = computed(() => {
  const mp = props.market?.markPrice || props.graph.inputs?.entryPrice
  if (!mp) return null
  return liquidityFingerprint({ entryPrice: mp, priceGrid: 60, distribution: 'log-laplace', lambda: 2, kappa: 1 })
})

/* ── Fusion: deviation-score ── */
const devScoreData = computed(() => {
  const m = props.market; const g = props.graph
  return deviationScore({ costDistance: m?.costDistance, annualVol: m?.annualVol, holdingDays: g.inputs?.holdingDays, tradingDaysPerYear: g.inputs?.tradingDaysPerYear })
})
const normalCurve = computed(() => {
  try {
    const n = 50; const pts = []; const step = 6 / n
    for (let i = 0; i <= n; i++) {
      const z = -3 + i * step
      const dens = Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI)
      pts.push(`${PL + ((z + 3) / 6) * pw},${sy(Math.min(1, dens / 0.4))}`)
    }
    return pts.join(' ')
  } catch { return '' }
})
const zMarker = computed(() => {
  try {
    const z = devScoreData.value?.z || 0
    const dens = Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI)
    const x = PL + ((z + 3) / 6) * pw
    const y = sy(Math.min(1, dens / 0.4))
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { x: PL, y: sy(0) }
    return { x, y }
  } catch { return { x: PL, y: sy(0) } }
})

/* ── Fusion: risk-surface ── */
const riskSurfaceData = computed(() => {
  const g = props.graph; const m = props.market; const b = g.deltaBands
  const ep = m?.markPrice || g.inputs?.entryPrice
  return riskSurface({ entryPrice: ep, strikePrice: ep, holdingDays: g.inputs?.holdingDays || 30, iv: m?.annualVol || g.inputs?.iv || 0.4, bandLow: b?.long?.low || ep * 0.5, bandHigh: b?.long?.high || ep * 1.5, tradingDaysPerYear: g.inputs?.tradingDaysPerYear })
})

/* ── Fusion: net-lp-efficiency ── */
const netLpData = computed(() => {
  const g = props.graph
  return netLpEfficiency({ capitalEfficiency: g.efficiency?.efficiency, impermanentLoss: g.impermanentLoss?.impermanentLoss, feeRate: 0.003 })
})

/* ── Fusion: net-carry ── */
const netCarryData = computed(() => {
  const m = props.market; const g = props.graph
  return netCarry({ costDistance: m?.costDistance, fundingRate: g.funding?.funding, holdingDays: g.inputs?.holdingDays, tradingDaysPerYear: g.inputs?.tradingDaysPerYear })
})

/* ── 小白指南 ── */
const guide = computed(() => {
  const id = props.formulaId; const m = props.market; const g = props.graph
  const b = g.deltaBands; const o = g.option; const il = g.impermanentLoss
  const ds = devScoreData.value; const nc = netCarryData.value; const nl = netLpData.value

  const guides = {
    path: { title: '怎么看价格路径', body: `这里有 ${m?.rows || '—'} 天的 K 线数据。对数收益是把涨跌幅取对数，用来算波动率。区间跨越 ${m ? '多年' : '—'} ，数据量足够让公式稳定工作。` },
    cost: { title: '怎么看市场成本', body: `成本锚 ${fmt(m?.costAnchor)} 是过去 60 天成交量加权的"市场合理价"。现价 ${fmt(m?.markPrice)} 偏离 ${pctFmt(m?.costDistance)}，${(m?.costDistance ?? 0) < 0 ? '低于成本 → 折价区，适合找买点' : '高于成本 → 溢价区，适合减仓' }。成本带上沿是卖出参考，下沿是买入参考。` },
    volatility: { title: '怎么看波动口径', body: `年化波动 ${pctFmt(m?.annualVol)} 意味着价格在一年内约 68% 概率在 ±${pctFmt(m?.annualVol)} 范围内。${(m?.annualVol ?? 0) > 0.4 ? '波动偏高，挂单间距应该拉大，仓位要轻。' : '波动适中，可以正常操作。'} ATR ${pctFmt(m?.atrPercent)} 是日均波动幅度，用来设止损。` },
    'delta-band': { title: '怎么看 GetDelta 成本带', body: `在 ${g.inputs?.holdingDays || 30} 天窗口、${pctFmt(g.inputs?.iv)} 波动下，多头买入的安全区是 ${fmt(b?.long?.low)} ~ ${fmt(b?.long?.high)}。${(m?.markPrice ?? 0) < (b?.long?.low ?? 0) ? '现价已跌破多头下沿，这是罕见的深度折价。' : (m?.markPrice ?? 0) > (b?.long?.high ?? 0) ? '现价已突破上沿，不适合追多。' : '现价在波动带内，等待更好的价格。'}空头区同理，但 Lab 不主动做空。` },
    'option-greeks': { title: '怎么看期权 Greeks', body: `Delta ${f4(o?.delta)}：标的涨 1 元，期权价值变动 ${f4(o?.delta)} 元。${(o?.delta ?? 0) > 0 ? '正 Delta = 看涨暴露' : '负 Delta = 看跌保护'}。Gamma ${f4(o?.gamma)} 很小说明 Delta 变化慢，不需要频繁调仓。Theta ${fmt(o?.theta)} 是每天的时间损耗（年化值需除 365）。` },
    'asian-option': { title: '研究层：亚式近似', body: `这里只展示 σ/√3 的几何均价近似。Asian/Bachelier 与 LP payoff 的贴合关系还没有逐式确认，不能作为 LP 对冲或挂单结论。` },
    'lp-inventory': { title: '怎么看 LP 库存', body: `当前 V3 LP 头寸价值 ${fmt(g.lpV3?.value)}。无常损失 ${pctFmt(il?.impermanentLoss)}，${(il?.impermanentLoss ?? 0) > -0.01 ? '几乎可以忽略，价格没有大幅偏离入场价。' : '需要关注，价格偏离较大。'} 相比 HODL，LP 额外赚了手续费但承担了无常损失风险。` },
    'liquidity-fingerprint': { title: '研究层：流动性指纹', body: `主图右侧竖仓把连续密度和挂单刻度放到同一条价格轴上，辅助订单流视角。真实 LP 区间权重还需要写出积分、tick 离散化、手续费层级和边界规则；不能直接当 LP 配置建议。` },
    'amm-geometry': { title: '研究层：AMM 几何', body: `这里只画恒定乘积曲线。Lambert W、高斯和 AMM/Numoen Math 的关系仍需按原图和协议机制逐式重读，不能作为交易信号。` },
    'capital-efficiency': { title: '怎么看资本效率', body: `${(g.efficiency?.efficiency ?? 0).toFixed(1)} 倍意味着你的资金利用率是分散做市的 ${(g.efficiency?.efficiency ?? 0).toFixed(0)} 倍。区间 [${(g.efficiency?.lower ?? 0).toFixed(2)}, ${(g.efficiency?.upper ?? 0).toFixed(2)}] 是相对入场价的范围。${(g.efficiency?.efficiency ?? 0) > 5 ? '效率很高，但区间很窄 → 需要更频繁地调仓。' : '效率适中，区间宽度合理。'}` },
    funding: { title: '研究层：资金费率', body: `当前只有 perp TWAP / spot TWAP - 1 的估计：${pctFmt(g.funding?.ratio)}。还没有接真实永续资金费率、结算周期、交易所制度和历史结算数据，不能作为持仓结论。` },
    portfolio: { title: '研究层：组合价值', body: `组合视图只是把 LP、期权、对冲、手续费和资金费率估计放在一起检查。由于 LP payoff、资金费率和真实区间权重仍未校准，这里不参与默认挂单。` },
    'order-plan': { title: '怎么看挂单计划', body: g.plan?.primaryOrders?.length ? `${g.plan.primaryOrders.length} 档挂单，从试仓到加仓到极值。分批买入降低平均成本，跌破失效线不补仓。` : `当前没有挂单：${g.decision?.timing?.reason || '价格未触发入场条件'}。置信度 ${Math.round((g.decision?.confidence ?? 0) * 100)}%。等待价格给出更好的成本差再行动。` },
    'deviation-score': { title: '怎么看偏离强度', body: `Z-score ${ds?.z?.toFixed(2)}：${Math.abs(ds?.z ?? 0) < 0.5 ? '偏离不到半个标准差，统计上不算显著。市场处于"正常波动"范围。' : Math.abs(ds?.z ?? 0) < 1.5 ? '偏离超过 0.5σ，有一定统计意义。可以开始关注入场机会。' : '偏离超过 1.5σ，统计上显著！这是较强的交易信号。'}回归概率 ${ds?.regressionProb ? (ds.regressionProb * 100).toFixed(0) : '—'}%。` },
    'risk-surface': { title: '怎么看风险曲面', body: `在 GetDelta 价格带 [${fmt(b?.long?.low)}, ${fmt(b?.long?.high)}] 上展开 Greeks：Delta 曲线（绿）从虚值到实值，Gamma（蓝）在入场价附近最大 → 这里风险敏感度最高，调仓最频繁。越远离入场价，Gamma 越小 → 风险变化平缓。` },
    'net-lp-efficiency': { title: '研究层：LP 净效率', body: `当前净效率 ${nl ? nl.totalNet.toFixed(1) : '—'}× 只是 IL × CE 的估计。真实 LP 区间权重、手续费制度和再平衡规则未完成，不能判断“可行/赚钱”。` },
    'net-carry': { title: '研究层：持仓净收益', body: `当前净收益估计 ${pctFmt(nc?.netReturn)} 只使用 TWAP 偏离。真实资金费率和结算制度未接入，不能作为持仓是否有利的结论。` },
    'mean-reversion': { title: '怎么看均值回归半衰期', body: `自回归系数 ρ=${mrData.value?.rho?.toFixed(3)}：${Math.abs(mrData.value?.rho ?? 0) > 0.8 ? '偏离高度持续，回归很慢。' : Math.abs(mrData.value?.rho ?? 0) > 0.5 ? '有一定持续性，回归速度中等。' : '偏离衰减快，市场均值回归效率高。'}半衰期 ${mrData.value?.halfLifeDays ? Math.round(mrData.value.halfLifeDays) + ' 天' : '∞'}：偏离幅度衰减到一半所需天数。${mrData.value?.speed === '极慢' || mrData.value?.speed === '慢' ? '速度偏慢 → 不要押注快速回归，需要更多耐心。' : '速度快 → 回归交易窗口短，需要敏捷执行。'}` },
    'gamma-pnl': { title: '怎么看 Gamma PnL', body: `Dollar Gamma ${fmt(gpData.value?.dollarGamma)}：标的价格变动 1 元，Delta 变化这么多。本次价格变动 ${fmt(gpData.value?.priceChange)}，凸性估计 ${fmt(gpData.value?.gammaPnl)}。${gpData.value?.convexityNote}。Gamma PnL = ½·Γ·(ΔP)²；这里仅展示波动平方项，不推导 LP 策略结论。` },
    'vol-confidence': { title: '怎么看波动率置信', body: `基于 ${vcData.value?.sampleSize} 天样本，真实波动率落在 [${pctFmt(vcData.value?.lower)}, ${pctFmt(vcData.value?.upper)}] 区间内（68% 置信）。相对误差 ${pctFmt(vcData.value?.relativeUncertainty)} → ${vcData.value?.quality}。${vcData.value?.quality === '低精度' || vcData.value?.quality === '不可靠' ? '样本太少或波动变化太大 → 所有依赖波动率的计算（Delta 带、Greeks）都需要用更保守的估计。' : '波动率估计可靠 → 可以信任当前的公式输出。'}` },
  }
  return guides[id] || null
})
/* ── 二阶: mean-reversion ── */
const mrData = computed(() => {
  const series = (props.costPath || []).map((c, i) => {
    const row = props.rows?.[i]
    return c?.anchor > 0 && row ? (row.close - c.anchor) / c.anchor : null
  }).filter(v => v !== null)
  return series.length >= 5
    ? meanReversionHalfLife({ costDistanceSeries: series, tradingDaysPerYear: props.graph.inputs?.tradingDaysPerYear })
    : null
})
const decayCurve = computed(() => {
  try {
    const d = mrData.value; if (!d?.halfLifeDays || !Number.isFinite(d.theta)) return ''
    const maxT = d.halfLifeDays * 3; const n = 50; const pts = []
    for (let i = 0; i <= n; i++) {
      const t = (maxT / n) * i; const decay = Math.exp(-d.theta * t)
      if (Number.isFinite(decay)) pts.push(`${PL + (t / maxT) * pw},${sy(decay)}`)
    }
    return pts.join(' ')
  } catch { return '' }
})
const hlMarker = computed(() => {
  try {
    const d = mrData.value; if (!d?.halfLifeDays || !Number.isFinite(d.halfLifeDays)) return { x: PL, y: sy(0) }
    const maxT = d.halfLifeDays * 3
    const x = PL + (d.halfLifeDays / maxT) * pw
    if (!Number.isFinite(x)) return { x: PL, y: sy(0) }
    return { x, y: sy(0.5) }
  } catch { return { x: PL, y: sy(0) } }
})

/* ── 二阶: gamma-pnl ── */
const gpData = computed(() => gammaPnl({ gamma: props.graph.option?.gamma, priceChange: Math.abs(props.market?.costDistance ?? 0) * (props.market?.markPrice ?? 0), positionSize: 1 }))
const gammaCurve = computed(() => {
  try {
    const g = gpData.value; if (!g) return ''
    const maxDP = (props.market?.markPrice || 1) * 0.3; const n = 50; const pts = []
    const maxPnl = Math.abs(0.5 * (g.dollarGamma || 0.0001) * maxDP * maxDP) || 0.01
    for (let i = 0; i <= n; i++) {
      const dp = -maxDP + (2 * maxDP / n) * i
      const pnl = 0.5 * (g.dollarGamma || 0) * dp * dp
      const x = PL + ((dp + maxDP) / (2 * maxDP)) * pw
      const y = sy(Math.min(1, Math.abs(pnl) / maxPnl))
      if (Number.isFinite(x) && Number.isFinite(y)) pts.push(`${x},${y}`)
    }
    return pts.join(' ')
  } catch { return '' }
})
const gpMarker = computed(() => {
  try {
    const g = gpData.value; const maxDP = (props.market?.markPrice || 1) * 0.3
    const dp = g?.priceChange || 0
    const maxPnl = Math.abs(0.5 * (g?.dollarGamma || 0.0001) * maxDP * maxDP) || 0.01
    const cx = PL + ((dp + maxDP) / (2 * maxDP)) * pw
    const cy = sy(Math.min(1, Math.abs(g?.gammaPnl || 0) / maxPnl))
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return { cx: PL, cy: sy(0) }
    return { cx, cy }
  } catch { return { cx: PL, cy: sy(0) } }
})

/* ── 二阶: vol-confidence ── */
const vcData = computed(() => volConfidence({ annualVol: props.market?.annualVol || props.graph.inputs?.iv, sampleSize: Math.min(props.rows?.length || 60, 60) }))

const orderData = computed(() => {
  const plan = props.graph.plan; if (!plan?.primaryOrders?.length) return null
  return plan.primaryOrders.map((o) => ({
    action: o.role, side: o.side, price: o.price, notional: o.notional, amount: o.amount, target: o.targetPrice, expected: o.expectedProfit,
  }))
})

const W = 520; const H = 200; const PL = 50; const PR = 16; const PT = 22; const PB = 24
const pw = W - PL - PR; const ph = H - PT - PB
const sx = (v) => PL + v * pw; const sy = (v) => PT + (1 - v) * ph
</script>

<template>
  <div class="fc-shell">

    <!-- PATH -->
    <div v-if="formulaId === 'path' && pathData" class="fc-card">
      <span class="fc-ttl">价格路径</span>
      <div class="fc-kv">
        <div><b>数据点</b><span>{{ pathData.count }}</span></div>
        <div><b>区间</b><span>{{ pathData.firstDate }} → {{ pathData.lastDate }}</span></div>
        <div><b>首价</b><span>{{ fmt(pathData.firstClose) }}</span></div>
        <div><b>尾价</b><span>{{ fmt(pathData.lastClose) }}</span></div>
        <div><b>总收益</b><span :class="pathData.totalReturn >= 0 ? 'green' : 'red'">{{ pctFmt(pathData.totalReturn) }}</span></div>
        <div><b>对数收益</b><span>{{ f4(pathData.logReturn) }}</span></div>
      </div>
    </div>

    <!-- COST -->
    <div v-else-if="formulaId === 'cost' && costData" class="fc-card">
      <span class="fc-ttl">市场成本结构</span>
      <svg :viewBox="`0 0 ${W} ${H}`" class="fc-svg">
        <rect :x="sx(0.02)" :y="sy(0.95)" :width="pw*0.35" :height="ph*0.05" rx="3" fill="var(--blue-dim)" />
        <text :x="sx(0.04)" :y="sy(0.93)" class="fc-tick">成本带 {{ fmt(costData.low) }} – {{ fmt(costData.high) }}</text>
        <!-- anchor line -->
        <line :x1="PL" :x2="W-PR" :y1="sy(0.5)" :y2="sy(0.5)" stroke="var(--green)" stroke-width="2" />
        <text :x="W-PR" :y="sy(0.5)-6" text-anchor="end" class="fc-tick green">锚 {{ fmt(costData.anchor) }}</text>
        <!-- price marker -->
        <circle :cx="sx(0.15)" :cy="sy(costData.price > costData.anchor ? 0.25 : 0.75)" r="5" fill="var(--ink)" />
        <text :x="sx(0.15)+10" :y="sy(costData.price > costData.anchor ? 0.25 : 0.75)+4" class="fc-tick">现价 {{ fmt(costData.price) }}</text>
        <!-- distance arrow -->
        <line :x1="sx(0.2)" :x2="sx(0.2)" :y1="sy(0.5)" :y2="sy(costData.price > costData.anchor ? 0.25 : 0.75)" stroke="var(--red)" stroke-width="1.5" marker-end="url(#arrow-red)" />
        <text :x="sx(0.22)" :y="sy(0.4)" class="fc-tick red">偏离 {{ pctFmt(costData.distance) }}</text>
      </svg>
      <div class="fc-kv">
        <div><b>成本锚</b><span>{{ fmt(costData.anchor) }}</span></div>
        <div><b>近端成本</b><span>{{ fmt(costData.recent) }}</span></div>
        <div><b>成本下沿</b><span>{{ fmt(costData.low) }}</span></div>
        <div><b>成本上沿</b><span>{{ fmt(costData.high) }}</span></div>
        <div><b>偏离度</b><span :class="costData.distance < 0 ? 'green' : 'red'">{{ pctFmt(costData.distance) }}</span></div>
        <div><b>斜率5d</b><span>{{ pctFmt(costData.slope) }}</span></div>
      </div>
    </div>

    <!-- VOLATILITY -->
    <div v-else-if="formulaId === 'volatility' && volData" class="fc-card">
      <span class="fc-ttl">波动口径</span>
      <div class="fc-vol">
        <div class="fc-vol-main">
          <span class="fc-big">{{ pctFmt(volData.annualVol) }}</span>
          <small>年化波动率</small>
        </div>
        <div class="fc-vol-main">
          <span class="fc-big">{{ pctFmt(volData.atr) }}</span>
          <small>ATR%</small>
        </div>
      </div>
      <div class="fc-kv">
        <div><b>年化波动</b><span>{{ pctFmt(volData.annualVol) }}</span></div>
        <div><b>ATR%</b><span>{{ pctFmt(volData.atr) }}</span></div>
        <div><b>动量5日</b><span :class="volData.momentum5 >= 0 ? 'green' : 'red'">{{ pctFmt(volData.momentum5) }}</span></div>
        <div><b>动量20日</b><span :class="volData.momentum20 >= 0 ? 'green' : 'red'">{{ pctFmt(volData.momentum20) }}</span></div>
        <div><b>输入 IV</b><span>{{ pctFmt(volData.iv) }}</span></div>
      </div>
    </div>

    <!-- DELTA BANDS -->
    <svg v-else-if="formulaId === 'delta-band' && bandData" :viewBox="`0 0 ${W} ${H}`" class="fc-svg">
      <defs><marker id="arrow-red" viewBox="0 0 6 6" refX="3" refY="3" markerWidth="4" markerHeight="4"><path d="M0,6 L3,0 L6,6 Z" fill="var(--red)" /></marker></defs>
      <text :x="W/2" :y="14" text-anchor="middle" class="fc-ttl">价格带 · 多空成本结构</text>
      <rect :x="sx(0.0)" :y="sy(bandData.longHigh)" :width="pw*0.42" :height="Math.max(2, ph*(bandData.longHigh - bandData.longLow))" fill="var(--blue-dim)" rx="4" />
      <text :x="sx(0.02)" :y="sy(bandData.longCost)+4" class="fc-tick">多头区</text>
      <rect :x="sx(0.55)" :y="sy(bandData.shortHigh)" :width="pw*0.42" :height="Math.max(2, ph*(bandData.shortHigh - bandData.shortLow))" fill="var(--red-dim)" rx="4" />
      <text :x="sx(0.57)" :y="sy(bandData.shortCost)+4" class="fc-tick">空头区</text>
      <!-- lines -->
      <line v-for="(label, key) in { longHigh: '长上', longCost: '长本', longLow: '长下', shortHigh: '空上', shortCost: '空本' }" :key="key" :x1="PL" :x2="W-PR" :y1="sy(bandData[key])" :y2="sy(bandData[key])" :stroke="key.includes('Cost') ? 'var(--green)' : 'var(--muted)'" :stroke-width="key.includes('Cost') ? 1.8 : 0.8" :stroke-dasharray="key.includes('Cost') ? 'none' : '4,3'" />
      <!-- price -->
      <line :x1="PL" :x2="W-PR" :y1="sy(bandData.price)" :y2="sy(bandData.price)" stroke="var(--ink)" stroke-width="2" />
      <circle :cx="sx(0.01)" :cy="sy(bandData.price)" r="4" fill="var(--ink)" />
      <text :x="sx(0.01)+8" :y="sy(bandData.price)+4" class="fc-tick">现价 {{ fmt(props.market?.markPrice) }}</text>
      <text :x="W-PR" :y="H-4" text-anchor="end" class="fc-tick">波 {{ bandData.wave.toFixed(4) }} · 率 {{ bandData.ratio.toFixed(2) }}</text>
    </svg>

    <!-- OPTION GREEKS -->
    <div v-else-if="formulaId === 'option-greeks' && greeksData" class="fc-card">
      <span class="fc-ttl">期权 Greeks</span>
      <div class="fc-gr4">
        <div class="fc-gi"><b>价格</b><span>{{ fmt(greeksData.price) }}</span></div>
        <div class="fc-gi"><b>Δ</b><span :class="greeksData.delta > 0 ? 'green' : 'red'">{{ f4(greeksData.delta) }}</span></div>
        <div class="fc-gi"><b>Γ</b><span>{{ f4(greeksData.gamma) }}</span></div>
        <div class="fc-gi"><b>Θ</b><span>{{ f4(greeksData.theta) }}</span></div>
        <div class="fc-gi"><b>ν</b><span>{{ f4(greeksData.vega) }}</span></div>
      </div>
      <div class="fc-meta">d₁ = {{ greeksData.d1?.toFixed(4) }} · d₂ = {{ greeksData.d2?.toFixed(4) }}</div>
    </div>

    <!-- LP INVENTORY -->
    <svg v-else-if="formulaId === 'lp-inventory' && lpData" :viewBox="`0 0 ${W} ${220}`" class="fc-svg">
      <text :x="W/2" :y="14" text-anchor="middle" class="fc-ttl">LP 库存曲线 · V3 头寸价值 vs 价格</text>
      <!-- V3 value curve points -->
      <polyline v-if="lpV3Curve" :points="lpV3Curve" fill="none" stroke="var(--green)" stroke-width="2" />
      <!-- HODL line -->
      <line v-if="lpV3Curve" :x1="PL" :y1="syH(0.5)" :x2="W-PR" :y2="syH(0.5)" stroke="var(--muted)" stroke-width="1" stroke-dasharray="4,3" />
      <text :x="W-PR" :y="syH(0.5)-4" text-anchor="end" class="fc-tick">HODL</text>
      <!-- Entry price marker -->
      <circle v-if="lpV3Curve" :cx="lpV3Marker?.cx" :cy="lpV3Marker?.cy" r="4" fill="var(--ink)" />
      <text v-if="lpV3Curve" :x="lpV3Marker?.cx + 8" :y="lpV3Marker?.cy - 6" class="fc-tick">入场</text>
      <!-- Range bounds -->
      <line v-if="lpV3Curve" :x1="lpV3Bounds?.loX" :x2="lpV3Bounds?.loX" :y1="syH(1)" :y2="syH(0.1)" stroke="var(--blue)" stroke-width="0.8" stroke-dasharray="3,3" />
      <line v-if="lpV3Curve" :x1="lpV3Bounds?.hiX" :x2="lpV3Bounds?.hiX" :y1="syH(1)" :y2="syH(0.1)" stroke="var(--red)" stroke-width="0.8" stroke-dasharray="3,3" />
      <text :x="PL" :y="218" class="fc-tick">V3 绿线 = LP价值曲线 · HODL 灰线 = 持有不动 · 蓝/红虚线 = 区间边界</text>
    </svg>

    <!-- LIQUIDITY FINGERPRINT -->
    <svg v-else-if="formulaId === 'liquidity-fingerprint' && fingerprintData" :viewBox="`0 0 ${W} ${H+30}`" class="fc-svg">
      <text :x="W/2" :y="14" text-anchor="middle" class="fc-ttl">流动性指纹 · LP 区间权重</text>

      <!-- Price axis -->
      <line :x1="PL" :x2="W-PR" :y1="sy(0)" :y2="sy(0)" stroke="var(--line)" stroke-width="1" />
      <text :x="PL" :y="sy(0)+18" text-anchor="middle" class="fc-tick">{{ fmt(fingerprintData.lower) }}</text>
      <text :x="W-PR" :y="sy(0)+18" text-anchor="end" class="fc-tick">{{ fmt(fingerprintData.upper) }}</text>
      <text :x="W/2" :y="sy(0)+18" text-anchor="middle" class="fc-tick">价格区间</text>

      <!-- Entry price marker -->
      <line :x1="sx((fingerprintData.entryPrice - fingerprintData.lower) / (fingerprintData.upper - fingerprintData.lower))" :x2="sx((fingerprintData.entryPrice - fingerprintData.lower) / (fingerprintData.upper - fingerprintData.lower))" :y1="sy(0)" :y2="sy(1.05)" stroke="var(--ink)" stroke-width="1.5" stroke-dasharray="3,3" />
      <text :x="sx((fingerprintData.entryPrice - fingerprintData.lower) / (fingerprintData.upper - fingerprintData.lower))" :y="sy(1.05)+12" text-anchor="middle" class="fc-tick">入场 {{ fmt(fingerprintData.entryPrice) }}</text>

      <!-- Density curve as polygon -->
      <polygon
        :points="fingerprintData.prices.map((p, i) => {
          const rx = PL + (i / (fingerprintData.prices.length - 1)) * pw
          const ry = sy(0) - (p.density / fingerprintData.maxDensity) * ph
          return `${rx},${ry}`
        }).join(' ') + ` ${PL + pw},${sy(0)} ${PL},${sy(0)}`"
        fill="var(--blue-dim)"
        stroke="var(--blue)"
        stroke-width="1"
      />

      <!-- Entry price dot on curve -->
      <circle
        :cx="sx((fingerprintData.entryPrice - fingerprintData.lower) / (fingerprintData.upper - fingerprintData.lower))"
        :cy="sy(0) - (fingerprintData.prices.find(p => Math.abs(p.price - fingerprintData.entryPrice) < (fingerprintData.upper - fingerprintData.lower) / 100)?.density || 0) / fingerprintData.maxDensity * ph"
        r="4" fill="var(--green)"
      />

      <!-- LP segment weight bars -->
      <g v-for="(seg, si) in fingerprintData.segments" :key="'s'+si">
        <rect
          :x="sx((seg.lower - fingerprintData.lower) / (fingerprintData.upper - fingerprintData.lower))"
          :y="sy(-0.15) - seg.weight * ph * 0.15"
          :width="Math.max(2, pw / fingerprintData.segments.length - 2)"
          :height="seg.weight * ph * 0.15"
          :fill="si % 2 === 0 ? 'var(--green)' : 'var(--blue)'"
          :opacity="0.5 + seg.weight * 0.5"
          rx="1"
        />
        <text
          v-if="seg.weight > 0.05"
          :x="sx((seg.lower - fingerprintData.lower) / (fingerprintData.upper - fingerprintData.lower)) + pw / fingerprintData.segments.length / 2"
          :y="sy(-0.15) - seg.weight * ph * 0.15 - 2"
          text-anchor="middle" class="fc-tick"
        >{{ (seg.weight * 100).toFixed(0) }}%</text>
      </g>
      <text :x="W/2" :y="sy(-0.15)+12" text-anchor="middle" class="fc-tick">LP 分片权重 ({{ fingerprintData.params.distribution }})</text>
    </svg>

    <!-- AMM GEOMETRY -->
    <svg v-else-if="formulaId === 'amm-geometry' && ammData" :viewBox="`0 0 ${W} ${H}`" class="fc-svg">
      <text :x="W/2" :y="14" text-anchor="middle" class="fc-ttl">AMM 储备曲线 · xy = k</text>

      <!-- Axes -->
      <line :x1="PL" :x2="W-PR" :y1="sy(0)" :y2="sy(0)" stroke="var(--line)" stroke-width="1" />
      <line :x1="PL" :x2="PL" :y1="sy(1)" :y2="sy(0)" stroke="var(--line)" stroke-width="1" />

      <!-- Hyperbola xy = k -->
      <polyline
        :points="ammData.points.map(p => {
          const rx = PL + (p.x / (ammData.currentX * 3)) * pw
          const ry = sy(0) - (p.y / (ammData.currentY * 3)) * ph
          return `${rx},${ry}`
        }).join(' ')"
        fill="none" stroke="var(--green)" stroke-width="2"
      />

      <!-- Current reserve point -->
      <line :x1="PL" :x2="sx(ammData.currentX / (ammData.currentX * 3))" :y1="sy(0) - (ammData.currentY / (ammData.currentY * 3)) * ph" :y2="sy(0) - (ammData.currentY / (ammData.currentY * 3)) * ph" stroke="var(--muted)" stroke-width="0.5" stroke-dasharray="3,3" />
      <line :x1="sx(ammData.currentX / (ammData.currentX * 3))" :x2="sx(ammData.currentX / (ammData.currentX * 3))" :y1="sy(0)" :y2="sy(0) - (ammData.currentY / (ammData.currentY * 3)) * ph" stroke="var(--muted)" stroke-width="0.5" stroke-dasharray="3,3" />
      <circle :cx="sx(ammData.currentX / (ammData.currentX * 3))" :cy="sy(0) - (ammData.currentY / (ammData.currentY * 3)) * ph" r="5" fill="var(--ink)" />
      <text :x="sx(ammData.currentX / (ammData.currentX * 3)) + 8" :y="sy(0) - (ammData.currentY / (ammData.currentY * 3)) * ph - 6" class="fc-tick">储备 ({{ f4(ammData.currentX) }}, {{ f4(ammData.currentY) }})</text>

      <!-- Labels -->
      <text :x="W-PR" :y="sy(0.05)" text-anchor="end" class="fc-tick">x (Token0)</text>
      <text :x="PL+4" :y="sy(0.95)" class="fc-tick">y (Token1)</text>

      <text :x="W-PR" :y="H-4" text-anchor="end" class="fc-tick">L = {{ f4(ammData.L) }} · k = {{ fmt(ammData.invariant) }} · P = {{ fmt(ammData.price) }}</text>
    </svg>

    <!-- CAPITAL EFFICIENCY -->
    <svg v-else-if="formulaId === 'capital-efficiency' && ceData" :viewBox="`0 0 ${W} ${H}`" class="fc-svg">
      <text :x="W/2" :y="14" text-anchor="middle" class="fc-ttl">资本效率 · 效率 vs 区间宽度</text>
      <polyline :points="ceCurve.value" fill="none" stroke="var(--green)" stroke-width="2" />
      <circle :cx="ceDot.value?.cx ?? PL" :cy="ceDot.value?.cy ?? sy(0)" r="5" fill="var(--ink)" />
      <text :x="(ceDot.value?.cx ?? PL) + 8" :y="(ceDot.value?.cy ?? sy(0)) - 6" class="fc-tick">{{ ceData.efficiency.toFixed(1) }}× @ {{ ((1 - ceData.lower) * 100).toFixed(1) }}%</text>
      <line :x1="PL" :x2="W-PR" :y1="sy(0)" :y2="sy(0)" stroke="var(--line)" stroke-width="1" />
      <text :x="PL" :y="sy(0)+16" class="fc-tick">0%</text>
      <text :x="W-PR" :y="sy(0)+16" text-anchor="end" class="fc-tick">100%</text>
      <text :x="W/2" :y="H-4" text-anchor="middle" class="fc-tick">区间宽度（1 - lower/upper）</text>
    </svg>

    <!-- FUNDING -->
    <svg v-else-if="formulaId === 'funding' && fundData" :viewBox="`0 0 ${W} 120`" class="fc-svg">
      <text :x="W/2" :y="16" text-anchor="middle" class="fc-ttl">资金费率 · 永续溢价/折价</text>
      <line :x1="PL" :x2="W-PR" :y1="60" :y2="60" stroke="var(--line)" stroke-width="1" />
      <text :x="PL-4" :y="64" text-anchor="end" class="fc-tick">0</text>
      <!-- Bar showing ratio -->
      <rect :x="W/2 - 40" :y="fundData.ratio > 0 ? 60 - Math.abs(fundData.ratio) * 600 : 60" width="80" :height="Math.max(4, Math.abs(fundData.ratio) * 600)" :fill="fundData.ratio > 0 ? 'var(--red)' : 'var(--green)'" rx="3" opacity="0.7" />
      <text :x="W/2" :y="fundData.ratio > 0 ? 50 : 80" text-anchor="middle" class="fc-tick" :fill="fundData.ratio > 0 ? 'var(--red)' : 'var(--green)'">{{ pctFmt(fundData.ratio) }}</text>
      <text :x="W/2" :y="108" text-anchor="middle" class="fc-tick">{{ fundData.ratio > 0 ? '多头付费 (偏多)' : '空头付费 (偏空)' }} · 累计 {{ pctFmt(fundData.funding) }}</text>
    </svg>

    <!-- PORTFOLIO -->
    <svg v-else-if="formulaId === 'portfolio' && portData" :viewBox="`0 0 ${W} ${H}`" class="fc-svg">
      <text :x="W/2" :y="14" text-anchor="middle" class="fc-ttl">组合价值 {{ fmt(portData.total) }}</text>
      <line :x1="PL" :x2="W-PR" :y1="sy(0)" :y2="sy(0)" stroke="var(--line)" stroke-width="1" />
      <!-- Waterfall bars -->
      <rect v-for="(bar, i) in waterfallBars.value" :key="i" :x="bar.x" :y="bar.y" :width="bar.w" :height="bar.h" :fill="bar.fill" rx="2" />
      <text v-for="(bar, i) in waterfallBars.value" :key="'t'+i" :x="bar.x + bar.w/2" :y="bar.y - 4" text-anchor="middle" class="fc-tick">{{ bar.label }} {{ fmt(bar.val) }}</text>
    </svg>

    <!-- ORDER PLAN -->
    <div v-else-if="formulaId === 'order-plan'" class="fc-card">
      <span class="fc-ttl">挂单计划</span>
      <template v-if="orderData">
        <div class="fc-orders">
          <div v-for="(o, i) in orderData" :key="i" class="fc-orow">
            <span class="fc-orole">{{ o.action }}</span>
            <span>{{ o.side === 'buy' ? '买' : '卖' }} @ {{ fmt(o.price) }}</span>
            <span class="fc-onotional">名义 {{ fmt(o.notional) }}</span>
            <span v-if="o.expected" :class="o.expected > 0 ? 'green' : 'red'">预期 {{ fmt(o.expected) }}</span>
          </div>
        </div>
      </template>
      <div v-else class="fc-plan-wait">
        <span class="fc-big">等待</span>
        <div class="fc-meta">{{ props.graph.decision?.timing?.reason || '价格未触发入场条件' }}</div>
        <div class="fc-kv">
          <div><b>状态</b><span>{{ props.graph.decision?.state || '—' }}</span></div>
          <div><b>失效下沿</b><span>{{ fmt(props.graph.plan?.invalidation?.lower) }}</span></div>
          <div><b>失效上沿</b><span>{{ fmt(props.graph.plan?.invalidation?.upper) }}</span></div>
          <div><b>置信度</b><span>{{ Math.round((props.graph.decision?.confidence ?? 0) * 100) }}%</span></div>
        </div>
        <div class="fc-meta" v-if="props.graph.decision?.invalidations?.length">
          <div v-for="(inv, idx) in props.graph.decision.invalidations" :key="idx">• {{ inv }}</div>
        </div>
      </div>
    </div>

    <!-- ASIAN OPTION -->
    <div v-else-if="formulaId === 'asian-option' && asianData" class="fc-card">
      <span class="fc-ttl">亚式近似 · 几何均价 Greeks</span>
      <div class="fc-asian">
        <div class="fc-asian-cmp">
          <div class="fc-gi"><b>常规 IV</b><span>{{ pctFmt(asianData.regularIv) }}</span></div>
          <span class="cf-arrow">→</span>
          <div class="fc-gi"><b>几何 IV</b><span class="green">{{ pctFmt(asianData.sigmaGeo) }}</span></div>
        </div>
        <div class="fc-meta">σ_geo = σ / √3 ≈ {{ (asianData.regularIv / 1.732).toFixed(4) }} → 降低 {{ ((1 - 1/1.732) * 100).toFixed(0) }}% 有效波动</div>
      </div>
      <div class="fc-gr4">
        <div class="fc-gi"><b>价格</b><span>{{ fmt(asianData.price) }}</span></div>
        <div class="fc-gi"><b>Δ</b><span :class="asianData.delta > 0 ? 'green' : 'red'">{{ f4(asianData.delta) }}</span></div>
        <div class="fc-gi"><b>d₁</b><span>{{ f4(asianData.d1) }}</span></div>
        <div class="fc-gi"><b>d₂</b><span>{{ f4(asianData.d2) }}</span></div>
      </div>
    </div>

    <!-- DEVIATION SCORE -->
    <svg v-else-if="formulaId === 'deviation-score' && devScoreData" :viewBox="`0 0 ${W} ${H}`" class="fc-svg">
      <text :x="W/2" :y="14" text-anchor="middle" class="fc-ttl">偏离强度 · Z={{ devScoreData.z.toFixed(2) }}σ · {{ devScoreData.regime }}{{ devScoreData.strength }}</text>
      <!-- Normal distribution curve -->
      <polyline :points="normalCurve.value" fill="var(--blue-dim)" stroke="var(--blue)" stroke-width="1.5" />
      <!-- Z-score marker -->
      <line :x1="zMarker.value?.x ?? PL" :x2="zMarker.value?.x ?? PL" :y1="sy(1)" :y2="sy(0.02)" stroke="var(--ink)" stroke-width="2" />
      <circle :cx="zMarker.value?.x ?? PL" :cy="zMarker.value?.y ?? sy(0)" r="5" fill="var(--red)" />
      <text :x="(zMarker.value?.x ?? PL) + 6" :y="(zMarker.value?.y ?? sy(0)) - 6" class="fc-tick" fill="var(--red)">Z={{ devScoreData.z.toFixed(2) }}</text>
      <!-- Zero line -->
      <line :x1="W/2" :x2="W/2" :y1="sy(1)" :y2="sy(0.02)" stroke="var(--line)" stroke-width="1" stroke-dasharray="3,3" />
      <text :x="W/2" :y="sy(0)+18" text-anchor="middle" class="fc-tick">0σ</text>
      <text :x="W-PR" :y="H-4" text-anchor="end" class="fc-tick">回归概率 {{ (devScoreData.regressionProb * 100).toFixed(0) }}%</text>
    </svg>

    <!-- RISK SURFACE -->
    <svg v-else-if="formulaId === 'risk-surface' && riskSurfaceData" :viewBox="`0 0 ${W} ${H}`" class="fc-svg">
      <text :x="W/2" :y="14" text-anchor="middle" class="fc-ttl">风险曲面 · Greeks × 价格带</text>
      <line :x1="PL" :x2="W-PR" :y1="sy(0)" :y2="sy(0)" stroke="var(--line)" stroke-width="1" />
      <!-- Delta curve -->
      <polyline :points="riskSurfaceData.points.map((p, i) => `${sx(i / riskSurfaceData.points.length)},${sy(p.delta)}`).join(' ')" fill="none" stroke="var(--green)" stroke-width="1.5" />
      <text :x="W-PR" :y="sy(riskSurfaceData.points[riskSurfaceData.points.length-1].delta)+4" text-anchor="end" class="fc-tick green">Δ</text>
      <!-- Gamma curve (scaled up 100x) -->
      <polyline :points="riskSurfaceData.points.map((p, i) => `${sx(i / riskSurfaceData.points.length)},${sy(Math.min(1, p.gamma * 100))}`).join(' ')" fill="none" stroke="var(--blue)" stroke-width="1" stroke-dasharray="3,2" />
      <text :x="W-PR" :y="sy(Math.min(1, riskSurfaceData.points[riskSurfaceData.points.length-1].gamma * 100))-6" text-anchor="end" class="fc-tick blue">Γ×100</text>
      <!-- Entry price line -->
      <line :x1="sx((riskSurfaceData.entryPrice - riskSurfaceData.bandLow) / (riskSurfaceData.bandHigh - riskSurfaceData.bandLow))" :x2="sx((riskSurfaceData.entryPrice - riskSurfaceData.bandLow) / (riskSurfaceData.bandHigh - riskSurfaceData.bandLow))" :y1="sy(0)" :y2="sy(1)" stroke="var(--ink)" stroke-width="1" stroke-dasharray="4,3" />
      <text :x="sx((riskSurfaceData.entryPrice - riskSurfaceData.bandLow) / (riskSurfaceData.bandHigh - riskSurfaceData.bandLow))" :y="sy(0.05)" text-anchor="middle" class="fc-tick">入场</text>
      <text :x="PL" :y="sy(0)+18" text-anchor="start" class="fc-tick">{{ fmt(riskSurfaceData.bandLow) }}</text>
      <text :x="W-PR" :y="sy(0)+18" text-anchor="end" class="fc-tick">{{ fmt(riskSurfaceData.bandHigh) }}</text>
    </svg>

    <!-- NET LP EFFICIENCY -->
    <svg v-else-if="formulaId === 'net-lp-efficiency' && netLpData" :viewBox="`0 0 ${W} ${H}`" class="fc-svg">
      <text :x="W/2" :y="14" text-anchor="middle" class="fc-ttl">LP 净效率 · 研究层</text>
      <line :x1="PL" :x2="W-PR" :y1="sy(0)" :y2="sy(0)" stroke="var(--line)" stroke-width="1" />
      <!-- CE gain bar -->
      <rect x="80" :y="sy(netLpData.grossGain / Math.max(netLpData.grossGain, Math.abs(netLpData.impermanentLoss), 0.1))" width="50" :height="Math.max(2, (netLpData.grossGain / Math.max(netLpData.grossGain, Math.abs(netLpData.impermanentLoss), 0.1)) * ph)" fill="var(--green)" rx="2" opacity="0.7" />
      <text x="105" :y="sy(netLpData.grossGain / Math.max(netLpData.grossGain, Math.abs(netLpData.impermanentLoss), 0.1)) - 4" text-anchor="middle" class="fc-tick" fill="var(--green)">CE +{{ netLpData.grossGain.toFixed(1) }}×</text>
      <!-- IL loss bar -->
      <rect v-if="netLpData.impermanentLoss < 0" x="160" y="60" width="50" :height="Math.max(2, (Math.abs(netLpData.impermanentLoss) / Math.max(netLpData.grossGain, Math.abs(netLpData.impermanentLoss), 0.1)) * ph)" fill="var(--red)" rx="2" opacity="0.7" />
      <text v-if="netLpData.impermanentLoss < 0" x="185" y="56" text-anchor="middle" class="fc-tick" fill="var(--red)">IL {{ pctFmt(netLpData.impermanentLoss) }}</text>
      <!-- Fee bar -->
      <rect x="240" :y="sy(netLpData.feeBoost / Math.max(netLpData.grossGain, Math.abs(netLpData.impermanentLoss), 0.1))" width="50" :height="Math.max(2, (netLpData.feeBoost / Math.max(netLpData.grossGain, Math.abs(netLpData.impermanentLoss), 0.1)) * ph)" fill="var(--blue)" rx="2" opacity="0.6" />
      <text x="265" :y="sy(netLpData.feeBoost / Math.max(netLpData.grossGain, Math.abs(netLpData.impermanentLoss), 0.1)) - 2" text-anchor="middle" class="fc-tick" fill="var(--blue)">Fee {{ netLpData.feeBoost.toFixed(2) }}×</text>
      <!-- Net total line -->
      <line :x1="PL" :x2="W-PR" :y1="sy(netLpData.totalNet / Math.max(netLpData.grossGain, Math.abs(netLpData.impermanentLoss), 0.1))" :y2="sy(netLpData.totalNet / Math.max(netLpData.grossGain, Math.abs(netLpData.impermanentLoss), 0.1))" stroke="var(--ink)" stroke-width="2" />
      <text :x="W-PR" :y="sy(netLpData.totalNet / Math.max(netLpData.grossGain, Math.abs(netLpData.impermanentLoss), 0.1)) - 3" text-anchor="end" class="fc-tick">净 {{ netLpData.totalNet.toFixed(2) }}×</text>
      <text :x="W/2" :y="H-2" text-anchor="middle" class="fc-tick">CE {{ netLpData.ce.toFixed(1) }}×</text>
    </svg>

    <!-- NET CARRY -->
    <svg v-else-if="formulaId === 'net-carry' && netCarryData" :viewBox="`0 0 ${W} ${H}`" class="fc-svg">
      <text :x="W/2" :y="14" text-anchor="middle" class="fc-ttl">持仓净收益 · 研究层</text>
      <line :x1="PL" :x2="W-PR" :y1="sy(0)" :y2="sy(0)" stroke="var(--line)" stroke-width="1" />
      <!-- Cost distance bar (potential gain) -->
      <rect x="80" :y="sy(Math.abs(netCarryData.costDistance) / Math.max(Math.abs(netCarryData.costDistance), netCarryData.fundingCost, 0.01))" width="60" :height="Math.max(2, (Math.abs(netCarryData.costDistance) / Math.max(Math.abs(netCarryData.costDistance), netCarryData.fundingCost, 0.01)) * ph)" fill="var(--green)" rx="2" opacity="0.6" />
      <text x="110" :y="sy(Math.abs(netCarryData.costDistance) / Math.max(Math.abs(netCarryData.costDistance), netCarryData.fundingCost, 0.01)) - 4" text-anchor="middle" class="fc-tick" fill="var(--green)">偏离 {{ pctFmt(Math.abs(netCarryData.costDistance)) }}</text>
      <!-- Funding cost bar -->
      <rect x="180" :y="sy(netCarryData.fundingCost / Math.max(Math.abs(netCarryData.costDistance), netCarryData.fundingCost, 0.01))" width="60" :height="Math.max(2, (netCarryData.fundingCost / Math.max(Math.abs(netCarryData.costDistance), netCarryData.fundingCost, 0.01)) * ph)" fill="var(--red)" rx="2" opacity="0.6" />
      <text x="210" :y="sy(netCarryData.fundingCost / Math.max(Math.abs(netCarryData.costDistance), netCarryData.fundingCost, 0.01)) - 4" text-anchor="middle" class="fc-tick" fill="var(--red)">成本 {{ pctFmt(netCarryData.fundingCost) }}</text>
      <!-- Net result -->
      <line :x1="PL" :x2="W-PR" :y1="sy(Math.abs(netCarryData.netReturn) / Math.max(Math.abs(netCarryData.costDistance), netCarryData.fundingCost, 0.01))" :y2="sy(Math.abs(netCarryData.netReturn) / Math.max(Math.abs(netCarryData.costDistance), netCarryData.fundingCost, 0.01))" stroke="var(--ink)" stroke-width="2" />
      <text :x="W-PR" :y="sy(Math.abs(netCarryData.netReturn) / Math.max(Math.abs(netCarryData.costDistance), netCarryData.fundingCost, 0.01)) - 3" text-anchor="end" class="fc-tick">净 {{ pctFmt(netCarryData.netReturn) }}</text>
      <text :x="W/2" :y="H-2" text-anchor="middle" class="fc-tick">盈亏平衡估计 @ {{ pctFmt(netCarryData.breakEven) }} · 未接真实资金费率</text>
    </svg>

    <!-- MEAN REVERSION -->
    <svg v-else-if="formulaId === 'mean-reversion'" :viewBox="`0 0 ${W} ${H}`" class="fc-svg">
      <text :x="W/2" :y="14" text-anchor="middle" class="fc-ttl">均值回归 · 半衰期 {{ mrData.halfLifeDays !== null ? Math.round(mrData.halfLifeDays) + '天' : '∞' }}</text>
      <line :x1="PL" :x2="W-PR" :y1="sy(0)" :y2="sy(0)" stroke="var(--line)" stroke-width="1" />
      <!-- Decay curve: e^(-θ×t) -->
      <polyline :points="decayCurve.value" fill="none" stroke="var(--green)" stroke-width="2" />
      <!-- Half-life marker -->
      <line v-if="mrData.halfLifeDays !== null" :x1="hlMarker.value?.x ?? PL" :x2="hlMarker.value?.x ?? PL" :y1="sy(0)" :y2="sy(0.55)" stroke="var(--red)" stroke-width="1" stroke-dasharray="4,3" />
      <circle v-if="mrData.halfLifeDays !== null" :cx="hlMarker.value?.x ?? PL" :cy="hlMarker.value?.y ?? sy(0)" r="4" fill="var(--red)" />
      <text v-if="mrData.halfLifeDays !== null" :x="(hlMarker.value?.x ?? PL) + 6" :y="(hlMarker.value?.y ?? sy(0)) - 4" class="fc-tick" fill="var(--red)">t½={{ Math.round(mrData.halfLifeDays) }}天</text>
      <text :x="PL" :y="sy(0)+16" class="fc-tick">0</text>
      <text :x="W-PR" :y="sy(0)+16" text-anchor="end" class="fc-tick">{{ Math.round(mrData.halfLifeDays * 3) || 90 }}天</text>
      <text :x="W/2" :y="H-2" text-anchor="middle" class="fc-tick">ρ={{ mrData.rho.toFixed(3) }} · θ={{ mrData.theta.toFixed(4) }} · {{ mrData.speed }}</text>
    </svg>

    <!-- GAMMA PNL -->
    <svg v-else-if="formulaId === 'gamma-pnl' && gpData" :viewBox="`0 0 ${W} ${H}`" class="fc-svg">
      <text :x="W/2" :y="14" text-anchor="middle" class="fc-ttl">Gamma PnL · ½Γ(ΔP)²</text>
      <line :x1="PL" :x2="W-PR" :y1="sy(0)" :y2="sy(0)" stroke="var(--line)" stroke-width="1" />
      <line :x1="W/2" :x2="W/2" :y1="sy(1)" :y2="sy(0)" stroke="var(--line)" stroke-width="0.5" stroke-dasharray="3,3" />
      <!-- Parabola: ½Γx² -->
      <polyline :points="gammaCurve.value" fill="var(--green-dim)" stroke="var(--green)" stroke-width="2" />
      <!-- Current PnL marker -->
      <circle :cx="gpMarker.value?.cx ?? PL" :cy="gpMarker.value?.cy ?? sy(0)" r="4" fill="var(--ink)" />
      <text :x="(gpMarker.value?.cx ?? PL) + 6" :y="(gpMarker.value?.cy ?? sy(0)) - 4" class="fc-tick">{{ fmt(gpData.gammaPnl) }}</text>
      <text :x="W/2" :y="sy(0)+16" text-anchor="middle" class="fc-tick">ΔP=0</text>
      <text :x="W/2" :y="H-2" text-anchor="middle" class="fc-tick">{{ gpData.convexityNote }}</text>
    </svg>

    <!-- VOL CONFIDENCE -->
    <svg v-else-if="formulaId === 'vol-confidence' && vcData" :viewBox="`0 0 ${W} ${H}`" class="fc-svg">
      <text :x="W/2" :y="14" text-anchor="middle" class="fc-ttl">波动率置信 · {{ vcData.quality }} · ±{{ pctFmt(vcData.relativeUncertainty) }}</text>
      <!-- Center line -->
      <line :x1="PL" :x2="W-PR" :y1="sy(0.5)" :y2="sy(0.5)" stroke="var(--green)" stroke-width="2" />
      <text :x="PL-4" :y="sy(0.5)+4" text-anchor="end" class="fc-tick">{{ pctFmt(vcData.annualVol) }}</text>
      <!-- Confidence band -->
      <rect :x="PL+10" :y="sy(vcData.upper / (vcData.annualVol * 1.5))" :width="pw-20" :height="Math.max(2, sy(vcData.lower / (vcData.annualVol * 1.5)) - sy(vcData.upper / (vcData.annualVol * 1.5)))" fill="var(--blue-dim)" rx="2" />
      <!-- Upper bound -->
      <line :x1="PL" :x2="W-PR" :y1="sy(vcData.upper / (vcData.annualVol * 1.5))" :y2="sy(vcData.upper / (vcData.annualVol * 1.5))" stroke="var(--red)" stroke-width="1" stroke-dasharray="4,3" />
      <text :x="W-PR" :y="sy(vcData.upper / (vcData.annualVol * 1.5))-3" text-anchor="end" class="fc-tick" fill="var(--red)">{{ pctFmt(vcData.upper) }}</text>
      <!-- Lower bound -->
      <line :x1="PL" :x2="W-PR" :y1="sy(vcData.lower / (vcData.annualVol * 1.5))" :y2="sy(vcData.lower / (vcData.annualVol * 1.5))" stroke="var(--blue)" stroke-width="1" stroke-dasharray="4,3" />
      <text :x="W-PR" :y="sy(vcData.lower / (vcData.annualVol * 1.5))-3" text-anchor="end" class="fc-tick" fill="var(--blue)">{{ pctFmt(vcData.lower) }}</text>
      <text :x="W/2" :y="H-4" text-anchor="middle" class="fc-tick">n={{ vcData.sampleSize }} · SE=σ/√(2n)={{ pctFmt(vcData.se) }}</text>
    </svg>

    <!-- FALLBACK -->
    <div v-else class="fc-card">
      <span class="fc-ttl">{{ stage?.label || formulaId }}</span>
      <div class="fc-meta">{{ stage?.role || '等待数据载入' }}</div>
    </div>

    <!-- 小白指南 -->
    <div v-if="guide" class="fc-guide">
      <span class="fc-guide-title">📖 {{ guide.title }}</span>
      <p class="fc-guide-body">{{ guide.body }}</p>
    </div>

  </div>
</template>

<style>
.fc-shell { min-height: 200px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); overflow: hidden; }
.fc-svg { display: block; width: 100%; height: auto; }
.fc-ttl { font-size: 0.7rem; font-weight: 900; fill: var(--green); letter-spacing: 0.04em; color: var(--green); }
.fc-tick { font-size: 9px; fill: var(--muted); }
.fc-card { display: grid; gap: 8px; padding: 12px; }
.fc-kv { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.fc-kv div { display: grid; gap: 1px; padding: 6px 8px; border: 1px solid var(--line); border-radius: 5px; background: var(--bg); }
.fc-kv b { font-size: 0.6rem; color: var(--muted); font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; }
.fc-kv span { font-size: 0.82rem; font-weight: 800; font-variant-numeric: tabular-nums; }
.fc-gr4, .fc-gr3 { display: grid; gap: 6px; }
.fc-gr4 { grid-template-columns: repeat(4, 1fr); }
.fc-gr3 { grid-template-columns: repeat(3, 1fr); }
.fc-gi { display: grid; gap: 2px; padding: 7px; border: 1px solid var(--line); border-radius: 5px; background: var(--bg); }
.fc-gi b { font-size: 0.6rem; color: var(--muted); font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; }
.fc-gi span { font-size: 0.88rem; font-weight: 800; font-variant-numeric: tabular-nums; }
.fc-big { font-size: 1.8rem; font-weight: 900; font-variant-numeric: tabular-nums; }
.fc-meta { font-size: 0.72rem; color: var(--muted); }
.fc-ce-row { display: flex; align-items: baseline; gap: 12px; }
.fc-vol { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.fc-vol-main { display: grid; gap: 2px; padding: 16px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); text-align: center; }
.fc-vol-main small { font-size: 0.66rem; color: var(--muted); }
.fc-formulas { display: grid; gap: 4px; }
.fc-formulas code { display: block; border: 1px solid var(--line); border-radius: 4px; padding: 5px 8px; background: var(--bg); color: var(--blue); font-size: 0.74rem; white-space: nowrap; overflow: auto; }
.fc-orders { display: grid; gap: 4px; }
.fc-orow { display: flex; gap: 10px; align-items: center; padding: 6px 8px; border: 1px solid var(--line); border-radius: 5px; background: var(--bg); font-size: 0.78rem; }
.fc-orole { font-weight: 800; color: var(--green); font-size: 0.7rem; min-width: 36px; }
.fc-onotional { color: var(--muted); margin-left: auto; }
.fc-asian { display: grid; gap: 8px; }
.fc-asian-cmp { display: flex; align-items: center; gap: 10px; }
.fc-plan-wait { display: grid; gap: 8px; }
.fc-guide { margin: 0 10px 10px; border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px; background: var(--surface-alt); }
.fc-guide-title { display: block; font-size: 0.68rem; font-weight: 900; color: var(--green); margin-bottom: 4px; }
.fc-guide-body { margin: 0; font-size: 0.74rem; color: var(--ink); line-height: 1.45; }
.green { color: var(--green); }
.red { color: var(--red); }
</style>
