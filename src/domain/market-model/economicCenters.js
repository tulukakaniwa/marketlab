export const ECONOMIC_CENTER_DEFAULTS = Object.freeze({ lookback: 120, maximumLookback: 1024 })

const SOURCES = Object.freeze({
  vwap: 'https://www.nyse.com/publicdocs/nyse/data/Volume_Summary_Client_Spec_v1.1c.pdf',
  supplyDemand:
    'https://openstax.org/books/principles-macroeconomics-3e/pages/3-1-demand-supply-and-equilibrium-in-markets-for-goods-and-services',
  gordon: 'https://pages.stern.nyu.edu/adamodar/New_Home_Page/lectures/ddm.html',
})

/** Independent meanings: transaction centroid, assumed cohorts, clearing scenario, dividend valuation. */
export function queryEconomicCenters(params = {}) {
  const context = observationContext(params)
  return {
    asOfDate: context.date,
    availableAt: context.date ? `${context.date}:close` : null,
    formulas: {
      vwapCost: queryVwapCostProxy(params),
      cohortCost: queryCohortTurnoverCostProxy(params),
      supplyDemand: queryLinearSupplyDemandClearing(params),
      fundamental: queryGordonValue(params),
    },
    executionAuthority: 'none',
    futureRowsUsed: false,
  }
}

/** O(n * lookback + float observations); each point owns its bounded historical window. */
export function buildEconomicCostPath(rows, options = {}) {
  if (!Array.isArray(rows)) return []
  const floatIndex = indexFloat(options.freeFloat)
  return Array.from(rows, (row, observationIndex) => {
    const params = { ...options, rows, observationIndex, observationDate: row?.date }
    const vwapCost = queryVwapCostProxy(params)
    const cohortCost = cohortQuery(params, floatIndex)
    return {
      date: row?.date ?? null,
      vwapCostPrice: vwapCost.value,
      cohortCostPrice: cohortCost.value,
      vwapCost,
      cohortCost,
    }
  })
}

export function queryVwapCostProxy(params = {}) {
  const context = observationContext(params)
  const result = base('vwap-cost-proxy', context, params.units?.price)
  const basis = priceBasis(context.rows, params.basis)
  result.basis = basis
  result.source = {
    kind: basis === 'amount-volume' ? 'amount-volume' : 'hlc3-volume',
    label: basis === 'amount-volume' ? '成交额/成交量重心' : 'HLC3×成交量代理',
    note: '成交量重心，不是真实持仓成本',
    reference: SOURCES.vwap,
  }
  result.assumptions = [
    'The declared window is a traded-volume centroid, not observed investor positions or holding cost.',
    'Typical-price weighting approximates trade prices; OHLCV alone cannot recover trade-level VWAP.',
    'Converted daily amounts and OHLC must share currency, per-unit and adjustment basis; the daily weighted mean lies in its traded price range.',
  ]
  if (context.reason) return unavailable(result, context.reason, context.status)
  const prices = checkedPrices(context.rows, params, basis)
  if (prices.reason) return unavailable(result, prices.reason, prices.status)
  let volume = 0,
    weightedPrice = 0
  for (const point of prices.points) {
    const nextVolume = volume + point.volume
    if (!Number.isFinite(nextVolume)) return unavailable(result, 'finite-total-volume', 'invalid-input')
    // Online weighted mean avoids an unnecessary price * cumulative-volume overflow.
    weightedPrice += (point.price - weightedPrice) * (point.volume / nextVolume)
    volume = nextVolume
  }
  if (!volume) return unavailable(result, 'positive-traded-volume')
  return ready(result, weightedPrice, 'observed-proxy', 'volume-centroid-proxy', { tradedVolume: volume })
}

export function queryCohortTurnoverCostProxy(params = {}) {
  return cohortQuery(params, indexFloat(params.freeFloat))
}

function cohortQuery(params, floatIndex) {
  const context = observationContext(params)
  const result = base('cohort-turnover-cost-proxy', context, params.units?.price)
  result.basis = priceBasis(context.rows, params.basis)
  result.source = {
    kind: 'observed-float-with-declared-replacement-model',
    label: '已知流通股本·随机换手代理',
    note: '条件成交批次成本，初始持仓成本未知',
    source: params.freeFloat?.provenance?.source ?? null,
    asOfDate: params.freeFloat?.provenance?.asOfDate ?? null,
    availableAt: params.freeFloat?.provenance?.availableAt ?? null,
    priceBasis: result.basis,
  }
  result.assumptions = [
    'Random replacement alpha = 1 - exp(-traded shares / same-day free-float shares) is an assumption, not observed unique turnover.',
    'Value is conditional cost of modeled traded cohorts; the unobserved initial inventory cost remains unknown.',
    'All cohorts use the same declared price basis, units and share population; no corporate-action adjustment is inferred.',
  ]
  if (context.reason) return unavailable(result, context.reason, context.status)
  const float = params.freeFloat
  if (!float) return unavailable(result, 'freeFloat')
  if (!nonempty(params.units?.volume) || float.volumeUnit !== params.units.volume || float.unit !== 'shares')
    return unavailable(result, 'freeFloat.volumeUnit/units.volume/unit', 'invalid-input')
  if (!positive(float.volumeToShares)) return unavailable(result, 'freeFloat.volumeToShares')
  const proof = provenanceReason(float.provenance, context.rows[0]?.date ?? context.date, true)
  if (proof) return unavailable(result, `freeFloat.${proof}`, 'invalid-input')
  const prices = checkedPrices(context.rows, params, result.basis)
  if (prices.reason) return unavailable(result, prices.reason, prices.status)
  if (floatIndex.reason) return unavailable(result, floatIndex.reason, 'invalid-input')
  let coverage = 0,
    cost = 0
  for (const point of prices.points) {
    const observed = floatIndex.byDate.get(point.date)
    if (floatIndex.byDate.has(point.date) && !observed)
      return unavailable(result, `freeFloat.observations.${point.date}.unique-date`, 'invalid-input')
    if (!observed || !positive(observed.value)) return unavailable(result, `freeFloat.observations.${point.date}`)
    const reason = provenanceReason(observed.provenance, point.date, true)
    if (reason || observed.provenance.asOfDate !== point.date)
      return unavailable(
        result,
        `freeFloat.observations.${point.date}.${reason ?? 'same-day-asOfDate'}`,
        'invalid-input',
      )
    const shares = point.volume * float.volumeToShares
    if (!Number.isFinite(shares)) return unavailable(result, 'finite-converted-volume', 'invalid-input')
    const alpha = -Math.expm1(-shares / observed.value)
    const nextCoverage = coverage + (1 - coverage) * alpha
    if (nextCoverage) cost += (point.price - cost) * (alpha / nextCoverage)
    coverage = nextCoverage
  }
  if (!coverage) return unavailable(result, 'positive-traded-volume')
  return ready(result, cost, 'assumed-cohort-proxy', 'turnover-cohort-proxy', {
    coverage,
    unknownFraction: Math.max(0, 1 - coverage),
    replacementModel: 'poisson-random-replacement',
  })
}

export function queryLinearSupplyDemandClearing(params = {}) {
  const context = observationContext(params)
  const input = params.supplyDemand
  const result = base('linear-supply-demand-clearing', context, input?.priceUnit)
  result.equation = 'Qd = a - bP; Qs = c + dP; P* = (a-c)/(b+d)'
  result.source = {
    ...input?.provenance,
    source: input?.provenance?.source ?? 'user-declared-scenario',
    label: input?.provenance?.kind === 'observed' ? '时点可知的外部供需曲线' : '线性供需情景',
    reference: SOURCES.supplyDemand,
  }
  result.assumptions = [
    'Conditional clearing of the supplied linear schedules; OHLCV does not identify demand or supply curves.',
  ]
  if (context.reason) return unavailable(result, context.reason, context.status)
  if (!input) return unavailable(result, 'supplyDemand')
  const missing = ['a', 'b', 'c', 'd'].filter((key) => !Number.isFinite(input[key]))
  if (missing.length)
    return unavailable(
      result,
      missing.map((key) => `supplyDemand.${key}`),
    )
  if (!nonempty(input.quantityUnit) || !nonempty(input.priceUnit)) return unavailable(result, 'supplyDemand.units')
  const proof = provenanceReason(input.provenance, context.date)
  if (proof) return unavailable(result, `supplyDemand.${proof}`, 'invalid-input')
  if (!positive(input.b) || !positive(input.d))
    return unavailable(result, 'positive-demand-and-supply-slopes', 'invalid-input')
  const value = (input.a - input.c) / (input.b + input.d)
  const quantity = input.a - input.b * value
  if (!positive(value) || !Number.isFinite(quantity) || quantity < 0)
    return unavailable(result, 'positive-price/nonnegative-quantity-intersection', 'invalid-input')
  return ready(result, value, input.provenance.kind, 'conditional-structural-clearing', {
    quantity,
    quantityUnit: input.quantityUnit,
    inputSemantics: 'externally-supplied-schedules',
  })
}

export function queryGordonValue(params = {}) {
  const context = observationContext(params)
  const input = params.gordon
  const result = base('gordon-value', context, input?.priceUnit)
  result.equation = 'P = expected D_next / (r-g)'
  result.source = {
    ...input?.provenance,
    source: input?.provenance?.source ?? 'user-declared-scenario',
    label: input?.provenance?.kind === 'observed' ? '时点可知的股息预期' : '股息永续情景',
    reference: SOURCES.gordon,
  }
  result.assumptions = [
    'Next dividend is an as-of expectation, including for an observed forecast; it is not a future realized dividend.',
    'Constant perpetual dividend growth and required return use the same declared period and currency.',
    'The stable-growth valuation is conditional; it is not a market-clearing price or verified fair value.',
  ]
  if (context.reason) return unavailable(result, context.reason, context.status)
  if (!input) return unavailable(result, 'gordon')
  const missing = ['nextDividend', 'requiredReturn', 'growthRate'].filter((key) => !Number.isFinite(input[key]))
  if (missing.length)
    return unavailable(
      result,
      missing.map((key) => `gordon.${key}`),
    )
  if (!nonempty(input.period) || !nonempty(input.priceUnit)) return unavailable(result, 'gordon.period/priceUnit')
  const proof = provenanceReason(input.provenance, context.date)
  if (proof) return unavailable(result, `gordon.${proof}`, 'invalid-input')
  if (input.dividendBasis !== 'expected-next-period')
    return unavailable(result, 'gordon.expected-next-period-dividend', 'invalid-input')
  if (input.nextDividend < 0 || input.growthRate <= -1 || input.requiredReturn <= input.growthRate)
    return unavailable(result, 'nonnegative-dividend/growth-above-minus-one/r-g-positive', 'invalid-input')
  return ready(
    result,
    input.nextDividend / (input.requiredReturn - input.growthRate),
    input.provenance.kind,
    'conditional-fundamental-value',
    {
      period: input.period,
      inputSemantics: 'expected-next-period-dividend',
    },
  )
}

function base(id, context, unit = 'price') {
  return {
    id,
    state: 'missing',
    status: 'missing-input',
    missingInputs: [],
    value: null,
    unit: nonempty(unit) ? unit : 'price',
    source: null,
    claimClass: 'missing-input',
    executionAuthority: 'none',
    asOfDate: context.date,
    availableAt: context.date ? `${context.date}:close` : null,
    futureRowsUsed: false,
    window: { lookback: context.lookback, startDate: context.rows[0]?.date ?? null, observations: context.rows.length },
  }
}

function ready(result, value, state, claimClass, extra = {}) {
  if (!Number.isFinite(value)) return unavailable(result, 'finite-result', 'invalid-input')
  return { ...result, ...extra, value, state, claimClass, status: 'ready' }
}

function unavailable(result, inputs, status = 'missing-input') {
  return {
    ...result,
    status,
    state: status === 'missing-input' ? 'missing' : 'invalid',
    missingInputs: [inputs].flat(),
  }
}

function observationContext({ rows = [], observationIndex, observationDate, lookback = 120 }) {
  const context = { rows: [], date: observationDate ?? null, lookback, reason: null, status: 'invalid-input' }
  if (!Number.isInteger(lookback) || lookback < 1 || lookback > ECONOMIC_CENTER_DEFAULTS.maximumLookback)
    return { ...context, reason: 'lookback-in-[1,1024]' }
  if (observationDate !== undefined && !validDate(observationDate))
    return { ...context, reason: 'valid-observation-date' }
  if (!Array.isArray(rows)) return { ...context, reason: 'rows-array' }
  let index = observationIndex ?? rows.length - 1
  if (observationIndex === undefined && observationDate) {
    index = -1
    for (let cursor = 0; cursor < rows.length; cursor++) {
      if (rows[cursor]?.date > observationDate) break
      index = cursor
    }
  }
  if (!rows.length && observationIndex === undefined) {
    if (!context.date) context.reason = 'observationDate'
    context.status = 'missing-input'
    return context
  }
  if (!Number.isInteger(index) || index < 0 || index >= rows.length)
    return { ...context, reason: 'valid-observation-index' }
  context.date ??= rows[index]?.date
  if (!validDate(context.date)) return { ...context, reason: 'valid-observation-date' }
  context.rows = rows.slice(Math.max(0, index - lookback + 1), index + 1)
  let previousDate = null
  for (const row of context.rows) {
    if (!validDate(row?.date) || row.date > context.date || (previousDate && row.date <= previousDate))
      return { ...context, reason: 'ordered-closed-prefix-dates' }
    if (row.isClosed === false || row.closed === false) return { ...context, reason: 'closed-bars-only' }
    if (row.availableAt !== undefined && !knownAt(row.availableAt, row.date))
      return { ...context, reason: 'bar-not-available-at-close' }
    previousDate = row.date
  }
  return context
}

function priceBasis(rows, requested = 'auto') {
  return requested === 'auto'
    ? rows.some((row) => row && Object.hasOwn(row, 'amount'))
      ? 'amount-volume'
      : 'typical-price'
    : requested
}

function checkedPrices(rows, params, basis) {
  if (!['amount-volume', 'typical-price'].includes(basis)) return { reason: 'price-basis', status: 'invalid-input' }
  if (!rows.length) return { reason: 'closed-price-history', status: 'missing-input' }
  if (basis === 'amount-volume' && !positive(params.units?.amountPerVolumeToPrice))
    return { reason: 'units.amountPerVolumeToPrice', status: 'missing-input' }
  const points = []
  for (const row of rows) {
    if (!Number.isFinite(row.volume) || row.volume < 0)
      return { reason: 'nonnegative-finite-volume', status: 'invalid-input' }
    if (!row.volume) continue
    const price =
      basis === 'amount-volume'
        ? (row.amount / row.volume) * params.units.amountPerVolumeToPrice
        : (row.high + row.low + row.close) / 3
    if (basis === 'amount-volume' && !Number.isFinite(row.amount))
      return { reason: 'amount-for-each-traded-bar', status: 'missing-input' }
    if (!positive(price)) return { reason: 'positive-finite-traded-price', status: 'invalid-input' }
    if (![row.high, row.low, row.close].every(positive) || row.low > row.close || row.close > row.high)
      return { reason: 'valid-high-low-close', status: 'invalid-input' }
    // NYSE's positive trade-volume weights make daily VWAP a convex average of
    // trade prices. A price outside the same-basis low/high cannot be that VWAP.
    const tolerance = 1e-10 * Math.max(row.low, row.high, price)
    if (basis === 'amount-volume' && (row.low - price > tolerance || price - row.high > tolerance))
      return { reason: 'amount-price-basis-mismatch', status: 'invalid-input' }
    points.push({ date: row.date, price, volume: row.volume })
  }
  return { points }
}

function indexFloat(float) {
  const byDate = new Map()
  if (float?.observations !== undefined && !Array.isArray(float.observations))
    return { byDate, reason: 'freeFloat.observations-array' }
  for (const observed of float?.observations ?? []) {
    // Invalid/future entries cannot invalidate a prior point which never consumes them.
    if (!validDate(observed?.date)) continue
    // Each record is consumed only at its own session close. A valid later
    // availability token is unavailable then; malformed proof is not ignored.
    const available = availabilityDate(observed.provenance?.availableAt)
    if (available !== null && available > observed.date) continue
    byDate.set(observed.date, byDate.has(observed.date) ? null : observed)
  }
  return { byDate }
}

function provenanceReason(provenance, date, observedOnly = false) {
  if (!provenance || !(observedOnly ? ['observed'] : ['observed', 'scenario']).includes(provenance.kind))
    return 'provenance.kind'
  if (provenance.kind === 'observed' && !nonempty(provenance.source)) return 'provenance.source'
  if (!validDate(provenance.asOfDate) || provenance.asOfDate > date) return 'provenance.asOfDate'
  if (!knownAt(provenance.availableAt, date) || provenance.availableAt.slice(0, 10) < provenance.asOfDate)
    return 'provenance.availableAt'
  return null
}

// Availability uses the project's explicit session-close token, never wall-clock inference.
function knownAt(availableAt, date) {
  const available = availabilityDate(availableAt)
  return available !== null && available <= date
}

function availabilityDate(availableAt) {
  return typeof availableAt === 'string' &&
    availableAt === `${availableAt.slice(0, 10)}:close` &&
    validDate(availableAt.slice(0, 10))
    ? availableAt.slice(0, 10)
    : null
}

function validDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const stamp = Date.parse(`${date}T00:00:00Z`)
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === date
}

function positive(value) {
  return Number.isFinite(value) && value > 0
}

function nonempty(value) {
  return typeof value === 'string' && Boolean(value.trim())
}
