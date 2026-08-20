import { buildScoreConfig, computeBuyScore, deriveRecommendedStockDecisionMetrics } from './recommendedStockPool.js'
import {
  DEFAULT_RECOMMENDED_POOL_QUERY_THRESHOLDS,
  RECOMMENDED_POOL_QUERY_BANDS,
  RECOMMENDED_POOL_QUERY_FUNCTION,
  RECOMMENDED_POOL_QUERY_SCHEMA,
} from './recommendedPoolQuery.js'

export const RECOMMENDED_POOL_REPORT_SCHEMA = 'market-lab.recommended-pool-report.v5'
export const RECOMMENDED_POOL_AGENT_REVIEW_SCHEMA = 'market-lab.recommended-pool-agent-review.v1'
export const RECOMMENDED_POOL_QUERY_REVIEW_SCHEMA = 'market-lab.recommended-pool-query-review.v1'

export const CANDIDATE_STATUS_ORDER = Object.freeze(['观察', '等待', '剔除', '需刷新数据'])

const REPORT_DIMENSION_IDS = Object.freeze([
  'lpValuePercentile',
  'zScore',
  'lpZone',
  'costSlope',
  'halfLife',
  'volConfidence',
  'socialSecurityWhitelist',
])

const AGENT_REVIEW_INSTRUCTIONS = Object.freeze([
  '只使用报告中的 canonical 状态、公式证据和数据来源。',
  '用户函数查询是独立的诊断复核分层，不能替代 canonical 状态。',
  '不得改写 dataState、candidateStatus 或 executionStatus。',
  '缺少账户风险预算、实时盘口或成交输入时，不得生成执行指令。',
  '必须同时写出支持证据、反证和下一次复核条件。',
])

const QUERY_REVIEW_INSTRUCTIONS = Object.freeze([
  '只使用任务中的 canonical 证据、用户函数配置和函数查询结果。',
  '结论必须同时匹配 evidenceDigest 与 queryDigest。',
  '优先复核和次级复核只是诊断分层，不得改写 candidateStatus 或 executionStatus。',
  '缺少账户风险预算、实时盘口或成交输入时，不得生成执行指令。',
  '必须同时写出支持证据、反证和下一次复核条件。',
])

export function diagnosticsFromCanonicalCandidate(candidate) {
  const formula = candidate.formula ?? {}
  const cost = formula.cost ?? {}
  const deviation = formula.deviation ?? {}
  const geometry = formula.syntheticCkGeometry ?? {}
  const meanReversion = formula.meanReversion ?? {}
  const volatility = formula.volConfidence ?? {}

  return {
    price: candidate.close,
    costAnchor: cost.anchor,
    costLow: cost.low,
    costHigh: cost.high,
    costDistance: percentToFraction(cost.distancePct),
    costSlopeRecent: percentToFraction(cost.slopeRecentPct),
    lpZone: geometry.region,
    lpValuePercentile: percentToFraction(geometry.percentilePct),
    zScore: deviation.z,
    deviationPercentile: percentToFraction(deviation.deviationPercentilePct),
    formulaHorizonSessions: deviation.formulaHorizonSessions,
    halfLifeSessions: meanReversion.halfLifeSessions,
    arCoefficient: meanReversion.arCoefficient,
    meanReversionMonotonicGate: isMonotonicMeanReversion(meanReversion),
    tradingDays: meanReversion.sampleSize,
    volSampleQualityScore: volatilityQualityScore(volatility.relativeUncertaintyPct),
    socialSecurityWhitelisted: true,
    anchorDirection: slopeDirection(cost.slopeRecentPct),
    observationDate: candidate.dataThrough,
  }
}

export function createRecommendedPoolEvidence({ screen, latest, diagnosticsBySymbol, dimensions }) {
  assertCanonicalInputs(screen, latest)

  const diagnosticDimensions = dimensions ?? buildReportDimensions()
  const candidates = screen.ranked.map((candidate) => {
    const metrics = diagnosticsBySymbol[candidate.symbol] ?? {}
    const derivedMetrics = deriveRecommendedStockDecisionMetrics(metrics)
    const diagnosticReadings = measureDiagnosticReadings({ ...metrics, ...derivedMetrics }, diagnosticDimensions)

    return {
      symbol: candidate.symbol,
      dataThrough: candidate.dataThrough,
      rows: candidate.rows,
      close: candidate.close,
      dataState: candidate.dataState,
      score: candidate.score,
      scoreStatus: candidate.scoreStatus,
      candidateStatus: candidate.candidateStatus,
      statusReasons: candidate.statusReasons,
      executionStatus: candidate.executionStatus,
      executionReasons: candidate.executionReasons,
      formula: candidate.formula,
      diagnosticReadings,
    }
  })

  return {
    screen: {
      schemaVersion: screen.schemaVersion,
      markets: screen.markets,
      filters: screen.filters,
      freshness: screen.freshness,
      audit: screen.audit,
      stateContract: screen.stateContract,
      researchBoundary: screen.researchBoundary,
    },
    latest: {
      schemaVersion: latest.schemaVersion,
      config: latest.config,
      freshness: latest.freshness,
      audit: latest.audit,
      researchBoundary: latest.researchBoundary,
      signalCount: latest.signals.length,
    },
    dimensions: diagnosticDimensions.map(dimensionMetadata),
    candidates,
  }
}

export function buildRecommendedPoolReport({
  screen,
  latest,
  diagnosticsBySymbol,
  evidenceDigest,
  agentReview,
  generatedAt = new Date().toISOString(),
  topN = 10,
}) {
  assertCanonicalInputs(screen, latest)
  assertEvidenceDigest(evidenceDigest)

  const dimensions = buildReportDimensions()
  const candidatesAll = screen.ranked.map((candidate, canonicalRank) =>
    buildCandidate({
      candidate,
      canonicalRank,
      metrics: diagnosticsBySymbol[candidate.symbol] ?? {},
      dimensions,
    }),
  )
  const statusCounts = countStatuses(candidatesAll)
  const candidateSymbols = new Set(candidatesAll.map((candidate) => candidate.symbol))
  const normalizedAgentReview = normalizeAgentReview(agentReview, evidenceDigest, candidateSymbols)
  const safeTopN = Number.isInteger(topN) && topN > 0 ? topN : 10

  return {
    schemaVersion: RECOMMENDED_POOL_REPORT_SCHEMA,
    generatedAt,
    generatedDate: generatedAt.slice(0, 10),
    evidenceDigest,
    markets: [...screen.markets],
    topN: safeTopN,
    totalCandidates: candidatesAll.length,
    canonicalSummary: {
      filters: screen.filters,
      freshness: screen.freshness,
      audit: screen.audit,
      statusCounts,
      latestSignalCount: latest.signals.length,
      screenSchemaVersion: screen.schemaVersion,
      latestSchemaVersion: latest.schemaVersion,
      researchBoundary: screen.researchBoundary,
      latestResearchBoundary: latest.researchBoundary,
    },
    rankingPolicy: {
      defaultMode: 'canonical',
      configurableMode: 'functional-query-over-canonical-snapshot',
      candidateStatusMutable: false,
      executionStatusMutable: false,
      explanation: '用户配置会重算诊断复核分层和组内顺序，不改变观察、等待、剔除或执行状态。',
      dimensions: dimensions.map(dimensionMetadata),
    },
    queryPolicy: {
      schemaVersion: RECOMMENDED_POOL_QUERY_SCHEMA,
      functionId: RECOMMENDED_POOL_QUERY_FUNCTION,
      defaultThresholds: { ...DEFAULT_RECOMMENDED_POOL_QUERY_THRESHOLDS },
      bands: RECOMMENDED_POOL_QUERY_BANDS.map((band) => ({ ...band })),
      eligibleCandidateStatuses: ['观察', '等待'],
      immutableFields: ['dataState', 'scoreStatus', 'candidateStatus', 'executionStatus'],
      explanation: '函数查询只对通过数据门禁的观察和等待项做复核分层；剔除和需刷新数据始终隔离。',
    },
    agentReview: normalizedAgentReview,
    agentReviewRequest: {
      schemaVersion: RECOMMENDED_POOL_AGENT_REVIEW_SCHEMA,
      evidenceDigest,
      instructions: [...AGENT_REVIEW_INSTRUCTIONS],
      compatibleAgents: ['Codex', 'Claude Code', '其他可输出合同 JSON 的 LLM Agent'],
      outputFields: ['schemaVersion', 'evidenceDigest', 'generatedAt', 'agent', 'conclusion'],
    },
    queryReviewRequest: {
      schemaVersion: RECOMMENDED_POOL_QUERY_REVIEW_SCHEMA,
      instructions: [...QUERY_REVIEW_INSTRUCTIONS],
      compatibleAgents: ['Codex', 'Claude Code', '其他可输出合同 JSON 的 LLM Agent'],
      outputFields: ['schemaVersion', 'evidenceDigest', 'queryDigest', 'generatedAt', 'agent', 'conclusion'],
    },
    candidatesAll,
    focusItems: candidatesAll.filter(hasStatus('观察')).slice(0, safeTopN),
    waitItems: candidatesAll.filter(hasStatus('等待')).slice(0, safeTopN),
  }
}

function buildReportDimensions() {
  const configured = buildScoreConfig([
    { id: 'halfLife', enabled: true },
    { id: 'volConfidence', enabled: true },
  ])
  return configured
    .filter((dimension) => REPORT_DIMENSION_IDS.includes(dimension.id))
    .map((dimension) =>
      dimension.id === 'socialSecurityWhitelist'
        ? { ...dimension, enabled: false, queryMutable: false, rangeCondition: true }
        : { ...dimension, queryMutable: true, rangeCondition: false },
    )
}

function buildCandidate({ candidate, canonicalRank, metrics, dimensions }) {
  const derivedMetrics = deriveRecommendedStockDecisionMetrics(metrics)
  const completeMetrics = { ...metrics, ...derivedMetrics }
  const diagnostic = computeBuyScore(completeMetrics, { dimensions })
  const ratio = diagnostic.maxScore > 0 ? diagnostic.score / diagnostic.maxScore : 0
  const diagnosticReadings = measureDiagnosticReadings(completeMetrics, dimensions)

  return {
    ...candidate,
    canonicalRank,
    diagnosticRanking: {
      score: diagnostic.score,
      maxScore: diagnostic.maxScore,
      ratio,
      hits: diagnostic.hits,
      semantics: 'default-diagnostic-score-over-fixed-canonical-state',
    },
    diagnosticReadings,
  }
}

function measureDiagnosticReadings(metrics, dimensions) {
  const measurementDimensions = dimensions.map((dimension) => ({ ...dimension, enabled: true, weight: 1 }))
  const measured = computeBuyScore(metrics, { dimensions: measurementDimensions })
  return Object.fromEntries(
    dimensions.map((dimension) => {
      const value = measured.dimensions[dimension.id]
      const available = value && !value.missing && !value.forbidden && Number.isFinite(value.ratio)
      return [
        dimension.id,
        {
          ratio: available ? value.ratio : null,
          availability: available ? 'available' : 'missing',
        },
      ]
    }),
  )
}

function normalizeAgentReview(review, evidenceDigest, candidateSymbols) {
  const pending = {
    status: 'pending',
    evidenceDigest,
    message: '尚未接入与当前证据摘要匹配的 LLM Agent 复核产物。',
    conclusion: null,
  }
  if (!review) return pending

  const schemaMatches = review.schemaVersion === RECOMMENDED_POOL_AGENT_REVIEW_SCHEMA
  const evidenceMatches = review.evidenceDigest === evidenceDigest
  const agentName = String(review.agent?.name ?? '').trim()
  const summary = String(review.conclusion?.summary ?? '').trim()
  const generatedAt = String(review.generatedAt ?? '').trim()
  const supportingEvidence = stringList(review.conclusion?.supportingEvidence)
  const counterEvidence = stringList(review.conclusion?.counterEvidence)
  const nextReview = stringList(review.conclusion?.nextReview)
  const contractReady =
    schemaMatches &&
    evidenceMatches &&
    agentName &&
    summary &&
    Number.isFinite(Date.parse(generatedAt)) &&
    supportingEvidence.length > 0 &&
    counterEvidence.length > 0 &&
    nextReview.length > 0

  if (!contractReady) {
    return {
      ...pending,
      status: 'stale-or-invalid',
      message: '已有 Agent 产物与当前证据合同不匹配，页面不会采用其中的结论。',
    }
  }

  return {
    status: 'reviewed',
    evidenceDigest,
    generatedAt,
    agent: {
      name: agentName,
      runtime: String(review.agent?.runtime ?? '').trim(),
    },
    conclusion: {
      summary,
      supportingEvidence,
      counterEvidence,
      nextReview,
      watchlist: normalizeWatchlist(review.conclusion.watchlist, candidateSymbols),
    },
  }
}

function normalizeWatchlist(value, candidateSymbols) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => ({
      symbol: String(item?.symbol ?? '').trim(),
      note: String(item?.note ?? '').trim(),
    }))
    .filter((item) => item.symbol && item.note && candidateSymbols.has(item.symbol))
}

function stringList(value) {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item).trim()).filter(Boolean)
}

function countStatuses(candidates) {
  const counts = Object.fromEntries(CANDIDATE_STATUS_ORDER.map((status) => [status, 0]))
  for (const candidate of candidates) {
    const current = counts[candidate.candidateStatus] ?? 0
    counts[candidate.candidateStatus] = current + 1
  }
  return counts
}

function hasStatus(status) {
  return (candidate) => candidate.candidateStatus === status
}

function dimensionMetadata(dimension) {
  return {
    id: dimension.id,
    label: dimension.label,
    weight: dimension.weight,
    enabled: dimension.enabled,
    optional: dimension.optional === true,
    queryMutable: dimension.queryMutable !== false,
    rangeCondition: dimension.rangeCondition === true,
  }
}

function assertCanonicalInputs(screen, latest) {
  if (!Array.isArray(screen?.ranked)) throw new TypeError('screen.ranked must be an array')
  if (!Array.isArray(screen?.markets) || screen.markets.length !== 1 || screen.markets[0] !== 'A股') {
    throw new TypeError('recommended pool report requires the canonical A-share screen')
  }
  const requiredScreenFilters = [
    'requireShebaoForAshareOnly',
    'excludeAlcohol',
    'excludeBanks',
    'excludeRealestate',
    'excludeNortheast',
  ]
  const screenFiltersReady = requiredScreenFilters.every((field) => screen.filters?.[field] === true)
  if (!screenFiltersReady) throw new TypeError('recommended pool report requires every canonical A-share filter')
  if (!Array.isArray(latest?.signals)) throw new TypeError('latest.signals must be an array')
  const latestConfigReady =
    latest.config?.profile === 'combo' &&
    latest.config?.mode === 'latest' &&
    latest.config?.market === 'A股' &&
    latest.config?.requireShebao === true
  if (!latestConfigReady) throw new TypeError('recommended pool report requires canonical combo/latest inputs')
}

function assertEvidenceDigest(value) {
  if (!/^[a-f0-9]{64}$/.test(String(value ?? ''))) {
    throw new TypeError('evidenceDigest must be a SHA-256 hex digest')
  }
}

function isMonotonicMeanReversion(value) {
  return (
    value.isMeanReverting === true &&
    value.decayMode === 'monotonic-decay' &&
    Number.isFinite(value.arCoefficient) &&
    value.arCoefficient > 0 &&
    value.arCoefficient < 1
  )
}

function volatilityQualityScore(relativeUncertaintyPct) {
  const value = Number(relativeUncertaintyPct)
  if (!Number.isFinite(value)) return null
  if (value <= 10) return 1
  if (value <= 20) return 0.7
  if (value <= 30) return 0.4
  return 0.1
}

function slopeDirection(slopePct) {
  const value = Number(slopePct)
  if (!Number.isFinite(value)) return null
  if (value >= 0.3) return 'up'
  if (value <= -0.3) return 'down'
  return 'flat'
}

function percentToFraction(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number / 100 : null
}
