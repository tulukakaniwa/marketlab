export const RECOMMENDED_POOL_QUERY_SCHEMA = 'market-lab.recommended-pool-query.v1'
export const RECOMMENDED_POOL_QUERY_FUNCTION = 'weighted-diagnostic-over-canonical-snapshot.v1'

export const DEFAULT_RECOMMENDED_POOL_QUERY_THRESHOLDS = Object.freeze({
  priorityReviewMin: 0.65,
  secondaryReviewMin: 0.4,
})

export const RECOMMENDED_POOL_QUERY_BANDS = Object.freeze([
  Object.freeze({ id: 'priority-review', label: '优先复核' }),
  Object.freeze({ id: 'secondary-review', label: '次级复核' }),
  Object.freeze({ id: 'below-threshold', label: '阈值外' }),
  Object.freeze({ id: 'canonical-gate', label: '门禁隔离' }),
])

const QUERY_ELIGIBLE_STATUSES = new Set(['观察', '等待'])
const CANDIDATE_STATUS_RANK = new Map([
  ['观察', 0],
  ['等待', 1],
  ['剔除', 2],
  ['需刷新数据', 3],
])
const QUERY_BAND_RANK = new Map(RECOMMENDED_POOL_QUERY_BANDS.map((band, index) => [band.id, index]))

export function normalizeRecommendedPoolQueryConfig(spec = {}, policyDimensions = []) {
  const requestedDimensions = Array.isArray(spec.dimensions) ? spec.dimensions : []
  assertDimensionOverrides(requestedDimensions, policyDimensions)
  const requestedById = new Map(requestedDimensions.map((dimension) => [dimension.id, dimension]))
  const dimensions = policyDimensions.map((policy) => normalizeDimension(policy, requestedById.get(policy.id)))
  const thresholds = normalizeThresholds(spec.thresholds)

  return {
    schemaVersion: RECOMMENDED_POOL_QUERY_SCHEMA,
    functionId: RECOMMENDED_POOL_QUERY_FUNCTION,
    dimensions,
    thresholds,
    displayLimit: boundedInteger(spec.displayLimit, 1, 1000, 10),
  }
}

export function configuredDiagnosticRatio(candidate, dimensions) {
  return scoreRecommendedPoolCandidate(candidate, dimensions).ratio
}

export function scoreRecommendedPoolCandidate(candidate, dimensions) {
  const readings = candidate?.diagnosticReadings ?? {}
  const contributions = dimensions
    .filter((dimension) => dimension.queryMutable !== false && dimension.enabled && dimension.weight > 0)
    .map((dimension) => ({ dimension, reading: readings[dimension.id] }))
    .filter(({ reading }) => reading?.availability === 'available' && Number.isFinite(reading.ratio))
    .map(({ dimension, reading }) => ({
      id: dimension.id,
      label: dimension.label,
      ratio: reading.ratio,
      weight: dimension.weight,
      weightedValue: reading.ratio * dimension.weight,
    }))
  const activeWeight = contributions.reduce((sum, contribution) => sum + contribution.weight, 0)
  const weightedValue = contributions.reduce((sum, contribution) => sum + contribution.weightedValue, 0)

  return {
    ratio: activeWeight > 0 ? weightedValue / activeWeight : 0,
    activeWeight,
    contributions,
  }
}

export function runRecommendedPoolQuery(candidates, spec, policyDimensions) {
  const config = normalizeRecommendedPoolQueryConfig(spec, policyDimensions)
  const rows = (Array.isArray(candidates) ? candidates : []).map((candidate) => {
    const diagnostic = scoreRecommendedPoolCandidate(candidate, config.dimensions)
    return {
      candidate,
      diagnostic,
      queryBand: classifyQueryBand(candidate, diagnostic.ratio, config.thresholds),
    }
  })
  const sortedRows = rows.toSorted(compareQueryRows)
  const groups = Object.fromEntries(
    RECOMMENDED_POOL_QUERY_BANDS.map((band) => [band.id, sortedRows.filter((row) => row.queryBand === band.id)]),
  )
  const counts = Object.fromEntries(RECOMMENDED_POOL_QUERY_BANDS.map((band) => [band.id, groups[band.id].length]))

  return {
    schemaVersion: RECOMMENDED_POOL_QUERY_SCHEMA,
    functionId: RECOMMENDED_POOL_QUERY_FUNCTION,
    config,
    counts,
    groups,
    rows: sortedRows,
  }
}

export function rankWithinCandidateStatus(candidates, { mode, dimensions }) {
  const statuses = new Set(candidates.map((candidate) => candidate.candidateStatus))
  if (statuses.size > 1) throw new TypeError('diagnostic ranking cannot cross candidateStatus groups')
  const rows = candidates.map((candidate) => ({
    candidate,
    customScore: configuredDiagnosticRatio(candidate, dimensions),
  }))
  const comparators = {
    canonical: (left, right) => left.candidate.canonicalRank - right.candidate.canonicalRank,
    custom: (left, right) =>
      right.customScore - left.customScore || left.candidate.canonicalRank - right.candidate.canonicalRank,
  }
  return rows.toSorted(comparators[mode] ?? comparators.canonical)
}

export function recommendedPoolQueryDigestPayload(evidenceDigest, result) {
  return {
    schemaVersion: result.schemaVersion,
    evidenceDigest,
    functionId: result.functionId,
    config: result.config,
    result: {
      counts: result.counts,
      rows: result.rows.map(({ candidate, diagnostic, queryBand }) => ({
        symbol: candidate.symbol,
        candidateStatus: candidate.candidateStatus,
        executionStatus: candidate.executionStatus,
        diagnosticRatio: diagnostic.ratio,
        queryBand,
      })),
    },
  }
}

function normalizeDimension(policy, requested = {}) {
  const mutable = policy.queryMutable !== false
  return {
    id: policy.id,
    label: policy.label,
    enabled: mutable && typeof requested.enabled === 'boolean' ? requested.enabled : policy.enabled,
    weight: mutable ? boundedNumber(requested.weight, 0, 50, policy.weight) : policy.weight,
    optional: policy.optional === true,
    queryMutable: mutable,
    rangeCondition: policy.rangeCondition === true,
  }
}

function normalizeThresholds(value = {}) {
  const priorityReviewMin = boundedNumber(
    value.priorityReviewMin,
    0,
    1,
    DEFAULT_RECOMMENDED_POOL_QUERY_THRESHOLDS.priorityReviewMin,
  )
  const secondaryReviewMin = boundedNumber(
    value.secondaryReviewMin,
    0,
    priorityReviewMin,
    DEFAULT_RECOMMENDED_POOL_QUERY_THRESHOLDS.secondaryReviewMin,
  )
  return { priorityReviewMin, secondaryReviewMin }
}

function classifyQueryBand(candidate, ratio, thresholds) {
  const rules = [
    { id: 'canonical-gate', matches: () => !QUERY_ELIGIBLE_STATUSES.has(candidate.candidateStatus) },
    { id: 'priority-review', matches: () => ratio >= thresholds.priorityReviewMin },
    { id: 'secondary-review', matches: () => ratio >= thresholds.secondaryReviewMin },
    { id: 'below-threshold', matches: () => true },
  ]
  return rules.find((rule) => rule.matches()).id
}

function compareQueryRows(left, right) {
  return (
    (QUERY_BAND_RANK.get(left.queryBand) ?? 99) - (QUERY_BAND_RANK.get(right.queryBand) ?? 99) ||
    (CANDIDATE_STATUS_RANK.get(left.candidate.candidateStatus) ?? 99) -
      (CANDIDATE_STATUS_RANK.get(right.candidate.candidateStatus) ?? 99) ||
    right.diagnostic.ratio - left.diagnostic.ratio ||
    left.candidate.canonicalRank - right.candidate.canonicalRank
  )
}

function assertDimensionOverrides(requestedDimensions, policyDimensions) {
  const allowedIds = new Set(policyDimensions.map((dimension) => dimension.id))
  const requestedIds = requestedDimensions.map((dimension) => dimension?.id)
  const unknown = requestedIds.find((id) => !allowedIds.has(id))
  if (unknown) throw new TypeError(`unsupported recommended-pool query dimension: ${unknown}`)
  if (new Set(requestedIds).size !== requestedIds.length) {
    throw new TypeError('recommended-pool query dimensions must be unique')
  }
}

function boundedInteger(value, minimum, maximum, fallback) {
  const number = Math.floor(Number(value))
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback
}

function boundedNumber(value, minimum, maximum, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback
}
