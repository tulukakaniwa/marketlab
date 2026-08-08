/**
 * Keep dimensionless capital efficiency separate from same-horizon returns.
 * CE is geometry; IL and fees can only be netted when their basis and horizon
 * are explicitly aligned.
 */
export function lpResearchAttribution({
  capitalEfficiency,
  impermanentLoss,
  feeReturn = null,
  feeSource = null,
  horizonDays = null,
} = {}) {
  if (!Number.isFinite(capitalEfficiency) || capitalEfficiency <= 0) return null
  const il = Number.isFinite(impermanentLoss) ? impermanentLoss : null
  const fee = Number.isFinite(feeReturn) ? feeReturn : null
  const comparableReturns = il !== null && fee !== null && Number.isFinite(horizonDays) && horizonDays > 0
  const missingInputs = []
  if (il === null) missingInputs.push('same-horizon-impermanent-loss')
  if (fee === null) missingInputs.push('realized-or-path-fee-return')
  if (!Number.isFinite(horizonDays) || horizonDays <= 0) missingInputs.push('fee-and-il-horizon')
  return {
    status: comparableReturns ? 'scenario-attribution' : 'calibration-required',
    geometry: {
      capitalEfficiency,
      unit: 'multiple',
      comparableToReturns: false,
    },
    returns: {
      impermanentLoss: il,
      feeReturn: fee,
      netReturn: comparableReturns ? il + fee : null,
      horizonDays: Number.isFinite(horizonDays) && horizonDays > 0 ? horizonDays : null,
      unit: 'return-on-common-capital-basis',
    },
    feeModel: {
      source: feeSource,
      pathDependent: true,
      calibrated: fee !== null && Boolean(feeSource),
    },
    missingInputs,
    relation: 'decomposition-not-capital-efficiency-sum',
  }
}

/**
 * Compatibility entry point.  The legacy `feeRate` argument was commonly a
 * pool fee tier, so it is deliberately ignored: a tier is not fee revenue.
 */
export function netLpEfficiency({ capitalEfficiency, impermanentLoss, feeRate = null, horizonDays = null } = {}) {
  const attribution = lpResearchAttribution({
    capitalEfficiency,
    impermanentLoss,
    feeReturn: null,
    feeSource: null,
    horizonDays,
  })
  return attribution
    ? {
        ...attribution,
        legacyCompatibility: true,
        ignoredInputs: Number.isFinite(feeRate) ? ['feeRate-without-volume-path'] : [],
      }
    : null
}

export function compareFeeCarryToTheta({
  feeIncomeQuote,
  feeAccrualDays,
  optionThetaDaily,
  contractMultiplier = 1,
  feeCurrency,
  optionCurrency,
  feeNotional,
  optionNotional,
} = {}) {
  const sameCurrency = Boolean(feeCurrency) && feeCurrency === optionCurrency
  const sameNotional =
    Number.isFinite(feeNotional) && feeNotional > 0 && Number.isFinite(optionNotional) && optionNotional > 0
  const validHorizon = Number.isFinite(feeAccrualDays) && feeAccrualDays > 0
  const validFee = Number.isFinite(feeIncomeQuote)
  const validTheta = Number.isFinite(optionThetaDaily) && Number.isFinite(contractMultiplier) && contractMultiplier > 0
  const comparable = sameCurrency && sameNotional && validHorizon && validFee && validTheta
  const feeCarryPerDay = validFee && validHorizon ? feeIncomeQuote / feeAccrualDays : null
  const thetaDaily = validTheta ? optionThetaDaily * contractMultiplier : null
  const normalizedFeeCarry = comparable ? feeCarryPerDay / feeNotional : null
  const normalizedTheta = comparable ? thetaDaily / optionNotional : null
  return {
    relation: 'analogy-not-identity',
    status: comparable ? 'comparable-scenario' : 'calibration-required',
    comparable,
    feeCarryPerDay,
    thetaDaily,
    normalizedFeeCarry,
    normalizedTheta,
    coverageRatio: comparable && normalizedTheta !== 0 ? normalizedFeeCarry / Math.abs(normalizedTheta) : null,
    missingInputs: [
      sameCurrency ? null : 'same-currency',
      sameNotional ? null : 'notional-basis',
      validHorizon ? null : 'fee-accrual-horizon',
      validFee ? null : 'path-fee-income',
      validTheta ? null : 'option-theta',
    ].filter(Boolean),
  }
}

/**
 * Approximate fee growth along an observed/simulated volume path.  Each step
 * must carry its own active-liquidity share; a fee tier alone never creates
 * revenue.
 */
export function estimateLpPathFees({ steps, initialCapitalQuote, currency = null } = {}) {
  if (!Array.isArray(steps) || !steps.length) {
    return {
      status: 'calibration-required',
      feeIncomeQuote: null,
      feeReturn: null,
      currency,
      steps: [],
      missingInputs: ['volume-path'],
    }
  }
  const missingInputs = new Set()
  const breakdown = steps.map((step, index) => {
    const volumeQuote = optionalNonNegative(step?.volumeQuote)
    const feeTier = optionalNonNegative(step?.feeTier)
    const positionLiquidity = optionalNonNegative(step?.positionLiquidity)
    const activeLiquidity = optionalPositive(step?.activeLiquidity)
    const hasInRangeFraction = present(step?.inRangeFraction)
    const inRangeFraction = hasInRangeFraction ? optionalFraction(step.inRangeFraction) : 1
    if (volumeQuote === null) missingInputs.add(`steps[${index}].volumeQuote`)
    if (feeTier === null) missingInputs.add(`steps[${index}].feeTier`)
    if (positionLiquidity === null) missingInputs.add(`steps[${index}].positionLiquidity`)
    if (activeLiquidity === null) missingInputs.add(`steps[${index}].activeLiquidity`)
    if (hasInRangeFraction && inRangeFraction === null) missingInputs.add(`steps[${index}].inRangeFraction`)
    const share =
      positionLiquidity !== null && activeLiquidity !== null
        ? Math.max(0, Math.min(1, positionLiquidity / activeLiquidity))
        : null
    const grossFee = [volumeQuote, feeTier, share, inRangeFraction].every(Number.isFinite)
      ? volumeQuote * feeTier * share * inRangeFraction
      : null
    const hasGasCost = present(step?.gasCostQuote)
    const hasRebalanceCost = present(step?.rebalanceCostQuote)
    const gasCostQuote = hasGasCost ? optionalNonNegative(step.gasCostQuote) : 0
    const rebalanceCostQuote = hasRebalanceCost ? optionalNonNegative(step.rebalanceCostQuote) : 0
    if (hasGasCost && gasCostQuote === null) missingInputs.add(`steps[${index}].gasCostQuote`)
    if (hasRebalanceCost && rebalanceCostQuote === null) missingInputs.add(`steps[${index}].rebalanceCostQuote`)
    const costs = [gasCostQuote, rebalanceCostQuote].every(Number.isFinite) ? gasCostQuote + rebalanceCostQuote : null
    return {
      index,
      volumeQuote,
      feeTier,
      positionShare: share,
      inRangeFraction,
      grossFee,
      costs,
      netFee: Number.isFinite(grossFee) && Number.isFinite(costs) ? grossFee - costs : null,
    }
  })
  const complete = breakdown.every((step) => Number.isFinite(step.netFee))
  const feeIncomeQuote = complete ? breakdown.reduce((sum, step) => sum + step.netFee, 0) : null
  const capital = optionalPositive(initialCapitalQuote)
  if (capital === null) missingInputs.add('initial-capital-quote')
  return {
    status: complete && capital !== null ? 'path-scenario' : 'calibration-required',
    feeIncomeQuote,
    feeReturn: complete && capital !== null ? feeIncomeQuote / capital : null,
    currency,
    steps: breakdown,
    pathDependent: true,
    missingInputs: [...missingInputs],
  }
}

function optionalNonNegative(value) {
  if (value === null || value === undefined || value === '') return null
  const next = Number(value)
  return Number.isFinite(next) && next >= 0 ? next : null
}

function optionalPositive(value) {
  const next = optionalNonNegative(value)
  return next !== null && next > 0 ? next : null
}

function optionalFraction(value) {
  const next = optionalNonNegative(value)
  return next !== null && next <= 1 ? next : null
}

function present(value) {
  return value !== null && value !== undefined && value !== ''
}
