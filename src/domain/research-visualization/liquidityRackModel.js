import { liquidityFingerprint } from '../formulas/core.js'

const DEFAULT_VISIBLE_WINDOW = 120
const DEFAULT_BINS = 32

export function buildLiquidityRackModel({
  rows,
  costPath,
  formulaPath,
  graph,
  activeIndex,
  visibleWindow = DEFAULT_VISIBLE_WINDOW,
  binCount = DEFAULT_BINS,
}) {
  const safeRows = Array.isArray(rows) ? rows : []
  const safeCosts = Array.isArray(costPath) ? costPath : []
  const safeFormulas = Array.isArray(formulaPath) ? formulaPath : []
  if (!safeRows.length) return emptyRack()

  const index = clampIndex(activeIndex, safeRows.length)
  const activeRow = safeRows[index] ?? safeRows.at(-1)
  const activeCost = safeCosts[index] ?? safeCosts.at(-1) ?? null
  const activeFormula = safeFormulas[index] ?? safeFormulas.at(-1) ?? null
  const orders = graph?.plan?.primaryOrders ?? []
  const range = buildPriceRange({
    rows: safeRows,
    activeIndex: index,
    visibleWindow,
    activeRow,
    activeCost,
    activeFormula,
    orders,
  })
  const basis = activeCost?.anchor || activeRow?.close || graph?.inputs?.entryPrice
  if (!Number.isFinite(basis) || basis <= 0 || range.upper <= range.lower) return emptyRack(range)

  const count = normalizeBinCount(binCount)
  const fingerprint = liquidityFingerprint({
    entryPrice: basis,
    priceGrid: Math.max(240, count * 8),
    distribution: 'log-laplace',
    lowerFactor: Math.max(0.05, range.lower / basis),
    upperFactor: Math.min(20, range.upper / basis),
    lambda: 2,
    kappa: 1,
  })
  const shelves = buildShelves({ range, fingerprint, orders, activePrice: activeRow?.close, binCount: count })
  const markers = [
    buildMarker('现价', activeRow?.close, 'price', range),
    buildMarker('成本', activeCost?.anchor, 'cost', range),
    buildMarker('Δ上', activeFormula?.deltaUpper, 'upper', range),
    buildMarker('Δ下', activeFormula?.deltaLower, 'lower', range),
  ].filter(Boolean)
  const orderTicks = orders
    .filter((order) => Number.isFinite(order.price) && order.price > 0)
    .map((order) => ({
      side: order.side,
      role: order.role,
      price: order.price,
      notional: order.notional,
      y: priceToY(order.price, range),
      width: scale(order.notional, Math.max(...orders.map((o) => o.notional || 0), 1), 18, 100),
    }))

  return {
    meta: buildMeta({ orders }),
    range,
    basis,
    binCount: count,
    priceStep: (range.upper - range.lower) / count,
    ticks: buildPriceTicks(range),
    shelves,
    markers,
    orderTicks,
    stats: buildStats({ shelves, orders, activePrice: activeRow?.close }),
  }
}

function buildPriceRange({ rows, activeIndex, visibleWindow, activeRow, activeCost, activeFormula, orders }) {
  const end = Math.max(0, activeIndex) + 1
  const windowRows = rows.slice(Math.max(0, end - visibleWindow), end)
  const prices = windowRows.flatMap((row) => [row.high, row.low, row.close])
  prices.push(activeCost?.lower, activeCost?.upper, activeCost?.anchor)
  prices.push(activeFormula?.deltaLower, activeFormula?.deltaUpper)
  for (const order of orders) prices.push(order.price)

  const finite = prices.filter((value) => Number.isFinite(value) && value > 0)
  const fallback = activeRow?.close ?? 1
  if (!finite.length) return { lower: fallback * 0.9, upper: fallback * 1.1 }
  const min = Math.min(...finite)
  const max = Math.max(...finite)
  const pad = Math.max((max - min) * 0.1, fallback * 0.018)
  return { lower: Math.max(0.0001, min - pad), upper: max + pad }
}

function buildShelves({ range, fingerprint, orders, activePrice, binCount }) {
  const count = normalizeBinCount(binCount)
  const step = (range.upper - range.lower) / count
  const bins = Array.from({ length: count }, (_, i) => {
    const lower = range.lower + step * i
    const upper = lower + step
    const mid = (lower + upper) / 2
    return { lower, upper, mid, density: 0, buyNotional: 0, sellNotional: 0 }
  })

  for (const point of fingerprint?.prices ?? []) {
    const idx = binIndex(point.price, range, count)
    if (idx >= 0) bins[idx].density += point.density
  }
  for (const order of orders) {
    const idx = binIndex(order.price, range, count)
    if (idx < 0) continue
    if (order.side === 'sell') bins[idx].sellNotional += order.notional || 0
    else bins[idx].buyNotional += order.notional || 0
  }

  const maxDensity = Math.max(...bins.map((bin) => bin.density), 0.001)
  const maxOrder = Math.max(...bins.map((bin) => Math.max(bin.buyNotional, bin.sellNotional)), 1)
  const totalDensity = bins.reduce((sum, bin) => sum + bin.density, 0)
  return bins.reverse().map((bin) => {
    const top = priceToY(bin.upper, range)
    const bottom = priceToY(bin.lower, range)
    const densityWidth = scale(bin.density, maxDensity, 6, 100)
    const buyWidth = scale(bin.buyNotional, maxOrder, 0, 100)
    const sellWidth = scale(bin.sellNotional, maxOrder, 0, 100)
    const side = Number.isFinite(activePrice) && bin.mid < activePrice ? 'bid' : 'ask'
    const intensity = Math.max(bin.density / maxDensity, bin.buyNotional / maxOrder, bin.sellNotional / maxOrder)
    return {
      ...bin,
      side,
      top,
      bottom,
      height: Math.max(1.4, bottom - top),
      densityWidth,
      buyWidth,
      sellWidth,
      intensity,
      densityShare: totalDensity > 0 ? bin.density / totalDensity : 0,
      netNotional: bin.buyNotional - bin.sellNotional,
    }
  })
}

function buildMarker(label, price, tone, range) {
  if (!Number.isFinite(price) || price <= 0) return null
  return { label, price, tone, y: priceToY(price, range) }
}

function buildStats({ shelves, orders, activePrice }) {
  const peak = Math.max(...shelves.map((shelf) => shelf.intensity), 0)
  const below = shelves.filter((shelf) => Number.isFinite(activePrice) && shelf.mid < activePrice)
    .reduce((sum, shelf) => sum + shelf.density, 0)
  const above = shelves.filter((shelf) => Number.isFinite(activePrice) && shelf.mid >= activePrice)
    .reduce((sum, shelf) => sum + shelf.density, 0)
  const total = below + above
  return {
    peakWeight: peak,
    orderCount: orders.length,
    belowShare: total > 0 ? below / total : 0,
    aboveShare: total > 0 ? above / total : 0,
  }
}

function buildMeta({ orders }) {
  return {
    title: '模型目标仓',
    sourceLabel: 'OHLCV 成本锚 + log-Laplace 目标分布 + 本策略挂单',
    compositionLabel: '不是市场盘口，也不是链上真实 LP 构成',
    orderLabel: orders.length ? '挂单刻度来自模拟挂单' : '当前未生成模拟挂单',
    purpose: [
      '把目标风险密度离散成价格层级，观察挂单是否落在合理密度区。',
      '辅助订单流视角看成本、现价、Delta 带和计划挂单的相对位置。',
      '只做研究层解释，不参与默认挂单结论。',
    ],
    layers: [
      { label: '密度', value: '模型目标 LP 分布', note: '由成本锚附近的 log-Laplace 分布生成' },
      { label: 'BID/ASK', value: '相对现价分侧', note: '低于现价归 BID，高于现价归 ASK' },
      { label: '挂单', value: '我们的模拟刻度', note: '来自模拟挂单，不是市场订单簿' },
    ],
    missing: [
      '真实池子 tick / liquidityGross / liquidityNet',
      '手续费层级、tick spacing、区块时间',
      '真实钱包 LP NFT 区间和本金',
      '盘口深度、成交队列、撤单行为',
    ],
  }
}

function binIndex(price, range, count) {
  if (!Number.isFinite(price) || price < range.lower || price > range.upper) return -1
  return Math.min(count - 1, Math.max(0, Math.floor(((price - range.lower) / (range.upper - range.lower)) * count)))
}

function buildPriceTicks(range) {
  const steps = 5
  return Array.from({ length: steps }, (_, i) => {
    const price = range.upper - ((range.upper - range.lower) * i) / (steps - 1)
    return { price, y: priceToY(price, range) }
  })
}

function priceToY(price, range) {
  if (!Number.isFinite(price) || range.upper <= range.lower) return 50
  return Math.max(1, Math.min(99, ((range.upper - price) / (range.upper - range.lower)) * 100))
}

function scale(value, max, min, maxOut) {
  if (!Number.isFinite(value) || value <= 0 || max <= 0) return min
  return Math.min(maxOut, Math.max(min, (value / max) * maxOut))
}

function clampIndex(index, length) {
  if (!Number.isFinite(index)) return Math.max(0, length - 1)
  return Math.max(0, Math.min(length - 1, Math.round(index)))
}

function normalizeBinCount(binCount) {
  return Math.max(12, Math.min(120, Math.round(Number(binCount) || DEFAULT_BINS)))
}

function emptyRack(range = { lower: null, upper: null }) {
  return { meta: buildMeta({ orders: [] }), range, basis: null, binCount: 0, priceStep: null, ticks: [], shelves: [], markers: [], orderTicks: [], stats: { peakWeight: 0, orderCount: 0, belowShare: 0, aboveShare: 0 } }
}
