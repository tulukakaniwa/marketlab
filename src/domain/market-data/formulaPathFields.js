export const FORMULA_PATH_FIELDS = {
  bandAnchor: field('cost', 'price', 'priceBands', 'implemented'),
  costAnchor: field('cost', 'price', 'priceBands', 'implemented', true),
  costUpper: field('cost', 'price', 'priceBands', 'implemented', true),
  costLower: field('cost', 'price', 'priceBands', 'implemented', true),
  iv: field('volatility', 'return', 'greeksPane', 'implemented'),
  formulaHorizonSessions: field('dynamic-holding-state', 'trading-session', 'researchMarkers', 'research-only'),
  formulaHorizonDays: field('dynamic-holding-state', 'trading-session', 'researchMarkers', 'deprecated'),
  recoveryFraction: field('dynamic-holding-state', 'ratio', 'researchMarkers', 'research-only'),
  deltaLower: field('delta-band', 'price', 'priceBands', 'implemented', true),
  deltaCost: field('delta-band', 'price', 'priceBands', 'implemented'),
  deltaUpper: field('delta-band', 'price', 'priceBands', 'implemented', true),
  optionDelta: field('option-greeks', 'delta', 'greeksPane', 'research-only', true),
  optionGamma: field('option-greeks', 'gamma', 'greeksPane', 'research-only', true),
  optionThetaPerSession: field('option-greeks', 'theta/trading-session', 'greeksPane', 'research-only', true),
  optionThetaDaily: field('option-greeks', 'theta/trading-session', 'greeksPane', 'deprecated'),
  lpLowerPrice: field('lp-inventory', 'price', 'priceBands', 'research-only', true),
  lpUpperPrice: field('lp-inventory', 'price', 'priceBands', 'research-only', true),
  lpValue: field('lp-inventory', 'quote', 'lpPane', 'research-only', true),
  lpInventoryDeltaToken0: field('lp-inventory', 'token0', 'lpPane', 'research-only'),
  lpInventoryDelta: field('lp-inventory', 'token0', 'lpPane', 'deprecated'),
  lpNormalizedDelta: field('lp-inventory', 'ratio', 'lpPane', 'research-only', true),
  lpRealPrice: field('lp-inventory', 'price', 'priceBands', 'research-only', true),
  lpRealDivergence: field('lp-inventory', 'return', 'lpPane', 'research-only', true),
  lpPoolTurnover24h: field('lp-pool-coverage', 'return', 'lpPane', 'research-only', true),
  lpPoolTopReserveShare: field('lp-pool-coverage', 'ratio', 'lpPane', 'research-only', true),
  capitalEfficiency: field('capital-efficiency', 'multiple', 'lpPane', 'research-only', true),
  fullRangeV2IlProxy: field('lp-inventory', 'return', 'lpPane', 'research-only'),
  rangeV3Il: field('lp-inventory', 'return', 'lpPane', 'research-only'),
  impermanentLoss: field('lp-inventory', 'return', 'lpPane', 'deprecated'),
  netLpEfficiency: field('net-lp-efficiency', 'return', 'lpPane', 'missing-input', false, false),
  fundingBasis: field('funding', 'return', 'carryPane', 'proxy-only'),
  cumulativeFundingProxy: field('funding', 'return', 'carryPane', 'proxy-only', true),
  fundingProxy: field('funding', 'return', 'carryPane', 'deprecated'),
  netCarry: field('net-carry', 'return', 'carryPane', 'proxy-only', true),
  breakEvenFundingNetCostReturn: field('net-carry', 'return', 'carryPane', 'proxy-only'),
  status: field('formula-path', 'label', 'researchMarkers', 'implemented', false, false),
  fieldStates: field('formula-path', 'metadata', 'researchMarkers', 'implemented', false, false),
}

export const FORMULA_PATH_CURVES = Object.fromEntries(
  Object.entries(FORMULA_PATH_FIELDS).filter(([, meta]) => meta.drawable),
)

function field(source, unit, pane, status, drawable = false, numeric = true) {
  return { source, unit, pane, status, drawable, ...(numeric ? {} : { numeric: false }) }
}
