import { buildMarketStatePath } from '../market-data/cost.js'
import { buildFormulaPath } from '../formula-research/path/formulaPath.js'
import { buildMacroCostPath, detectStrategySignalAt } from './chartStrategySignals.js'
import { checkSpotExit, resolveMakerLadderEntry } from './makerLadderExecution.js'
import {
  ROTATION_PRESETS,
  emptyPortfolioResult,
  scoreRotationCandidate,
  summarizePortfolioRotation,
} from './portfolioRotationPresets.js'

export { ROTATION_PRESETS, scoreRotationCandidate }

/**
 * Prefix-causal Cross-Asset Capital-Recycling Portfolio Rotation Engine.
 *
 * Recycles idle cash across multiple uncorrelated instruments without lookahead:
 * - Signal observed at date d_prev close on asset k -> eligible to enter on asset k's next trading session d.
 * - Ranks simultaneous candidates by `scoreRotationCandidate`.
 * - Sizes each slot by `min(maxSlotWeight * totalEquity, riskBudgetPerSlot * totalEquity / stopDistance, cash)`.
 */
export function evaluatePortfolioRotation({
  universe = [],
  maxSlots = 5,
  riskBudgetPerSlot = 0.038,
  maxSlotWeight = 0.24,
  feeRate = 0.001,
  useMakerLadder = true,
} = {}) {
  const validAssets = (universe ?? []).filter(
    (item) => item?.symbol && Array.isArray(item.rows) && item.rows.length >= 25 && positive(item.tradingDaysPerYear),
  )
  if (!validAssets.length) return emptyPortfolioResult()

  const slotCap = Math.max(1, Math.min(10, Math.floor(Number(maxSlots) || 5)))
  const slotWeightCap = Math.max(0.1, Math.min(1, Number(maxSlotWeight) || 0.24))
  const riskBudget = Math.max(0.01, Math.min(0.1, Number(riskBudgetPerSlot) || 0.038))
  const drag = Number.isFinite(feeRate) && feeRate >= 0 && feeRate < 0.05 ? Number(feeRate) : 0.001

  const prepared = validAssets.map((asset) => {
    const tdpy = Number(asset.tradingDaysPerYear)
    const rows = asset.rows
    const states = buildMarketStatePath(rows, tdpy)
    const formulas = buildFormulaPath(rows, { tradingDaysPerYear: tdpy })
    const macroPath = buildMacroCostPath(rows)
    const indexByDate = new Map()
    rows.forEach((r, idx) => indexByDate.set(r.date, idx))
    return {
      symbol: asset.symbol,
      label: asset.label ?? asset.symbol,
      market: asset.market ?? '',
      tdpy,
      rows,
      states,
      formulas,
      macroPath,
      indexByDate,
      lastClose: rows[0].close,
      cooldownUntil: 0,
      pendingSignal: null,
    }
  })

  const dateSet = new Set()
  for (const asset of prepared) {
    for (const r of asset.rows) dateSet.add(r.date)
  }
  const allDates = [...dateSet].sort()
  if (allDates.length < 5) return emptyPortfolioResult()

  let cash = 1.0
  let peakEquity = 1.0
  let maxDrawdown = 0
  let utilizationSum = 0
  const openPositions = new Map()
  const closedTrades = []
  const equityCurve = []
  const benchmarkStart = new Map(prepared.map((a) => [a.symbol, a.rows[0].close]))

  for (let dIdx = 0; dIdx < allDates.length; dIdx += 1) {
    const date = allDates[dIdx]

    // 1. Update mark close & process exits for assets trading today
    for (const asset of prepared) {
      const barIdx = asset.indexByDate.get(date)
      if (barIdx === undefined) continue
      const row = asset.rows[barIdx]
      const market = asset.states[barIdx]
      asset.lastClose = row.close

      const pos = openPositions.get(asset.symbol)
      if (!pos) continue

      const exit = checkSpotExit(pos, row, market, barIdx)
      if (exit) {
        const exitProceeds = pos.shares * exit.exitPrice * (1 - drag * 0.5)
        const netPnl = exitProceeds - pos.investedCapital
        cash += exitProceeds
        openPositions.delete(asset.symbol)
        asset.cooldownUntil = barIdx + 1
        closedTrades.push({
          symbol: asset.symbol,
          label: asset.label,
          leg: pos.leg,
          legLabel: pos.legLabel,
          entryDate: pos.entryDate,
          exitDate: date,
          entryPrice: pos.entryPrice,
          exitPrice: exit.exitPrice,
          slotWeight: pos.slotWeight,
          heldSessions: exit.heldSessions,
          reason: exit.reason,
          rawNetReturn: netPnl / pos.investedCapital,
          portfolioContribution: netPnl / pos.portfolioEquityAtEntry,
        })
      }
    }

    // 2. Rank & fill pending T-1 signals across assets trading today
    if (openPositions.size < slotCap && cash > 0.02) {
      const candidates = []
      for (const asset of prepared) {
        if (openPositions.has(asset.symbol) || !asset.pendingSignal) continue
        const barIdx = asset.indexByDate.get(date)
        if (barIdx === undefined) continue
        if (asset.pendingSignal.signalIndex === barIdx - 1) {
          candidates.push({
            asset,
            barIdx,
            signal: asset.pendingSignal,
            score: scoreRotationCandidate(asset.pendingSignal, drag),
          })
        } else if (asset.pendingSignal.signalIndex < barIdx - 1) {
          asset.pendingSignal = null
        }
      }

      candidates.sort((a, b) => b.score - a.score)
      const currentTotalEquity = computeTotalEquity(cash, openPositions, prepared)

      for (const cand of candidates) {
        cand.asset.pendingSignal = null
        if (openPositions.size >= slotCap || cash <= 0.02 * currentTotalEquity) continue
        const filled = openPortfolioSlot({
          signal: cand.signal,
          row: cand.asset.rows[cand.barIdx],
          barIdx: cand.barIdx,
          cash,
          totalEquity: currentTotalEquity,
          riskBudget,
          slotWeightCap,
          feeRate: drag,
          useMakerLadder,
        })
        if (filled) {
          cash -= filled.investedCapital
          openPositions.set(cand.asset.symbol, filled)
        }
      }
    }

    // 3. Mark-to-market daily portfolio equity, utilization & equal-weight benchmark
    const investedValue = computeInvestedValue(openPositions, prepared)
    const totalEquity = cash + investedValue
    const utilization = totalEquity > 0 ? Math.min(1, investedValue / totalEquity) : 0
    utilizationSum += utilization
    peakEquity = Math.max(peakEquity, totalEquity)
    if (peakEquity > 0) {
      maxDrawdown = Math.min(maxDrawdown, (totalEquity - peakEquity) / peakEquity)
    }

    let benchSum = 0
    for (const asset of prepared) benchSum += asset.lastClose / benchmarkStart.get(asset.symbol)

    equityCurve.push({
      date,
      equity: totalEquity,
      benchmarkEquity: benchSum / prepared.length,
      utilization,
      activeSlots: openPositions.size,
    })

    // 4. Detect new T close signals on flat assets
    for (const asset of prepared) {
      if (openPositions.has(asset.symbol)) continue
      const barIdx = asset.indexByDate.get(date)
      if (barIdx === undefined || barIdx < asset.cooldownUntil) continue
      const bullSig = detectStrategySignalAt({
        strategyId: 'vol-breakout',
        index: barIdx,
        rows: asset.rows,
        marketStates: asset.states,
        formulaPath: asset.formulas,
        macroPath: asset.macroPath,
      })
      asset.pendingSignal =
        bullSig ??
        detectStrategySignalAt({
          strategyId: 'structural-repair',
          index: barIdx,
          rows: asset.rows,
          marketStates: asset.states,
          formulaPath: asset.formulas,
          macroPath: asset.macroPath,
        })
    }
  }

  return summarizePortfolioRotation({
    prepared,
    closedTrades,
    openPositions,
    equityCurve,
    maxDrawdown,
    avgUtilization: equityCurve.length > 0 ? utilizationSum / equityCurve.length : 0,
    maxSlots: slotCap,
    feeRate: drag,
  })
}

function openPortfolioSlot({
  signal,
  row,
  barIdx,
  cash,
  totalEquity,
  riskBudget,
  slotWeightCap,
  feeRate,
  useMakerLadder,
}) {
  if (signal.side !== 'buy') return null

  if (useMakerLadder && signal.leg === 'structural-repair') {
    const ladder = resolveMakerLadderEntry({ signal, row, index: barIdx, feeRate, riskBudget })
    if (!ladder) return null
    const riskPct = Math.max((ladder.entryPrice - ladder.stopPrice) / ladder.entryPrice, 0.012)
    const desiredWeight = Math.min(slotWeightCap, (riskBudget / riskPct) * ladder.filledLadderFraction)
    const investedCapital = Math.min(cash, totalEquity * desiredWeight)
    if (investedCapital <= 0.01 * totalEquity) return null
    return {
      ...ladder,
      investedCapital,
      portfolioEquityAtEntry: totalEquity,
      slotWeight: investedCapital / totalEquity,
      shares: (investedCapital * (1 - feeRate * 0.175)) / ladder.entryPrice,
    }
  }

  const open = positive(row?.open) ?? positive(row?.close)
  if (!open || open <= signal.stopPrice || (positive(signal.targetPrice) && open >= signal.targetPrice)) return null
  const signalRiskPct = (signal.signalClose - signal.stopPrice) / signal.signalClose
  if ((open - signal.signalClose) / signal.signalClose > Math.max(signalRiskPct * 1.25, 0.045)) return null
  const rebasedStop = Math.max(signal.stopPrice, open * (1 - Math.min(Math.max(signalRiskPct, 0.015), 0.13)))
  const risk = open - rebasedStop
  if (!(risk > 0) || (positive(signal.targetPrice) && (signal.targetPrice - open) / risk < 1.35)) return null

  const riskPct = Math.max(risk / open, 0.012)
  const desiredWeight = Math.min(slotWeightCap, riskBudget / riskPct)
  const investedCapital = Math.min(cash, totalEquity * desiredWeight)
  if (investedCapital <= 0.01 * totalEquity) return null

  return {
    ...signal,
    entryIndex: barIdx,
    entryDate: row.date,
    entryPrice: open,
    stopPrice: rebasedStop,
    ratchetTrigger: signal.trailMode === 'uncapped-cost-low-close' ? open + 2.5 * risk : signal.ratchetTrigger,
    investedCapital,
    portfolioEquityAtEntry: totalEquity,
    slotWeight: investedCapital / totalEquity,
    shares: (investedCapital * (1 - feeRate * 0.5)) / open,
    breakevenLocked: false,
    feeDrag: feeRate,
  }
}

function computeInvestedValue(openPositions, prepared) {
  let sum = 0
  for (const asset of prepared) {
    const pos = openPositions.get(asset.symbol)
    if (pos) sum += pos.shares * asset.lastClose
  }
  return sum
}

function computeTotalEquity(cash, openPositions, prepared) {
  return cash + computeInvestedValue(openPositions, prepared)
}

function positive(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}
