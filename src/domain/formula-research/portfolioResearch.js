function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null
}

/**
 * A ledger-shaped research result.  Mark, entry cashflow and PnL are never
 * added across columns.  `scenarioTotal` is exposed separately when some legs
 * still use model marks or proxy carry inputs.
 */
export function buildPortfolioResearch({
  lpMark,
  lpEntryValue,
  lpPnl,
  optionPortfolio,
  hedgePnl,
  feePnl,
  fundingPnl,
  feeModelCalibrated = false,
  fundingSettlementKnown = false,
  lpPositionKnown = true,
} = {}) {
  const optionMissingInputs = Array.isArray(optionPortfolio?.missingInputs)
    ? optionPortfolio.missingInputs.filter((input) => typeof input === 'string' && input.length > 0)
    : []
  const optionMark = finiteOrNull(optionPortfolio?.value)
  const optionEntry = optionMissingInputs.includes('option-leg-premium')
    ? null
    : finiteOrNull(optionPortfolio?.entryCost)
  const optionPnl = finiteOrNull(optionPortfolio?.pnl)
  const pnlComponents = {
    lp: finiteOrNull(lpPnl),
    option: optionPnl,
    hedge: finiteOrNull(hedgePnl),
    fees: finiteOrNull(feePnl),
    funding: finiteOrNull(fundingPnl),
  }
  const scenarioTotal = Object.values(pnlComponents).every(Number.isFinite)
    ? Object.values(pnlComponents).reduce((sum, value) => sum + value, 0)
    : null
  const missingInputs = [
    ...new Set(
      [
        ...optionMissingInputs,
        lpPositionKnown ? null : 'valid-lp-position-range',
        optionEntry === null ? 'option-leg-premium' : null,
        feeModelCalibrated ? null : 'path-fee-model',
        fundingSettlementKnown ? null : 'funding-settlement',
      ].filter(Boolean),
    ),
  ]
  const totalPnl = scenarioTotal !== null && !missingInputs.length ? scenarioTotal : null
  return {
    status: missingInputs.length ? 'calibration-required' : 'scenario-attribution',
    mark: {
      lp: finiteOrNull(lpMark),
      option: optionMark,
      hedge: null,
      total: null,
      missingInputs: ['hedge-mark-value', 'common-valuation-basis'],
    },
    entryCashflow: {
      lp: finiteOrNull(lpEntryValue),
      option: optionEntry,
      hedge: null,
      total: null,
      missingInputs: [optionEntry === null ? 'option-leg-premium' : null, 'hedge-entry-cashflow'].filter(Boolean),
    },
    pnl: {
      ...pnlComponents,
      scenarioTotal,
      total: totalPnl,
      missingInputs,
    },
    missingInputs,
    accountingIdentity: 'mark-minus-entry-cashflow-plus-period-cashflows-equals-pnl',
  }
}
