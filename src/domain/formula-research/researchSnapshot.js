import {
  asianOption,
  bachelierOption,
  blackScholes,
  buildOptionPortfolio,
  capitalEfficiency,
  fundingRate,
  hedgedLpPortfolioCurve,
  impermanentLoss,
  liquidityFingerprint,
  numoenSnapshot,
  optionLegsFromTemplate,
  resolveArithmeticRangeSpec,
  uniswapV2Inventory,
  uniswapV3HedgedInventory,
  uniswapV3HedgedPosition,
  uniswapV3Inventory,
} from '../formulas/core.js'
import { buildLpDataState } from '../market-data/lpOnchain.js'
import { buildPortfolioResearch } from './portfolioResearch.js'

export function buildResearchSnapshot({ market, input, executable }) {
  const { entryPrice, holdingDays, iv, capital } = executable.inputs
  const rangeSpec = resolveArithmeticRangeSpec({
    referencePrice: entryPrice,
    rangeWidth: input.rangeWidth,
    skew: input.skew,
    defaultRangeWidth: 0.1,
  })
  const rangeWidth = rangeSpec?.rangeWidth ?? null
  const tdpy = Number(input.tradingDaysPerYear) || 365
  const strikePrice = positive(input.strikePrice) || entryPrice * 1.05
  const startPrice = positive(input.startPrice) || market.costAnchor
  const liquidity = Math.max(Number(input.liquidity) || 0, 0)
  const hedgeSize = Number(input.hedgeSize) || 0
  const fees = Number(input.fees) || 0
  const skew = rangeSpec?.skew ?? null
  const option = blackScholes({
    entryPrice,
    strikePrice,
    holdingDays,
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
    holdingDays,
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
    holdingDays,
    iv,
    riskFreeRate: Number(input.riskFreeRate) || 0,
    type: input.optionType,
    tradingDaysPerYear: tdpy,
  })
  const bachelier = bachelierOption({
    entryPrice,
    strikePrice,
    holdingDays,
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
    fees,
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
        fees,
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
        fees,
      })
    : null
  const il = impermanentLoss({ markPrice: entryPrice, startPrice, liquidity })
  const hasFundingInputs = positive(input.perpTwap) !== null && positive(input.spotTwap) !== null
  const funding = hasFundingInputs
    ? fundingRate({
        perpTwap: positive(input.perpTwap),
        spotTwap: positive(input.spotTwap),
        hours: holdingDays * 24,
      })
    : null
  const optionBase = option?.price ?? 0
  const lpPortfolio = rangeSpec
    ? hedgedLpPortfolioCurve({
        startPrice: entryPrice,
        lowerPrice,
        upperPrice,
        liquidity,
        hedgeSize,
        fees,
        fundingCost: Math.abs(funding?.funding ?? 0) * capital,
        optionWeight: 1,
        optionPricer: (price) => optionLegPnL({ price, strikePrice, holdingDays, iv, input, tdpy, optionBase }),
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
      })
    : null
  const numoen = numoenSnapshot({
    R1: Number(input.numoenR1) || 8.7,
    s: Number(input.numoenShares) || 1.649981319214726,
    u: Number(input.numoenU) || 4,
    dy: Number(input.numoenDy) || 0.1,
  })
  const lpDataState = buildLpDataState(input.lpOnchainSnapshot)
  const fundingPnl = funding ? -Math.abs(funding.cumulativeFundingEstimate ?? funding.funding ?? 0) * capital : 0
  const portfolioResearch = buildPortfolioResearch({
    lpMark: lpV3Raw?.value,
    lpEntryValue: lpV3Entry?.value,
    lpPnl: lpV3Hedged?.lpPnl,
    optionPortfolio,
    hedgePnl: lpV3Hedged?.hedgePnl,
    feePnl: lpV3Hedged?.feeIncome,
    fundingPnl,
    feeModelCalibrated: false,
    fundingSettlementKnown: false,
    lpPositionKnown: Boolean(rangeSpec && lpV3Hedged),
  })
  const portfolioMissingInputs = [
    ...new Set([
      ...lpDataState.missingInputs,
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
      fees,
      strikePrice,
      startPrice,
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
    impermanentLoss: il,
    efficiency: rangeSpec ? capitalEfficiency({ rangeWidth, skew }) : null,
    funding,
    lpOnchain: {
      ...lpDataState,
      quotePrice: input.lpOnchainSnapshot?.quotePrice ?? lpDataState.quotePrice,
      quoteSymbol: input.lpOnchainSnapshot?.quoteSymbol ?? lpDataState.quoteSymbol,
    },
    portfolioResearch: portfolioResearchState,
  }
}

function optionLegPnL({ price, strikePrice, holdingDays, iv, input, tdpy, optionBase }) {
  const priced = blackScholes({
    entryPrice: price,
    strikePrice,
    holdingDays,
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
