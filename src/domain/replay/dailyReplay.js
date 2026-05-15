import { buildMarketStatePath } from '../market/cost.js'
import { buildDecisionGraph, resolveExecutableProfile, resolveProfile } from '../planning/orderPlan.js'

function warmupDays(totalRows) { return Math.min(80, Math.max(20, Math.floor(totalRows * 0.03))) }

export function buildDailyReplay(rows, input, marketStates = null) {
  if (!Array.isArray(rows) || rows.length < 30) return emptyReplay()
  const WARMUP = warmupDays(rows.length)
  if (rows.length <= WARMUP + 2) return emptyReplay()
  const tdpy = Number(input.tradingDaysPerYear) || 365
  const capital = Math.max(Number(input.capital) || 10000, 0)
  const initialBaseNotional = Math.max(Number(input.baseNotional) || 0, 0)
  const initialPrice = rows[WARMUP]?.close ?? rows[0]?.close ?? 0
  const accountCapital = capital + initialBaseNotional
  const fee = feeRate(input)
  const profile = resolveProfile(input.strategyProfile)
  // 优先复用外部传入的 market states，避免重复计算。
  // 当未传入或长度不一致时回退到内部计算（与外部 tdpy 保持一致）。
  const states = (Array.isArray(marketStates) && marketStates.length === rows.length)
    ? marketStates
    : buildMarketStatePath(rows, tdpy)
  const events = []
  const equityCurve = []
  let cash = capital
  let base = initialPrice > 0 ? initialBaseNotional / initialPrice : 0
  let costBasis = initialBaseNotional
  let nextSignalIndex = WARMUP

  for (let index = WARMUP; index < rows.length - 1; index += 1) {
    const row = rows[index]
    const market = states[index]
    const executableProfile = resolveExecutableProfile(profile.id, market)
    const accountAction = accountExit({ row, index, market, cash, base, costBasis, fee, profile: executableProfile })
    if (accountAction) {
      cash = accountAction.cash
      base = accountAction.base
      costBasis = accountAction.costBasis
      events.push(accountAction.event)
      nextSignalIndex = index + executableProfile.buyCooldown
    }
    const equity = cash + base * row.close
    equityCurve.push({ date: row.date, equity: equity - accountCapital })
    if (index < nextSignalIndex) continue

    const graph = buildDecisionGraph({
      market,
      input: replayInput(input, market, executableProfile),
      account: { cash, base, costBasis },
    })
    const order = chooseAccountOrder(graph, { cash, base, markPrice: row.close })
    if (!order) continue

    const fill = findFill({ rows, signalIndex: index, order, holdingDays: graph.inputs.holdingDays })
    if (!fill) continue

    if (order.side === 'buy') {
      const spend = Math.min(order.notional, cash)
      if (spend <= 0) continue
      const acquired = (spend * (1 - fee)) / fill.price
      cash -= spend
      base += acquired
      costBasis += spend
      events.push(eventRow({
        order,
        signalDate: row.date,
        fill,
        pnl: 0,
        reason: '建仓',
        notional: spend,
        baseAmount: acquired,
        investedCost: spend,
      }))
    } else {
      const sellBase = Math.min(base, order.notional / fill.price)
      if (sellBase <= 0) continue
      const averageCost = base > 0 ? costBasis / base : 0
      const proceeds = sellBase * fill.price * (1 - fee)
      const removedCost = averageCost * sellBase
      cash += proceeds
      base -= sellBase
      costBasis = Math.max(0, costBasis - removedCost)
      if (base < 1e-12) {
        base = 0
        costBasis = 0
      }
      events.push(eventRow({
        order,
        signalDate: row.date,
        fill,
        pnl: proceeds - removedCost,
        reason: '减仓',
        notional: sellBase * fill.price,
        baseAmount: sellBase,
        investedCost: removedCost,
      }))
    }
    nextSignalIndex = fill.index + (order.side === 'buy' ? executableProfile.buyCooldown : executableProfile.sellCooldown)
  }

  const last = rows.at(-1)
  const finalEquity = cash + base * last.close
  equityCurve.push({ date: last.date, equity: finalEquity - accountCapital })
  return summarize({ rows, events, equityCurve, cash, base, costBasis, capital: accountCapital, profile })
}

function accountExit({ row, index, market, cash, base, costBasis, fee, profile }) {
  if (base <= 0) return null
  const averageCost = costBasis / base
  const profitThreshold = Math.max(market.atrPercent * profile.takeProfitAtr, profile.takeProfitMin)
  const minProfitPrice = averageCost * (1 + profitThreshold)
  const regressionPrice = market.costAnchor > averageCost ? market.costAnchor : Infinity
  const target = Math.min(minProfitPrice, regressionPrice)
  if (row.high >= target) {
    return closeAccountPosition({
      row,
      index,
      cash,
      base,
      costBasis,
      fee,
      price: target,
      reason: '回到成本',
    })
  }
  const cutMomentum = Math.max(market.atrPercent * profile.cutMomentumAtr, profile.cutMomentumMin)
  if (row.close < market.costLow && market.momentum5 < -cutMomentum) {
    return closeAccountPosition({
      row,
      index,
      cash,
      base,
      costBasis,
      fee,
      price: row.close,
      reason: '风控',
    })
  }
  return null
}

function closeAccountPosition({ row, index, cash, base, costBasis, fee, price, reason }) {
  const sellBase = base
  const averageCost = costBasis / base
  const proceeds = sellBase * price * (1 - fee)
  return {
    cash: cash + proceeds,
    base: 0,
    costBasis: 0,
    event: {
      side: 'sell',
      signalDate: null,
      fillDate: row.date,
      exitDate: row.date,
      exitIndex: index,
      fillPrice: price,
      exitPrice: price,
      notional: sellBase * price,
      baseAmount: sellBase,
      pnl: proceeds - averageCost * sellBase,
      returnRate: averageCost > 0 ? (price - averageCost) / averageCost : 0,
      reason,
    },
  }
}

function replayInput(input, market, profile) {
  return {
    ...input,
    strategyProfile: profile.id,
    entryPrice: market.markPrice,
    iv: market.annualVol,
    strikePrice: market.markPrice * 1.05,
    startPrice: market.costAnchor,
    perpTwap: market.markPrice,
    spotTwap: market.markPrice,
  }
}

function chooseAccountOrder(graph, account) {
  const order = graph.plan.primaryOrders[0]
  if (!order) return null
  if (order.side === 'buy' && account.cash > 0) return order
  if (order.side === 'sell' && account.base * account.markPrice > 0) return order
  return null
}

function findFill({ rows, signalIndex, order, holdingDays }) {
  const horizon = Math.min(rows.length - 1, signalIndex + Math.max(holdingDays, 1))
  for (let index = signalIndex + 1; index <= horizon; index += 1) {
    const row = rows[index]
    if (order.side === 'buy' && row.low <= order.price) return { index, date: row.date, price: order.price }
    if (order.side === 'sell' && row.high >= order.price) return { index, date: row.date, price: order.price }
  }
  return null
}

function eventRow({ order, signalDate, fill, pnl, reason, notional, baseAmount, investedCost }) {
  return {
    side: order.side,
    signalDate,
    fillDate: fill.date,
    exitDate: fill.date,
    exitIndex: fill.index,
    fillPrice: fill.price,
    exitPrice: fill.price,
    notional,
    baseAmount,
    pnl,
    returnRate: investedCost > 0 ? pnl / investedCost : 0,
    reason,
  }
}

function summarize({ rows, events, equityCurve, cash, base, costBasis, capital, profile }) {
  let peak = 0
  let maxDrawdown = 0
  for (const point of equityCurve) {
    peak = Math.max(peak, point.equity)
    maxDrawdown = Math.min(maxDrawdown, point.equity - peak)
  }
  const realized = events.filter((event) => event.side === 'sell')
  const wins = realized.filter((event) => event.pnl > 0).length
  const totalPnl = equityCurve.at(-1)?.equity ?? 0
  const totalNotional = events.reduce((sum, event) => sum + event.notional, 0)
  const lastClose = rows.at(-1)?.close ?? 0
  return {
    profileId: profile.id,
    profileLabel: profile.label,
    range: rows.length ? `${rows[0].date} ~ ${rows.at(-1).date}` : '',
    trades: events,
    equityCurve,
    tradeCount: events.length,
    winRate: realized.length ? wins / realized.length : 0,
    totalPnl,
    realizedPnl: realized.reduce((sum, event) => sum + event.pnl, 0),
    totalNotional,
    returnOnUsedNotional: capital > 0 ? totalPnl / capital : 0,
    maxDrawdown,
    cash,
    base,
    openValue: base * lastClose,
    openCost: costBasis,
  }
}

function feeRate(input) {
  const value = Number(input.replayFeeRate)
  return Number.isFinite(value) && value >= 0 ? value : 0.001
}

function emptyReplay() {
  return {
    profileId: '',
    profileLabel: '',
    range: '',
    trades: [],
    equityCurve: [],
    tradeCount: 0,
    winRate: 0,
    totalPnl: 0,
    realizedPnl: 0,
    totalNotional: 0,
    returnOnUsedNotional: 0,
    maxDrawdown: 0,
    cash: 0,
    base: 0,
    openValue: 0,
    openCost: 0,
  }
}
