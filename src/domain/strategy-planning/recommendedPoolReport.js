import { buildScoreConfig, computeBuyScore, deriveRecommendedStockDecisionMetrics } from './recommendedStockPool.js'

export const RECOMMENDED_POOL_REPORT_SCHEMA = 'market-lab.recommended-pool-report.v4'
export const RECOMMENDED_POOL_AGENT_REVIEW_SCHEMA = 'market-lab.recommended-pool-agent-review.v1'

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
  '自定义诊断排序只能改变同一 candidateStatus 内的复核顺序。',
  '不得改写 dataState、candidateStatus 或 executionStatus。',
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
    const diagnostic = computeBuyScore({ ...metrics, ...derivedMetrics }, { dimensions: diagnosticDimensions })

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
      diagnostic: compactDiagnostic(diagnostic),
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
      configurableMode: 'diagnostic-within-status',
      candidateStatusMutable: false,
      executionStatusMutable: false,
      explanation: '用户配置只调整同一门禁状态内的诊断排序，不改变观察、等待、剔除或执行状态。',
      dimensions: dimensions.map(dimensionMetadata),
    },
    agentReview: normalizedAgentReview,
    agentReviewRequest: {
      schemaVersion: RECOMMENDED_POOL_AGENT_REVIEW_SCHEMA,
      evidenceDigest,
      instructions: [...AGENT_REVIEW_INSTRUCTIONS],
      compatibleAgents: ['Codex', 'Claude Code', '其他可输出合同 JSON 的 LLM Agent'],
      outputFields: ['schemaVersion', 'evidenceDigest', 'generatedAt', 'agent', 'conclusion'],
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
  return configured.filter((dimension) => REPORT_DIMENSION_IDS.includes(dimension.id))
}

function buildCandidate({ candidate, canonicalRank, metrics, dimensions }) {
  const derivedMetrics = deriveRecommendedStockDecisionMetrics(metrics)
  const completeMetrics = { ...metrics, ...derivedMetrics }
  const diagnostic = computeBuyScore(completeMetrics, { dimensions })
  const ratio = diagnostic.maxScore > 0 ? diagnostic.score / diagnostic.maxScore : 0

  return {
    ...candidate,
    canonicalRank,
    diagnosticRanking: {
      score: diagnostic.score,
      maxScore: diagnostic.maxScore,
      ratio,
      dimensions: diagnostic.dimensions,
      hits: diagnostic.hits,
      semantics: 'configurable-diagnostic-order-within-fixed-candidate-status',
    },
  }
}

function compactDiagnostic(diagnostic) {
  return {
    score: diagnostic.score,
    maxScore: diagnostic.maxScore,
    dimensions: Object.fromEntries(
      Object.entries(diagnostic.dimensions).map(([id, value]) => [
        id,
        {
          ratio: value.ratio,
          missing: value.missing === true,
          disabled: value.disabled === true,
        },
      ]),
    ),
  }
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
