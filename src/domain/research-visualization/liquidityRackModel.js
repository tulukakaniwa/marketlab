import { liquidityFingerprint } from '../formulas/core.js'
import { buildLiquidityOpportunity } from './liquidityOpportunity.js'

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
  viewMode = 'compare',
  gapMode = 'shortfall',
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
  const mode = normalizeViewMode(viewMode)
  const normalizedGapMode = normalizeGapMode(gapMode)
  const fingerprint = liquidityFingerprint({
    entryPrice: basis,
    priceGrid: Math.max(240, count * 8),
    distribution: 'log-laplace',
    lowerFactor: Math.max(0.05, range.lower / basis),
    upperFactor: Math.min(20, range.upper / basis),
    activePrice: activeRow?.close,
    costAnchor: activeCost?.anchor,
    targetRange: {
      lower: activeFormula?.deltaLower ?? activeCost?.lower,
      upper: activeFormula?.deltaUpper ?? activeCost?.upper,
    },
    orderLevels: orders,
    volatility: graph?.inputs?.iv ?? graph?.market?.annualVol,
    lambda: 2,
    kappa: 1,
  })
  const realProfile = buildRealPoolProfile({ range, lpOnchain: graph?.lpOnchain, binCount: count })
  const effectiveViewMode = realProfile.hasSignal ? mode : 'simulate'
  const shelves = buildShelves({
    range,
    fingerprint,
    realProfile,
    orders,
    activePrice: activeRow?.close,
    binCount: count,
    viewMode: effectiveViewMode,
    gapMode: normalizedGapMode,
  })
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
  const opportunity = buildLiquidityOpportunity({
    shelves,
    activePrice: activeRow?.close,
    hasRealSignal: realProfile.hasSignal,
  })

  return {
    meta: buildMeta({ orders, fingerprint, lpOnchain: graph?.lpOnchain, viewMode: mode, gapMode: normalizedGapMode, hasRealSignal: realProfile.hasSignal }),
    viewMode: mode,
    effectiveViewMode,
    gapMode: normalizedGapMode,
    gapModeLabel: gapModeLabel(normalizedGapMode),
    viewLabel: viewModeLabel(mode, realProfile.hasSignal),
    shareLabel: shareLabel(mode, realProfile.hasSignal, normalizedGapMode),
    range,
    basis,
    binCount: count,
    priceStep: (range.upper - range.lower) / count,
    ticks: buildPriceTicks(range),
    shelves,
    markers,
    orderTicks,
    opportunity,
    stats: buildStats({ shelves, orders, activePrice: activeRow?.close }),
    fingerprintStats: fingerprint?.stats ?? null,
    components: fingerprint?.components ?? [],
    realProfile,
    hasRealSignal: realProfile.hasSignal,
    status: fingerprint?.status ?? 'research-only',
    inputMode: fingerprint?.inputMode ?? 'model-only',
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

function buildShelves({ range, fingerprint, realProfile, orders, activePrice, binCount, viewMode, gapMode }) {
  const count = normalizeBinCount(binCount)
  const step = (range.upper - range.lower) / count
  const bins = Array.from({ length: count }, (_, i) => {
    const lower = range.lower + step * i
    const upper = lower + step
    const mid = (lower + upper) / 2
    return { lower, upper, mid, density: 0, baseDensity: 0, activeDensity: 0, costDensity: 0, orderDensity: 0, rangeDensity: 0, buyNotional: 0, sellNotional: 0 }
  })

  for (const point of fingerprint?.prices ?? []) {
    const idx = binIndex(point.price, range, count)
    if (idx >= 0) {
      bins[idx].density += point.density
      bins[idx].baseDensity += point.baseDensity ?? 0
      bins[idx].activeDensity += point.activeDensity ?? 0
      bins[idx].costDensity += point.costDensity ?? 0
      bins[idx].orderDensity += point.orderDensity ?? 0
      bins[idx].rangeDensity += point.rangeDensity ?? 0
    }
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
  const realWeights = realProfile?.weights ?? []
  const maxModelShare = Math.max(...bins.map((bin) => totalDensity > 0 ? bin.density / totalDensity : 0), 0.001)
  const maxRealShare = Math.max(...realWeights, 0.001)
  const displayShares = bins.map((bin, i) => displayShare({
    modelShare: totalDensity > 0 ? bin.density / totalDensity : 0,
    realShare: realWeights[i] ?? 0,
    viewMode,
    gapMode,
    hasReal: Boolean(realProfile?.hasSignal),
  }))
  const maxDisplayShare = Math.max(...displayShares, 0.001)
  return bins.reverse().map((bin) => {
    const originalIndex = Math.min(count - 1, Math.max(0, Math.round((bin.lower - range.lower) / step)))
    const modelShare = totalDensity > 0 ? bin.density / totalDensity : 0
    const realShare = realWeights[originalIndex] ?? 0
    const signedGap = modelShare - realShare
    const gapShare = computeGapShare({ modelShare, realShare, gapMode })
    const visibleShare = displayShare({ modelShare, realShare, viewMode, gapMode, hasReal: Boolean(realProfile?.hasSignal) })
    const top = priceToY(bin.upper, range)
    const bottom = priceToY(bin.lower, range)
    const densityWidth = scale(visibleShare, maxDisplayShare, 6, 100)
    const buyWidth = scale(bin.buyNotional, maxOrder, 0, 100)
    const sellWidth = scale(bin.sellNotional, maxOrder, 0, 100)
    const side = Number.isFinite(activePrice) && bin.mid < activePrice ? 'bid' : 'ask'
    const intensity = Math.max(visibleShare / maxDisplayShare, bin.buyNotional / maxOrder, bin.sellNotional / maxOrder)
    const componentShare = {
      base: bin.density > 0 ? bin.baseDensity / bin.density : 0,
      active: bin.density > 0 ? bin.activeDensity / bin.density : 0,
      cost: bin.density > 0 ? bin.costDensity / bin.density : 0,
      orders: bin.density > 0 ? bin.orderDensity / bin.density : 0,
      range: bin.density > 0 ? bin.rangeDensity / bin.density : 0,
    }
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
      densityShare: visibleShare,
      modelShare,
      realShare,
      realGap: signedGap,
      gapShare,
      gapMagnitude: Math.abs(signedGap),
      gapDirection: signedGap >= 0 ? 'shortfall' : 'crowded',
      modelWidth: scale(modelShare, maxModelShare, 0, 100),
      realWidth: scale(realShare, maxRealShare, 0, 100),
      componentShare,
      dominantComponent: dominantShelfComponent({ viewMode, gapMode, signedGap, realShare, componentShare }),
      netNotional: bin.buyNotional - bin.sellNotional,
    }
  })
}

function buildRealPoolProfile({ range, lpOnchain, binCount }) {
  const pool = lpOnchain?.pool ?? null
  const routes = normalizeQuoteRoutes(lpOnchain)
  const activeRoutes = routes.filter((route) => route.quotePrice >= range.lower && route.quotePrice <= range.upper)
  if (!activeRoutes.length) {
    return {
      hasSignal: false,
      pool,
      pools: lpOnchain?.pools ?? [],
      routes,
      quotePrice: routes[0]?.quotePrice ?? null,
      weights: Array.from({ length: normalizeBinCount(binCount) }, () => 0),
    }
  }
  const count = normalizeBinCount(binCount)
  const step = (range.upper - range.lower) / count
  const routeWeightTotal = activeRoutes.reduce((sum, route) => sum + route.weight, 0) || activeRoutes.length
  const raw = Array.from({ length: count }, (_, i) => {
    const lower = range.lower + step * i
    const upper = lower + step
    const mid = (lower + upper) / 2
    return activeRoutes.reduce((sum, route) => {
      const distance = Math.log(mid / route.quotePrice)
      const routeShare = routeWeightTotal > 0 ? route.weight / routeWeightTotal : 1 / activeRoutes.length
      return sum + Math.exp(-0.5 * Math.pow(distance / route.sigmaLog, 2)) * routeShare
    }, 0)
  })
  const total = raw.reduce((sum, value) => sum + value, 0)
  return {
    hasSignal: total > 0,
    pool,
    pools: lpOnchain?.pools ?? [],
    routes,
    quotePrice: activeRoutes[0]?.quotePrice ?? null,
    quoteSymbol: activeRoutes[0]?.quoteSymbol ?? lpOnchain?.quoteSymbol ?? null,
    liquidity: pool?.liquidity ?? null,
    blockNumber: lpOnchain?.blockNumber ?? null,
    coverage: lpOnchain?.poolCoverage ?? null,
    weights: total > 0 ? raw.map((value) => value / total) : raw,
  }
}

function normalizeQuoteRoutes(lpOnchain) {
  const routes = Array.isArray(lpOnchain?.quoteRoutes) && lpOnchain.quoteRoutes.length
    ? lpOnchain.quoteRoutes
    : [{ quoteSymbol: lpOnchain?.quoteSymbol, quotePrice: lpOnchain?.quotePrice, pools: [lpOnchain?.pool].filter(Boolean) }]
  return routes
    .map((route) => {
      const pools = Array.isArray(route.pools) ? route.pools : []
      const tickSpacing = Math.max(...pools.map((item) => Number(item?.tickSpacing) || 1), 1)
      const reserveUsd = pools.reduce((sum, pool) => sum + (Number(pool.reserveUsd) || 0), 0)
      return {
        ...route,
        quotePrice: Number(route.quotePrice),
        weight: Math.max(0.0001, Number(route.weight) || Math.log10(reserveUsd + 1) || 1),
        sigmaLog: Math.max(0.004, Math.min(0.08, Math.pow(1.0001, tickSpacing * 20) - 1)),
      }
    })
    .filter((route) => Number.isFinite(route.quotePrice) && route.quotePrice > 0)
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

function buildMeta({ orders, fingerprint = null, lpOnchain = null, viewMode = 'compare', gapMode = 'shortfall', hasRealSignal = false }) {
  const lpMode = lpOnchain?.inputMode ?? 'fallback'
  const pool = lpOnchain?.pool ?? null
  const coverage = lpOnchain?.poolCoverage ?? {}
  const routeCount = coverage.routeCount ?? (Array.isArray(lpOnchain?.quoteRoutes) ? lpOnchain.quoteRoutes.length : 0)
  const poolCount = coverage.poolCount ?? (Array.isArray(lpOnchain?.pools) ? lpOnchain.pools.length : 0)
  const quoteLabel = Array.isArray(coverage.quoteSymbols) && coverage.quoteSymbols.length ? coverage.quoteSymbols.join('+') : '稳定币'
  const poolLabel = poolCount > 1 ? `${poolCount} 个池 / ${routeCount} 条 ${quoteLabel} 路径` : pool?.label
  const reserveLabel = coverage.reserveUsd ? `，蓄水 ${compactUsd(coverage.reserveUsd)}` : ''
  const volumeLabel = coverage.volumeUsd24h ? `，24h ${compactUsd(coverage.volumeUsd24h)}` : ''
  const nextInputs = [
    lpMode === 'fallback' ? '接入匹配的池级聚合快照' : null,
    '补充 tick 分布 / liquidityGross / liquidityNet 或区间深度',
    lpMode === 'real' ? null : '接入钱包 Position NFT 区间和本金',
    '补充 1inch/订单簿路径、成交队列、撤单行为',
  ].filter(Boolean)
  const realPending = !hasRealSignal && viewMode !== 'simulate'
  return {
    title: realPending ? '真实层待匹配' : viewMode === 'real' ? '链上池状态' : viewMode === 'simulate' ? '模拟目标仓' : viewMode === 'gap' ? `目标仓${gapModeLabel(gapMode)}` : '目标仓 × 池状态',
    sourceLabel: fingerprint?.inputMode === 'hybrid-model'
      ? 'OHLCV 成本锚 + 现价/成本/区间/挂单成分 + log-Laplace 底层分布'
      : 'OHLCV 成本锚 + log-Laplace 目标分布',
    compositionLabel: realPending
      ? '未匹配链上池，暂显示模型目标仓'
      : viewMode === 'real'
      ? '链上池级快照用于校准当前状态'
      : viewMode === 'simulate'
        ? '模拟目标仓表达策略意图'
        : viewMode === 'gap'
        ? `模型目标仓减真实池状态的${gapModeLabel(gapMode)}视图`
        : '模拟目标仓和真实池状态并排对照',
    dataLabel: lpMode === 'real'
      ? '真实 Position NFT 已接入，可直接对照策略目标'
      : lpMode === 'pool-real'
        ? `${poolLabel ?? '聚合池快照'} 已接入${reserveLabel}${volumeLabel}，可校准模型目标仓`
        : '未匹配链上池级快照，当前只显示模型目标仓参考',
    orderLabel: orders.length ? '挂单刻度来自模拟挂单' : '当前未生成模拟挂单',
    purpose: [
      '把目标风险密度离散成价格层级，观察挂单是否落在合理密度区。',
      '辅助订单流视角看成本、现价、Delta 带和计划挂单的相对位置。',
      '研究层可以切换真实、模拟、对照和缺口，不反向改写默认挂单结论。',
    ],
    layers: [
      { label: '密度', value: '模型目标 LP 分布', note: '由底层分布、成本锚、现价、区间和模拟挂单混合生成' },
      { label: '链上', value: lpMode === 'pool-real' ? '聚合池路由' : lpMode === 'real' ? 'Position 快照' : '待匹配', note: poolLabel ?? '可作为校准层，不替代策略目标' },
      { label: 'BID/ASK', value: '相对现价分侧', note: '低于现价归 BID，高于现价归 ASK' },
      { label: '挂单', value: '我们的模拟刻度', note: '来自模拟挂单，不是市场订单簿' },
    ],
    nextInputs,
    missing: nextInputs,
    lpMode,
    lpModeLabel: lpMode === 'real' ? 'Position' : lpMode === 'pool-real' ? '聚合池' : '待匹配',
    hasRealSignal,
  }
}

function compactUsd(value) {
  if (!Number.isFinite(value) || value <= 0) return '-'
  if (value >= 100000000) return `$${(value / 100000000).toFixed(1)}亿`
  if (value >= 10000) return `$${(value / 10000).toFixed(0)}万`
  return `$${value.toFixed(0)}`
}

function displayShare({ modelShare, realShare, viewMode, gapMode, hasReal }) {
  if (viewMode === 'real') return hasReal ? realShare : modelShare
  if (viewMode === 'compare') return modelShare
  if (viewMode === 'gap') return hasReal ? Math.abs(computeGapShare({ modelShare, realShare, gapMode })) : modelShare
  return modelShare
}

function computeGapShare({ modelShare, realShare, gapMode }) {
  const signed = modelShare - realShare
  if (gapMode === 'signed') return signed
  if (gapMode === 'absolute') return Math.abs(signed)
  return Math.max(signed, 0)
}

function normalizeViewMode(mode) {
  return ['simulate', 'real', 'compare', 'gap'].includes(mode) ? mode : 'compare'
}

function normalizeGapMode(mode) {
  return ['shortfall', 'signed', 'absolute'].includes(mode) ? mode : 'shortfall'
}

function viewModeLabel(mode, hasRealSignal = true) {
  if (!hasRealSignal && mode !== 'simulate') return `${({ real: '真实', compare: '对照', gap: '缺口' })[mode] ?? '对照'}待接入`
  return ({ simulate: '模拟', real: '真实', compare: '对照', gap: '缺口' })[mode] ?? '对照'
}

function shareLabel(mode, hasRealSignal = true, gapMode = 'shortfall') {
  if (!hasRealSignal) return '模型权重'
  return ({ simulate: '模型权重', real: '池状态信号', compare: '模型 / 真实', gap: gapModeLabel(gapMode) })[mode] ?? '模型 / 真实'
}

function gapModeLabel(mode) {
  return ({ shortfall: '缺口', signed: '偏差', absolute: '反差' })[mode] ?? '缺口'
}

function dominantShelfComponent({ viewMode, gapMode, signedGap, realShare, componentShare }) {
  if (viewMode === 'real' && realShare > 0) return 'real'
  if (viewMode === 'gap') {
    if (gapMode === 'signed' && signedGap < 0) return 'real'
    if (Math.abs(signedGap) > 0) return 'gap'
  }
  return dominantComponent(componentShare)
}

function dominantComponent(componentShare) {
  return Object.entries(componentShare)
    .reduce((best, [key, value]) => value > best.value ? { key, value } : best, { key: 'base', value: -Infinity })
    .key
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
  return {
    meta: buildMeta({ orders: [], lpOnchain: null, viewMode: 'compare' }),
    viewMode: 'compare',
    effectiveViewMode: 'simulate',
    gapMode: 'shortfall',
    gapModeLabel: gapModeLabel('shortfall'),
    viewLabel: viewModeLabel('compare', false),
    shareLabel: shareLabel('compare', false),
    range,
    basis: null,
    binCount: 0,
    priceStep: null,
    ticks: [],
    shelves: [],
    markers: [],
    orderTicks: [],
    opportunity: buildLiquidityOpportunity(),
    stats: { peakWeight: 0, orderCount: 0, belowShare: 0, aboveShare: 0 },
    fingerprintStats: null,
    components: [],
    realProfile: { hasSignal: false, pool: null, quotePrice: null, weights: [] },
    hasRealSignal: false,
    status: 'research-only',
    inputMode: 'model-only',
  }
}
