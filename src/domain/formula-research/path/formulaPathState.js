export function fieldState({
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

export function buildFieldStates({
  volatilityState,
  horizonState,
  deltaState,
  optionState,
  lpRangeState,
  lpState,
  lpPoolState,
  fundingState,
  carryState,
}) {
  const base = {
    bandAnchor: fieldState({ source: 'cost', status: 'implemented', inputMode: 'real' }),
    costAnchor: fieldState({ source: 'cost', status: 'implemented', inputMode: 'real' }),
    costUpper: fieldState({ source: 'cost', status: 'implemented', inputMode: 'real' }),
    costLower: fieldState({ source: 'cost', status: 'implemented', inputMode: 'real' }),
    iv: volatilityState,
    formulaHorizonSessions: horizonState,
    recoveryFraction: horizonState,
    deltaLower: deltaState,
    deltaCost: deltaState,
    deltaUpper: deltaState,
  }
  for (const field of ['optionDelta', 'optionGamma', 'optionThetaPerSession']) base[field] = optionState
  for (const field of ['lpLowerPrice', 'lpUpperPrice']) base[field] = lpRangeState
  for (const field of [
    'lpValue',
    'lpInventoryDeltaToken0',
    'lpNormalizedDelta',
    'fullRangeV2IlProxy',
    'rangeV3Il',
    'capitalEfficiency',
    'netLpEfficiency',
  ])
    base[field] = lpState
  for (const field of ['lpRealPrice', 'lpRealDivergence', 'lpPoolTurnover24h', 'lpPoolTopReserveShare'])
    base[field] = lpPoolState
  for (const field of ['fundingBasis', 'cumulativeFundingProxy']) base[field] = fundingState
  for (const field of ['netCarry', 'breakEvenFundingNetCostReturn']) base[field] = carryState
  return base
}

export function buildFormulaPathStatus({
  horizonState,
  deltaState,
  optionState,
  fundingState,
  lpRangeState,
  lpState,
  lpPoolState,
}) {
  const statuses = new Set()
  for (const state of [horizonState, deltaState, optionState, fundingState, lpRangeState, lpState, lpPoolState]) {
    if (state?.status) statuses.add(state.status)
    if (state?.missingInputs?.length) statuses.add('missing-input')
    if (state?.isSynthetic) statuses.add(`${state.inputMode}-input`)
  }
  return [...statuses]
}

export function normalizeInventory(lp, markPrice) {
  if (!lp || !Number.isFinite(lp.value) || lp.value <= 0 || markPrice <= 0) return null
  return (lp.inventoryDeltaToken0 * markPrice) / lp.value
}
