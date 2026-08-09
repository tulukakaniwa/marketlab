import {
  asianOption,
  bachelierOption,
  blackScholes,
  buildOptionPortfolio,
  capitalEfficiency,
  fullRangeV2ImpermanentLoss,
  estimateCumulativeFundingProxy,
  hedgedLpPortfolioCurve,
  liquidityFingerprint,
  netCarry,
  numoenSnapshot,
  optionLegsFromTemplate,
  resolveArithmeticRangeSpec,
  rangeV3ImpermanentLoss,
  uniswapV2Inventory,
  uniswapV3HedgedInventory,
  uniswapV3HedgedPosition,
  uniswapV3Inventory,
} from '../formulas/core.js'
import { buildLpDataState } from '../market-data/lpOnchain.js'
import { buildPortfolioResearch } from './portfolioResearch.js'

export function buildResearchSnapshot({ market, input, executable }) {
  const { entryPrice, iv } = executable.inputs
  const formulaHorizonSessions = positive(executable.inputs.formulaHorizonSessions)
  const optionTenorSessions = positive(input.optionTenorSessions)
  const rangeSpec = resolveArithmeticRangeSpec({
    referencePrice: entryPrice,
    rangeWidth: input.rangeWidth,
    skew: input.skew,
    defaultRangeWidth: 0.1,
  })
  const rangeWidth = rangeSpec?.rangeWidth ?? null
  const tdpy = positive(input.tradingDaysPerYear)
  const strikePrice = positive(input.strikePrice) || entryPrice * 1.05
  const startPrice = positive(input.startPrice) || market.costAnchor
  const liquidity = Math.max(Number(input.liquidity) || 0, 0)
  const hedgeSize = Number(input.hedgeSize) || 0
  const feeIncomeQuote = optionalFinite(input.feeIncomeQuote)
  const fundingCashflowSource = ['observed-settlement', 'explicit-scenario'].includes(input.fundingCashflowSource)
    ? input.fundingCashflowSource
    : null
  const fundingCashflowQuote = fundingCashflowSource ? optionalFinite(input.fundingCashflowQuote) : null
  const fundingSessionDurationHours = positive(input.fundingSessionDurationHours)
  const skew = rangeSpec?.skew ?? null
  const option = blackScholes({
    entryPrice,
    strikePrice,
    timeToExpirySessions: optionTenorSessions,
    iv,
    riskFreeRate: Number(input.riskFreeRate) || 0,
    dividendYield: Number(input.dividendYield) || 0,
    type: input.optionType,
    tradingDaysPerYear: tdpy,
  })
  const optionLegs = optionLegsFromTemplate({
    strategy: input.optionStrategy,
    side: input.optionSide,
    optionType: input.optionType,
    entryPrice,
    strikePrice,
    strikePrice2: Number(input.strikePrice2),
    quantity: Number(input.optionQuantity) || 1,
    widthPct: Number(input.optionWidthPct) || rangeWidth || 0.05,
    premium: optionalFinite(input.optionPremium),
  })
  const optionPortfolio = buildOptionPortfolio({
    entryPrice,
    timeToExpirySessions: optionTenorSessions,
    iv,
    riskFreeRate: Number(input.riskFreeRate) || 0,
    dividendYield: Number(input.dividendYield) || 0,
    tradingDaysPerYear: tdpy,
    contractMultiplier: Number(input.optionMultiplier) || 1,
    volatilitySource: input.ivSource || 'scenario-unspecified',
    volatilitySourceVerified: input.ivSourceVerified === true,
    legs: optionLegs,
  })
  const asian = asianOption({
    entryPrice,
    strikePrice,
    timeToExpirySessions: optionTenorSessions,
    iv,
    riskFreeRate: Number(input.riskFreeRate) || 0,
    type: input.optionType,
    tradingDaysPerYear: tdpy,
  })
  const bachelier = bachelierOption({
    entryPrice,
    strikePrice,
    timeToExpirySessions: optionTenorSessions,
    normalVol: iv * entryPrice,
    riskFreeRate: Number(input.riskFreeRate) || 0,
    type: input.optionType,
    tradingDaysPerYear: tdpy,
  })
  const lp = uniswapV2Inventory({
    markPrice: entryPrice,
    startPrice,
    liquidity,
    hedgeSize,
    feeIncomeQuote,
  })
  const lowerPrice = rangeSpec?.lowerPrice ?? null
  const upperPrice = rangeSpec?.upperPrice ?? null
  const rangeFactor = rangeSpec ? Math.sqrt(upperPrice / lowerPrice) : null
  const lpV3Raw = rangeSpec ? uniswapV3Inventory({ markPrice: entryPrice, lowerPrice, upperPrice, liquidity }) : null
  const lpV3Entry = rangeSpec ? uniswapV3Inventory({ markPrice: startPrice, lowerPrice, upperPrice, liquidity }) : null
  const lpV3SymmetricApprox = rangeSpec
    ? uniswapV3HedgedInventory({
        markPrice: entryPrice,
        strikePrice: startPrice,
        rangeFactor,
        liquidity,
        hedgeSize,
        feeIncomeQuote,
      })
    : null
  const lpV3Hedged = rangeSpec
    ? uniswapV3HedgedPosition({
        markPrice: entryPrice,
        startPrice,
        lowerPrice,
        upperPrice,
        liquidity,
        hedgeSize,
        feeIncomeQuote,
      })
    : null
  const fullRangeV2Il = fullRangeV2ImpermanentLoss({ markPrice: entryPrice, startPrice, liquidity })
  const rangeV3Il = rangeSpec
    ? rangeV3ImpermanentLoss({ markPrice: entryPrice, startPrice, lowerPrice, upperPrice, liquidity })
    : null
  const hasFundingInputs = positive(input.perpTwap) !== null && positive(input.spotTwap) !== null
  const funding =
    hasFundingInputs && formulaHorizonSessions && fundingSessionDurationHours
      ? estimateCumulativeFundingProxy({
          perpTwap: positive(input.perpTwap),
          spotTwap: positive(input.spotTwap),
          horizonHours: formulaHorizonSessions * fundingSessionDurationHours,
        })
      : null
  const fundingCarry = funding
    ? netCarry({
        cycleStartPrice: executable.inputs.horizonCycleStartPrice,
        targetPrice: executable.inputs.horizonTargetPrice,
        side: executable.inputs.formulaHorizonSide,
        cumulativeFundingProxy: funding.cumulativeFundingProxy,
        fundingPositionSide: input.fundingPositionSide,
        recoveryNotionalBasis: input.recoveryNotionalBasis,
        fundingNotionalBasis: input.fundingNotionalBasis,
        fundingHorizonHours: funding.horizonHours,
        comparisonHorizon: {
          sessions: formulaHorizonSessions,
          sessionDurationHours: fundingSessionDurationHours,
          sessionCalendarId: input.fundingSessionCalendarId,
          source: executable.inputs.horizonTargetSource,
          availableAt: executable.inputs.horizonAvailableAt,
        },
      })
    : null
  const optionBase = option?.price ?? null
  const lpPortfolio =
    rangeSpec && option && Number.isFinite(feeIncomeQuote) && Number.isFinite(fundingCashflowQuote)
      ? hedgedLpPortfolioCurve({
          startPrice: entryPrice,
          lowerPrice,
          upperPrice,
          liquidity,
          hedgeSize,
          feeIncomeQuote,
          fundingCashflowQuote,
          fundingCashflowSource,
          optionWeight: 1,
          optionPricer: (price) =>
            optionLegPnL({
              price,
              strikePrice,
              optionTenorSessions,
              iv,
              input,
              tdpy,
              optionBase,
            }),
        })
      : null
  const fingerprint = rangeSpec
    ? liquidityFingerprint({
        entryPrice: startPrice,
        priceGrid: 120,
        distribution: 'log-laplace',
        lambda: Number(input.fingerprintLambda) || 2.6,
        kappa: Number(input.fingerprintKappa) || 0.77,
        lowerFactor: Math.max(0.05, lowerPrice / startPrice),
        upperFactor: Math.min(20, upperPrice / startPrice),
        segmentCount: 12,
        volatility: iv,
        tradingDaysPerYear: positive(input.tradingDaysPerYear),
      })
    : null
  const numoen = numoenSnapshot({
    R1: Number(input.numoenR1) || 8.7,
    s: Number(input.numoenShares) || 1.649981319214726,
    u: Number(input.numoenU) || 4,
    dy: Number(input.numoenDy) || 0.1,
  })
  const lpDataState = buildLpDataState(input.lpOnchainSnapshot)
  const portfolioResearch = buildPortfolioResearch({
    lpMark: lpV3Raw?.value,
    lpEntryValue: lpV3Entry?.value,
    lpPnl: lpV3Hedged?.lpPnl,
    optionPortfolio,
    hedgePnl: lpV3Hedged?.hedgePnl,
    feeIncomeQuote: lpV3Hedged?.feeIncomeQuote,
    fundingCashflowQuote,
    fundingCashflowSource,
    feeModelCalibrated: false,
    lpPositionKnown: Boolean(rangeSpec && lpV3Hedged),
  })
  const portfolioMissingInputs = [
    ...new Set([
      ...lpDataState.missingInputs,
      ...(tdpy ? [] : ['trading-days-per-year']),
      ...(optionTenorSessions ? [] : ['option-tenor-sessions']),
      ...(Number.isFinite(feeIncomeQuote) ? [] : ['fee-income-quote']),
      ...(optionPortfolio?.missingInputs ?? []),
      ...portfolioResearch.missingInputs,
    ]),
  ]
  const portfolioResearchState = {
    ...portfolioResearch,
    status: portfolioMissingInputs.length ? 'calibration-required' : portfolioResearch.status,
    pnl: {
      ...portfolioResearch.pnl,
      total: portfolioMissingInputs.length ? null : portfolioResearch.pnl.total,
      missingInputs: portfolioMissingInputs,
    },
    missingInputs: portfolioMissingInputs,
  }

  return {
    researchInputs: {
      rangeWidth,
      skew,
      rangeStatus: rangeSpec ? 'valid' : 'invalid-input',
      liquidity,
      hedgeSize,
      feeIncomeQuote,
      fundingCashflowQuote,
      fundingCashflowSource: fundingCashflowSource ?? 'missing-input',
      fundingPositionSide: input.fundingPositionSide ?? null,
      fundingSessionDurationHours,
      fundingSessionCalendarId: input.fundingSessionCalendarId ?? null,
      recoveryNotionalBasis: input.recoveryNotionalBasis ?? null,
      fundingNotionalBasis: input.fundingNotionalBasis ?? null,
      legacyFeeInput: optionalFinite(input.feeIncomeQuote) === null && optionalFinite(input.fees) !== null,
      strikePrice,
      startPrice,
      formulaHorizonSessions,
      optionTenorSessions,
      optionTenorSource: optionTenorSessions ? 'explicit-option-expiry-scenario' : 'missing-input',
      tradingDaysPerYear: tdpy,
      tradingDaysPerYearSource: tdpy ? 'upstream-explicit-or-inferred' : 'missing-input',
      volatilitySource: input.ivSource || 'scenario-unspecified',
    },
    option,
    optionPortfolio,
    asian,
    bachelier,
    lp,
    lpV3: lpV3Raw,
    lpV3Hedged,
    lpV3SymmetricApprox,
    lpPortfolio,
    liquidityFingerprint: fingerprint,
    numoen,
    fullRangeV2Il,
    rangeV3Il,
    efficiency: rangeSpec ? capitalEfficiency({ rangeWidth, skew }) : null,
    funding,
    netCarry: fundingCarry,
    lpOnchain: {
      ...lpDataState,
      quotePrice: input.lpOnchainSnapshot?.quotePrice ?? lpDataState.quotePrice,
      quoteSymbol: input.lpOnchainSnapshot?.quoteSymbol ?? lpDataState.quoteSymbol,
    },
    portfolioResearch: portfolioResearchState,
  }
}

function optionLegPnL({ price, strikePrice, optionTenorSessions, iv, input, tdpy, optionBase }) {
  const priced = blackScholes({
    entryPrice: price,
    strikePrice,
    timeToExpirySessions: optionTenorSessions,
    iv,
    riskFreeRate: Number(input.riskFreeRate) || 0,
    dividendYield: Number(input.dividendYield) || 0,
    type: input.optionType,
    tradingDaysPerYear: tdpy,
  })
  return (priced?.price ?? 0) - optionBase
}

function positive(value) {
  const next = Number(value)
  return Number.isFinite(next) && next > 0 ? next : null
}

function optionalFinite(value) {
  if (value === null || value === undefined || value === '') return null
  const next = Number(value)
  return Number.isFinite(next) ? next : null
}
