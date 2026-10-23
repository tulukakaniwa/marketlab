import { replayPoolEvents } from './uniswapV3Replay.js'
import { quoteExactInput } from './uniswapV3Quote.js'

const DEFAULT_BASE_RAW = '1000000000000000000'
const DEFAULT_QUOTE_RAW = '5000000000'

function compareOrder(pool, before, after, tokenIn, amountInRaw) {
  const beforeQuote = quoteExactInput({ pool, state: before, tokenIn, amountInRaw })
  const afterQuote = quoteExactInput({ pool, state: after, tokenIn, amountInRaw })
  return { tokenIn, amountInRaw, before: beforeQuote, after: afterQuote }
}

/** Research only: fixed test orders compare depth before/after an observed LP action.
 * Replayed swaps are observed pool outcomes, not proof of participant intent or ETH-wide causality.
 * The endpoint is only a validation checkpoint; never an input to an earlier quote.
 */
export function analyzeEthLpBundle(bundle, options = {}) {
  const baseAmountRaw = options.baseAmountRaw ?? DEFAULT_BASE_RAW
  const quoteAmountRaw = options.quoteAmountRaw ?? DEFAULT_QUOTE_RAW
  if (
    ![baseAmountRaw, quoteAmountRaw].every(
      (value) =>
        typeof value === 'string' && value.length <= 77 && /^[1-9]\d*$/.test(value) && BigInt(value) < 1n << 255n,
    )
  ) {
    return { status: 'blocked', issues: ['scenario-amount-must-be-positive-integer'], executionAuthority: 'none' }
  }
  const replay = replayPoolEvents(bundle)
  const evidence = {
    schemaVersion: 1,
    executionAuthority: 'none',
    claimClass: 'conditional-single-pool-mechanical-impact',
    evidenceBasis: 'rpc-bundle-internal-consistency',
    // Import declarations are not a locally verified Merkle receipt proof.
    receiptProofVerified: false,
    declaredReceiptProofVerified: bundle?.provenance?.receiptProofVerified === true,
    dataOrigin: bundle?.provenance?.fixture ? 'synthetic-fixture' : 'captured-rpc',
    source: bundle?.provenance?.source ?? null,
    availableAt: bundle?.provenance?.availableAt ?? null,
    fetchedAt: bundle?.provenance?.fetchedAt ?? null,
    scope: 'local-research',
    priceUnit: 'USDC/WETH',
    quoteCurrencyAssumption: 'USDC units; no USD parity assumption',
  }
  if (replay.status !== 'verified') return { ...evidence, status: 'blocked', issues: replay.issues }
  const { pool } = bundle
  const baseToken = pool.baseTokenIndex
  const quoteToken = 1 - baseToken
  const scenario = {
    sellBase: { tokenIn: baseToken, amountInRaw: String(baseAmountRaw) },
    buyBase: { tokenIn: quoteToken, amountInRaw: String(quoteAmountRaw) },
    interpretation: 'The identical hypothetical order is applied separately before and after each LP event.',
  }
  const actions = replay.steps
    .filter(({ event }) => event.type === 'Mint' || event.type === 'Burn')
    .map(({ event, before, after }) => ({
      event,
      beforeCursor: before.cursor,
      afterCursor: after.cursor,
      priceMovedByLiquidityAction: before.sqrtPriceX96 !== after.sqrtPriceX96,
      activeLiquidityBeforeRaw: before.liquidity,
      activeLiquidityAfterRaw: after.liquidity,
      sellBase: compareOrder(pool, before, after, baseToken, String(baseAmountRaw)),
      buyBase: compareOrder(pool, before, after, quoteToken, String(quoteAmountRaw)),
    }))
  const counts = Object.fromEntries(
    ['Mint', 'Burn', 'Swap', 'Collect'].map((type) => [
      type,
      bundle.events.filter((event) => event.type === type).length,
    ]),
  )
  const endpointQuotes = {
    sellBase: quoteExactInput({ pool, state: replay.state, ...scenario.sellBase }),
    buyBase: quoteExactInput({ pool, state: replay.state, ...scenario.buyBase }),
  }
  const quotes = [
    ...Object.values(endpointQuotes),
    ...actions.flatMap((action) => [
      action.sellBase.before,
      action.sellBase.after,
      action.buyBase.before,
      action.buyBase.after,
    ]),
  ]
  const invalid = quotes.find((quote) => quote.status === 'invalid')
  if (invalid) return { ...evidence, status: 'blocked', issues: [`quote-invalid:${invalid.reason}`] }
  return {
    ...evidence,
    status: 'verified',
    issues: [],
    pool,
    window: { seedBlock: bundle.seed.block, endBlock: bundle.checkpoint.block },
    coverage: bundle.seed.coverage,
    counts,
    scenario,
    actions,
    endpointQuotes,
    limitations: [
      'Only this pool and captured tick coverage are modelled; partial fills are not full-order quotes.',
      'Mint/Burn change liquidity, not spot price. Collect is not inferred selling pressure.',
      'Historical collection became available at fetched time; it is not an as-known-at-event dataset.',
      'No options positioning, arbitrage response, gas, routing, slippage tolerance or global price forecast.',
    ],
  }
}
