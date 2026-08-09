import {
  blackScholes,
  capitalEfficiency,
  deriveRecoveryHorizon,
  fullRangeV2ImpermanentLoss,
  estimateCumulativeFundingProxy,
  getDeltaBands,
  meanReversionHalfLife,
  netCarry,
  rangeV3ImpermanentLoss,
  resolveArithmeticRangeSpec,
  resolveDeltaSlope,
  uniswapV3Inventory,
} from '../formulas/core.js'
import { buildCostPath, deriveWindows } from './cost.js'
import { buildLpDataState } from './lpOnchain.js'
import { lpPoolCoverageMetrics } from './lpPoolMetrics.js'
import { resolveExplicitScenarioHorizonSessions } from './formulaPathScenarioInput.js'
export { FORMULA_PATH_CURVES, FORMULA_PATH_FIELDS } from './formulaPathFields.js'

export function buildFormulaPath(rows, input = {}) {
  if (!Array.isArray(rows) || rows.length < 2) return []
  const costPath = buildCostPath(rows)
  const costDistancePath = costPath.map((cost, index) =>
    cost?.anchor > 0 && rows[index]?.close > 0 ? (rows[index].close - cost.anchor) / cost.anchor : null,
  )
  const tdpy = positive(input.tradingDaysPerYear)
  return rows.map((row, index) => {
    const windows = deriveWindows(index + 1)
    const observedIv = rollingAnnualVol(rows, index, tdpy, windows.vol)
    const scenarioIv = input.pathUsesScenarioInputs ? positive(input.iv) : null
    const iv = positive(observedIv) ?? scenarioIv
    const bandAnchor = costPath[index]?.anchor || row.close
    const horizon = resolveFormulaHorizon({ rows, index, costPath, costDistancePath, input, tdpy })
    const formulaHorizonSessions = horizon?.eligible ? horizon.modelHorizonSessions : null
    const horizonAvailability = classifyHorizonAvailability(horizon)
    const horizonState = fieldState({
      source: 'dynamic-holding-state',
      status: horizonAvailability.status,
      inputMode: horizon?.mode ?? 'formula-derived',
      missingInputs: horizonAvailability.missingInputs,
      blockedReasons: horizonAvailability.blockedReasons,
      isSynthetic: true,
      context: horizon ?? null,
    })
    const deltaSlope = resolveDeltaSlope(input)
    const deltaBands = formulaHorizonSessions
      ? getDeltaBands({
          entryPrice: bandAnchor,
          formulaHorizonSessions,
          iv,
          deltaSlope,
          tradingDaysPerYear: tdpy,
        })
      : null
    const deltaAvailability = classifyDeltaAvailability({
      deltaBands,
      horizonAvailability,
      iv,
      tdpy,
      deltaSlope,
    })
    const deltaState = fieldState({
      source: 'delta-band',
      status: deltaAvailability.status,
      inputMode: horizon?.mode ?? 'formula-derived',
      missingInputs: deltaAvailability.missingInputs,
      blockedReasons: deltaAvailability.blockedReasons,
      isSynthetic: true,
      context: { horizon: horizon ?? null },
    })
    const scenarioStrike = input.pathUsesScenarioInputs ? positive(input.strikePrice) : null
    const scenarioStart = input.pathUsesScenarioInputs ? positive(input.startPrice) : null
    const scenarioOptionTenorSessions = input.pathUsesScenarioInputs ? positive(input.optionTenorSessions) : null
    const optionState = fieldState({
      source: 'option-greeks',
      status: 'research-only',
      inputMode: scenarioStrike ? 'scenario' : 'inferred',
      missingInputs: [
        'real-option-leg',
        scenarioStrike ? null : 'scenario-strike',
        scenarioOptionTenorSessions ? null : 'explicit-option-tenor-sessions',
        iv ? null : 'realized-volatility',
        tdpy ? null : 'trading-days-per-year',
      ].filter(Boolean),
    })
    const option =
      scenarioOptionTenorSessions && tdpy
        ? blackScholes({
            entryPrice: row.close,
            strikePrice: scenarioStrike || bandAnchor,
            timeToExpirySessions: scenarioOptionTenorSessions,
            iv,
            riskFreeRate: Number(input.riskFreeRate) || 0,
            type: input.optionType,
            tradingDaysPerYear: tdpy,
          })
        : null
    const rangeSpec = resolveArithmeticRangeSpec({
      referencePrice: scenarioStart || bandAnchor,
      rangeWidth: input.rangeWidth,
      skew: input.skew,
      defaultRangeWidth: 0.1,
    })
    const lowerPrice = rangeSpec?.lowerPrice ?? null
    const upperPrice = rangeSpec?.upperPrice ?? null
    const hasLiquidity = positive(input.liquidity) !== null
    const liquidity = positive(input.liquidity) ?? 1
    const lpDataState = buildLpDataState(input.lpOnchainSnapshot)
    const lpRealPrice = positive(lpDataState.quotePrice)
    const lpPoolMetrics = lpPoolCoverageMetrics(lpDataState.poolCoverage)
    const lpState = fieldState({
      source: 'lp-inventory',
      status: 'research-only',
      inputMode: lpDataState.inputMode,
      isSynthetic: lpDataState.isSynthetic,
      missingInputs: [
        ...lpDataState.missingInputs,
        hasLiquidity ? null : 'liquidity',
        scenarioStart ? null : 'startPrice',
        rangeSpec ? null : 'valid-arithmetic-range-width',
      ].filter(Boolean),
      context: {
        pool: lpDataState.pool,
        blockNumber: lpDataState.blockNumber,
        fetchedAt: lpDataState.fetchedAt,
        quotePrice: lpDataState.quotePrice,
        quoteSymbol: lpDataState.quoteSymbol,
        poolCoverage: lpDataState.poolCoverage,
      },
    })
    const lpPoolState = fieldState({
      source: 'lp-pool-coverage',
      status: 'research-only',
      inputMode: lpDataState.inputMode,
      isSynthetic: lpDataState.inputMode === 'fallback',
      missingInputs: [
        lpDataState.inputMode === 'fallback' ? 'real-lp-pool' : null,
        'tick-liquidity-history',
        'lp-add-remove-events',
      ].filter(Boolean),
      context: {
        poolCoverage: lpDataState.poolCoverage,
        fetchedAt: lpDataState.fetchedAt,
        blockNumber: lpDataState.blockNumber,
      },
    })
    const lp = uniswapV3Inventory({
      markPrice: row.close,
      lowerPrice,
      upperPrice,
      liquidity,
    })
    const ce = rangeSpec ? capitalEfficiency({ rangeWidth: rangeSpec.rangeWidth, skew: rangeSpec.skew }) : null
    const ilStartPrice = scenarioStart || bandAnchor
    const fullRangeV2Il = fullRangeV2ImpermanentLoss({
      markPrice: row.close,
      startPrice: ilStartPrice,
      liquidity,
    })
    const rangeV3Il = rangeSpec
      ? rangeV3ImpermanentLoss({
          markPrice: row.close,
          startPrice: ilStartPrice,
          lowerPrice,
          upperPrice,
          liquidity,
        })
      : null
    const hasPerpTwap = positive(input.perpTwap) !== null
    const hasSpotTwap = positive(input.spotTwap) !== null
    const hasFundingInputs = hasPerpTwap && hasSpotTwap
    const fundingSessionDurationHours = positive(input.fundingSessionDurationHours)
    const fundingSessionCalendarId = nonEmptyString(input.fundingSessionCalendarId)
    const fundingPositionSide = ['long', 'short'].includes(input.fundingPositionSide) ? input.fundingPositionSide : null
    const recoveryNotionalBasis = nonEmptyString(input.recoveryNotionalBasis)
    const fundingNotionalBasis = nonEmptyString(input.fundingNotionalBasis)
    const fundingState = fieldState({
      source: 'funding',
      status: 'proxy-only',
      inputMode: hasFundingInputs ? 'real' : 'fallback',
      missingInputs: [
        'exchange-schedule',
        'settlement-history',
        hasPerpTwap ? null : 'perpTwap',
        hasSpotTwap ? null : 'spotTwap',
        formulaHorizonSessions ? null : 'formula-derived-horizon',
        fundingSessionDurationHours ? null : 'funding-session-duration-hours',
      ].filter(Boolean),
    })
    const funding =
      hasFundingInputs && formulaHorizonSessions && fundingSessionDurationHours
        ? estimateCumulativeFundingProxy({
            perpTwap: positive(input.perpTwap),
            spotTwap: positive(input.spotTwap),
            horizonHours: formulaHorizonSessions * fundingSessionDurationHours,
          })
        : null
    const carry = funding
      ? netCarry({
          cycleStartPrice: horizon?.cycleStartPrice,
          targetPrice: horizon?.targetPrice,
          side: horizon?.side,
          cumulativeFundingProxy: funding.cumulativeFundingProxy,
          fundingPositionSide,
          recoveryNotionalBasis,
          fundingNotionalBasis,
          fundingHorizonHours: funding.horizonHours,
          comparisonHorizon: {
            sessions: formulaHorizonSessions,
            sessionDurationHours: fundingSessionDurationHours,
            sessionCalendarId: fundingSessionCalendarId,
            source: horizon?.targetSource ?? horizon?.mode,
            availableAt: horizon?.availableAt,
          },
        })
      : null
    const carryState = fieldState({
      source: 'net-carry',
      status: carry ? 'proxy-only' : 'missing-input',
      inputMode: carry ? 'explicit-scenario' : 'missing-input',
      missingInputs: [
        funding ? null : 'cumulative-funding-proxy',
        horizon?.targetPrice ? null : 'target-price',
        horizon?.side ? null : 'recovery-side',
        fundingPositionSide ? null : 'funding-position-side',
        fundingSessionCalendarId ? null : 'funding-session-calendar-id',
        recoveryNotionalBasis ? null : 'recovery-notional-basis',
        recoveryNotionalBasis && recoveryNotionalBasis === fundingNotionalBasis ? null : 'common-notional-basis',
      ].filter(Boolean),
      context: carry?.comparisonHorizon ?? null,
    })

    const fieldStates = buildFieldStates({
      horizonState,
      deltaState,
      optionState,
      lpState,
      lpPoolState,
      fundingState,
      carryState,
    })
    return {
      date: row.date,
      bandAnchor: finite(bandAnchor),
      costAnchor: finite(costPath[index]?.anchor),
      costUpper: finite(costPath[index]?.upper),
      costLower: finite(costPath[index]?.lower),
      iv: finite(iv),
      formulaHorizonSessions: finite(formulaHorizonSessions),
      recoveryFraction: finite(horizon?.recoveryFraction),
      deltaLower: finite(deltaBands?.long.low),
      deltaCost: finite(deltaBands?.long.cost),
      deltaUpper: finite(deltaBands?.long.high),
      optionDelta: finite(option?.optionDelta),
      optionGamma: finite(option?.optionGamma),
      optionThetaPerSession: finite(option?.optionThetaPerSession),
      lpLowerPrice: finite(lowerPrice),
      lpUpperPrice: finite(upperPrice),
      lpValue: finite(lp?.value),
      lpInventoryDeltaToken0: finite(lp?.inventoryDeltaToken0),
      lpNormalizedDelta: finite(normalizeInventory(lp, row.close)),
      lpRealPrice: finite(lpRealPrice),
      lpRealDivergence: finite(lpRealPrice ? (row.close - lpRealPrice) / lpRealPrice : null),
      lpPoolTurnover24h: finite(lpPoolMetrics.turnover24h),
      lpPoolTopReserveShare: finite(lpPoolMetrics.topReserveShare),
      capitalEfficiency: finite(ce?.efficiency),
      fullRangeV2IlProxy: finite(fullRangeV2Il?.fullRangeV2IlProxy),
      rangeV3Il: finite(rangeV3Il?.rangeV3Il),
      netLpEfficiency: null,
      fundingBasis: finite(funding?.basisFraction),
      cumulativeFundingProxy: finite(funding?.cumulativeFundingProxy),
      netCarry: finite(carry?.netReturn),
      breakEvenFundingNetCostReturn: finite(carry?.breakEvenFundingNetCostReturn),
      status: buildFormulaPathStatus({ horizonState, deltaState, optionState, fundingState, lpState, lpPoolState }),
      fieldStates,
    }
  })
}

function rollingAnnualVol(rows, index, tradingDaysPerYear, volWindow) {
  if (!Number.isFinite(tradingDaysPerYear) || tradingDaysPerYear <= 0) return null
  if (!Number.isFinite(volWindow) || volWindow <= 0) return null
  if (index < 2) return null
  const start = Math.max(1, index - volWindow + 1)
  const returns = []
  for (let i = start; i <= index; i += 1) {
    const previous = rows[i - 1]?.close
    const current = rows[i]?.close
    if (previous > 0 && current > 0) returns.push(Math.log(current / previous))
  }
  if (returns.length < 5) return null
  return standardDeviation(returns) * Math.sqrt(tradingDaysPerYear)
}

function normalizeInventory(lp, markPrice) {
  if (!lp || !Number.isFinite(lp.value) || lp.value <= 0 || markPrice <= 0) return null
  return (lp.inventoryDeltaToken0 * markPrice) / lp.value
}

function resolveFormulaHorizon({ rows, index, costPath, costDistancePath, input, tdpy }) {
  const scenarioSessions = resolveExplicitScenarioHorizonSessions(input)
  if (scenarioSessions) {
    const scenarioSide = ['long', 'short'].includes(input.formulaHorizonSide) ? input.formulaHorizonSide : null
    return {
      status: 'eligible',
      eligible: true,
      mode: 'explicit-scenario',
      cycleStartPrice: rows[index]?.close,
      targetPrice: positive(input.horizonTargetPrice),
      targetSource: nonEmptyString(input.horizonTargetSource),
      side: scenarioSide,
      availableAt: nonEmptyString(input.horizonAvailableAt),
      modelHorizonRaw: scenarioSessions,
      modelHorizonSessions: scenarioSessions,
      recoveryFraction: null,
      halfLifeSessions: null,
      identityClaimClass: 'missing-input',
      resultClaimClass: 'scenario-proxy',
      executionAuthority: 'none',
      reason: 'explicit-scenario-horizon-not-formula-derived',
    }
  }

  const meanReversion = meanReversionHalfLife({
    costDistanceSeries: costDistancePath.slice(0, index + 1),
    tradingDaysPerYear: tdpy,
  })
  const monotonic =
    meanReversion?.isMeanReverting === true &&
    meanReversion?.decayMode === 'monotonic-decay' &&
    meanReversion?.arCoefficient > 0 &&
    meanReversion?.arCoefficient < 1 &&
    meanReversion?.halfLifeSessions > 0
  if (!monotonic) {
    return {
      status: 'model-gate-failed',
      eligible: false,
      mode: 'formula-derived',
      reason: 'non-monotonic-or-insufficient-ar-prefix',
      resultClaimClass: null,
      meanReversion,
      executionAuthority: 'none',
    }
  }

  const recovery = deriveRecoveryHorizon({
    cycleStartPrice: rows[index]?.close,
    anchorPrice: costPath[index]?.anchor,
    targetPrice: costPath[index]?.lower,
    halfLifeSessions: meanReversion.halfLifeSessions,
    side: 'long',
    availableAt: `${rows[index]?.date ?? index}:close`,
  })
  return {
    ...recovery,
    mode: 'formula-derived',
    targetSource: 'adaptive-cost-lower',
    meanReversionClaimClass: 'sample-estimate',
    executionAuthority: 'none',
    meanReversion,
  }
}

function standardDeviation(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / Math.max(values.length - 1, 1)
  return Math.sqrt(variance)
}

function positive(value) {
  const next = Number(value)
  return Number.isFinite(next) && next > 0 ? next : null
}

function finite(value) {
  return Number.isFinite(value) ? value : null
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function fieldState({
  source,
  status,
  inputMode,
  missingInputs = [],
  blockedReasons = [],
  context = null,
  isSynthetic = inputMode !== 'real',
}) {
  return {
    source,
    status,
    inputMode,
    missingInputs,
    blockedReasons,
    isSynthetic,
    ...(context ? { context } : {}),
  }
}

function buildFieldStates({ horizonState, deltaState, optionState, lpState, lpPoolState, fundingState, carryState }) {
  const base = {
    bandAnchor: fieldState({ source: 'cost', status: 'implemented', inputMode: 'real' }),
    costAnchor: fieldState({ source: 'cost', status: 'implemented', inputMode: 'real' }),
    costUpper: fieldState({ source: 'cost', status: 'implemented', inputMode: 'real' }),
    costLower: fieldState({ source: 'cost', status: 'implemented', inputMode: 'real' }),
    iv: fieldState({ source: 'volatility', status: 'implemented', inputMode: 'real' }),
    formulaHorizonSessions: horizonState,
    recoveryFraction: horizonState,
    deltaLower: deltaState,
    deltaCost: deltaState,
    deltaUpper: deltaState,
  }
  for (const field of ['optionDelta', 'optionGamma', 'optionThetaPerSession']) base[field] = optionState
  for (const field of [
    'lpLowerPrice',
    'lpUpperPrice',
    'lpValue',
    'lpInventoryDeltaToken0',
    'lpNormalizedDelta',
    'lpRealPrice',
    'lpRealDivergence',
    'fullRangeV2IlProxy',
    'rangeV3Il',
    'capitalEfficiency',
    'netLpEfficiency',
  ])
    base[field] = lpState
  for (const field of ['lpPoolTurnover24h', 'lpPoolTopReserveShare']) base[field] = lpPoolState
  for (const field of ['fundingBasis', 'cumulativeFundingProxy']) base[field] = fundingState
  for (const field of ['netCarry', 'breakEvenFundingNetCostReturn']) base[field] = carryState
  return base
}

function classifyHorizonAvailability(horizon) {
  if (horizon?.eligible) return { status: 'research-only', missingInputs: [], blockedReasons: [] }
  const reason = horizon?.reason ?? 'formula-derived-horizon'
  const status = ['missing-input', 'not-applicable', 'model-gate-failed'].includes(horizon?.status)
    ? horizon.status
    : classifyLegacyHorizonReason(reason)
  if (status === 'missing-input') {
    return { status: 'missing-input', missingInputs: ['formula-horizon-inputs'], blockedReasons: [reason] }
  }
  return { status, missingInputs: [], blockedReasons: [reason] }
}

function classifyLegacyHorizonReason(reason) {
  if (reason === 'invalid-recovery-input') return 'missing-input'
  if (['cycle-start-at-or-beyond-anchor', 'target-already-crossed-at-cycle-start'].includes(reason)) {
    return 'not-applicable'
  }
  return 'model-gate-failed'
}

function classifyDeltaAvailability({ deltaBands, horizonAvailability, iv, tdpy, deltaSlope }) {
  if (deltaBands) return { status: 'implemented', missingInputs: [], blockedReasons: [] }

  const missingInputs = [
    ...(horizonAvailability.status === 'missing-input' ? horizonAvailability.missingInputs : []),
    iv ? null : 'realized-volatility',
    tdpy ? null : 'trading-days-per-year',
    Number.isFinite(deltaSlope) ? null : 'delta-slope',
  ].filter(Boolean)
  if (['not-applicable', 'model-gate-failed'].includes(horizonAvailability.status)) {
    return {
      status: horizonAvailability.status,
      missingInputs,
      blockedReasons: horizonAvailability.blockedReasons,
    }
  }
  if (missingInputs.length) {
    return {
      status: 'missing-input',
      missingInputs,
      blockedReasons: horizonAvailability.blockedReasons,
    }
  }
  return { status: 'model-gate-failed', missingInputs: [], blockedReasons: ['delta-band-model-domain'] }
}

function buildFormulaPathStatus({ horizonState, deltaState, optionState, fundingState, lpState, lpPoolState }) {
  const statuses = new Set()
  for (const state of [horizonState, deltaState, optionState, fundingState, lpState, lpPoolState]) {
    if (state?.status) statuses.add(state.status)
    if (state?.missingInputs?.length) statuses.add('missing-input')
    if (state?.isSynthetic) statuses.add(`${state.inputMode}-input`)
  }
  return [...statuses]
}
