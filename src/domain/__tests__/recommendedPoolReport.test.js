import { describe, expect, it } from 'vitest'

import {
  RECOMMENDED_POOL_AGENT_REVIEW_SCHEMA,
  buildRecommendedPoolReport,
  createRecommendedPoolEvidence,
  diagnosticsFromCanonicalCandidate,
} from '../strategy-planning/recommendedPoolReport.js'
import {
  configuredDiagnosticRatio,
  normalizeRecommendedPoolQueryConfig,
  rankWithinCandidateStatus,
  runRecommendedPoolQuery,
} from '../strategy-planning/recommendedPoolQuery.js'

const DIGEST = 'a'.repeat(64)
const candidate = {
  symbol: '600085',
  label: '同仁堂',
  name: '同仁堂',
  nameSource: 'stock-index',
  market: 'A股',
  source: 'BaoStock / AkShare',
  dataThrough: '2026-08-19',
  rows: 1364,
  close: 24.06,
  staleDays: 1,
  freshness: { status: 'current-enough-for-research' },
  dataState: 'provisional',
  dataStateReasons: ['local-daily-ohlcv-path-only'],
  score: 60,
  scoreStatus: 'diagnostic-medium',
  candidateStatus: '等待',
  statusReasons: ['phase-falling-expansion-not-observation-gate'],
  executionStatus: 'blocked',
  executionReasons: ['local-daily-ohlcv-only'],
  formula: {
    cost: { anchor: 25.107, low: 23.911, high: 26.302, distancePct: -4.17, slopeRecentPct: 1.19 },
    deviation: { z: -0.35, formulaHorizonSessions: 37, deviationPercentilePct: 27.6 },
    syntheticCkGeometry: { region: 'token0', percentilePct: 23.8 },
    meanReversion: {
      halfLifeSessions: 11.01,
      arCoefficient: 0.938997,
      isMeanReverting: true,
      decayMode: 'monotonic-decay',
      sampleSize: 575,
    },
    volConfidence: { relativeUncertaintyPct: 11.79 },
    dynamicHolding: { phase: 'falling-expansion', blockedReasons: ['drawdown-expanding'] },
    orderPlan: { blockedReasons: ['当前没有方向明确的结构信号'] },
  },
}
const screen = {
  schemaVersion: 'china-stock-selection.screen.v3',
  markets: ['A股'],
  filters: {
    requireShebaoForAshareOnly: true,
    excludeAlcohol: true,
    excludeBanks: true,
    excludeRealestate: true,
    excludeNortheast: true,
  },
  freshness: { newestDataThrough: '2026-08-19', staleCandidates: 0 },
  audit: { considered: 316, dataReady: 1, emitted: 1, skipped: 315 },
  stateContract: {
    dataState: ['ready', 'provisional', 'stale', 'invalid'],
    candidateStatus: ['需刷新数据', '剔除', '等待', '观察'],
    executionStatus: ['blocked'],
  },
  researchBoundary: { status: 'research-only', executionStatus: 'blocked' },
  ranked: [candidate],
}
const latest = {
  schemaVersion: 'china-stock-selection.replay.v4',
  config: { profile: 'combo', mode: 'latest', market: 'A股', requireShebao: true },
  freshness: { newestDataThrough: '2026-08-19' },
  audit: { considered: 316, dataReady: 77, emitted: 0 },
  researchBoundary: { status: 'latest-observation-only', executionStatus: 'blocked' },
  signals: [],
}
const diagnosticsBySymbol = {
  600085: {
    price: 24.06,
    costAnchor: 25.107,
    costLow: 23.911,
    costHigh: 26.302,
    costDistance: -0.0417,
    costSlopeRecent: 0.0119,
    lpZone: 'token0',
    lpValuePercentile: 0.238,
    zScore: -0.35,
    formulaHorizonSessions: 37,
    halfLifeSessions: 11.01,
    meanReversionMonotonicGate: true,
    tradingDays: 575,
    volSampleQualityScore: 0.7,
    socialSecurityWhitelisted: true,
  },
}

describe('recommended pool report contract', () => {
  it('keeps canonical candidate and execution states even when diagnostics are configurable', () => {
    const report = buildRecommendedPoolReport({ screen, latest, diagnosticsBySymbol, evidenceDigest: DIGEST })
    const result = report.candidatesAll[0]

    expect(result.diagnosticRanking.ratio).toBeGreaterThan(0)
    expect(result.candidateStatus).toBe('等待')
    expect(result.executionStatus).toBe('blocked')
    expect(report.canonicalSummary.statusCounts).toMatchObject({ 观察: 0, 等待: 1, 剔除: 0, 需刷新数据: 0 })
    expect(report.focusItems).toEqual([])
    expect(report.waitItems).toHaveLength(1)
    expect(report.rankingPolicy.candidateStatusMutable).toBe(false)
  })

  it('creates stable agent evidence without generation timestamps', () => {
    const evidence = createRecommendedPoolEvidence({ screen, latest, diagnosticsBySymbol })
    expect(evidence.screen).not.toHaveProperty('generatedAt')
    expect(evidence.candidates[0]).toMatchObject({
      symbol: '600085',
      candidateStatus: '等待',
      executionStatus: 'blocked',
    })
  })

  it('projects configurable diagnostics from the same canonical formula payload', () => {
    const diagnostics = diagnosticsFromCanonicalCandidate(candidate)
    expect(diagnostics).toMatchObject({
      price: 24.06,
      costDistance: -0.0417,
      lpZone: 'token0',
      meanReversionMonotonicGate: true,
      socialSecurityWhitelisted: true,
    })
    expect(diagnostics.lpValuePercentile).toBeCloseTo(0.238)
  })

  it('accepts only an Agent review bound to the current evidence digest', () => {
    const matchingReview = {
      schemaVersion: RECOMMENDED_POOL_AGENT_REVIEW_SCHEMA,
      evidenceDigest: DIGEST,
      generatedAt: '2026-08-20T06:00:00.000Z',
      agent: { name: 'Codex', runtime: 'desktop' },
      conclusion: {
        summary: '本轮没有通过观察门禁的标的。',
        supportingEvidence: ['观察状态为零。'],
        counterEvidence: ['执行输入缺失。'],
        nextReview: ['下一根完整日线后复核。'],
      },
    }
    const reviewed = buildRecommendedPoolReport({
      screen,
      latest,
      diagnosticsBySymbol,
      evidenceDigest: DIGEST,
      agentReview: matchingReview,
    })
    const stale = buildRecommendedPoolReport({
      screen,
      latest,
      diagnosticsBySymbol,
      evidenceDigest: DIGEST,
      agentReview: { ...matchingReview, evidenceDigest: 'b'.repeat(64) },
    })

    expect(reviewed.agentReview).toMatchObject({ status: 'reviewed', agent: { name: 'Codex' } })
    expect(stale.agentReview).toMatchObject({ status: 'stale-or-invalid', conclusion: null })
  })

  it('applies custom weights only as a diagnostic order inside the supplied status group', () => {
    const report = buildRecommendedPoolReport({ screen, latest, diagnosticsBySymbol, evidenceDigest: DIGEST })
    const dimensions = report.rankingPolicy.dimensions
    const original = report.candidatesAll[0]
    const second = { ...original, symbol: '600930', canonicalRank: 1 }
    const ranked = rankWithinCandidateStatus([second, original], { mode: 'canonical', dimensions })

    expect(configuredDiagnosticRatio(original, dimensions)).toBeGreaterThan(0)
    expect(ranked.map(({ candidate: item }) => item.symbol)).toEqual(['600085', '600930'])
    expect(ranked.every(({ candidate: item }) => item.candidateStatus === '等待')).toBe(true)
    expect(() =>
      rankWithinCandidateStatus([{ ...original, candidateStatus: '观察' }, second], {
        mode: 'custom',
        dimensions,
      }),
    ).toThrow('cannot cross candidateStatus groups')
  })

  it('keeps raw diagnostic readings available when a dimension is disabled by default', () => {
    const report = buildRecommendedPoolReport({ screen, latest, diagnosticsBySymbol, evidenceDigest: DIGEST })
    const result = report.candidatesAll[0]
    const socialPolicy = report.rankingPolicy.dimensions.find((dimension) => dimension.id === 'socialSecurityWhitelist')

    expect(result.diagnosticReadings.socialSecurityWhitelist).toEqual({
      ratio: 1,
      availability: 'available',
    })
    expect(socialPolicy).toMatchObject({ enabled: false, queryMutable: false, rangeCondition: true })
  })

  it('recomputes functional review bands while preserving canonical state fields', () => {
    const policy = [
      { id: 'geometry', label: '几何', enabled: true, weight: 10, queryMutable: true },
      { id: 'deviation', label: '偏离', enabled: true, weight: 0, queryMutable: true },
    ]
    const base = {
      canonicalRank: 0,
      candidateStatus: '等待',
      executionStatus: 'blocked',
      dataState: 'provisional',
      scoreStatus: 'diagnostic-medium',
    }
    const geometryCandidate = {
      ...base,
      symbol: 'A',
      diagnosticReadings: {
        geometry: { ratio: 1, availability: 'available' },
        deviation: { ratio: 0, availability: 'available' },
      },
    }
    const deviationCandidate = {
      ...base,
      symbol: 'B',
      canonicalRank: 1,
      diagnosticReadings: {
        geometry: { ratio: 0, availability: 'available' },
        deviation: { ratio: 1, availability: 'available' },
      },
    }
    const gatedCandidate = {
      ...geometryCandidate,
      symbol: 'C',
      canonicalRank: 2,
      candidateStatus: '剔除',
    }
    const before = [geometryCandidate, deviationCandidate, gatedCandidate].map((item) => ({
      symbol: item.symbol,
      dataState: item.dataState,
      scoreStatus: item.scoreStatus,
      candidateStatus: item.candidateStatus,
      executionStatus: item.executionStatus,
    }))
    const first = runRecommendedPoolQuery(
      [geometryCandidate, deviationCandidate, gatedCandidate],
      { dimensions: policy, thresholds: { priorityReviewMin: 0.65, secondaryReviewMin: 0.4 } },
      policy,
    )
    const swappedDimensions = [
      { ...policy[0], weight: 0 },
      { ...policy[1], weight: 10 },
    ]
    const second = runRecommendedPoolQuery(
      [geometryCandidate, deviationCandidate, gatedCandidate],
      { dimensions: swappedDimensions, thresholds: { priorityReviewMin: 0.65, secondaryReviewMin: 0.4 } },
      policy,
    )

    expect(first.groups['priority-review'].map(({ candidate: item }) => item.symbol)).toEqual(['A'])
    expect(second.groups['priority-review'].map(({ candidate: item }) => item.symbol)).toEqual(['B'])
    expect(first.groups['canonical-gate'].map(({ candidate: item }) => item.symbol)).toEqual(['C'])
    expect(second.groups['canonical-gate'].map(({ candidate: item }) => item.symbol)).toEqual(['C'])
    expect(
      [geometryCandidate, deviationCandidate, gatedCandidate].map((item) => ({
        symbol: item.symbol,
        dataState: item.dataState,
        scoreStatus: item.scoreStatus,
        candidateStatus: item.candidateStatus,
        executionStatus: item.executionStatus,
      })),
    ).toEqual(before)
  })

  it('enables a measured default-off dimension and rejects dimensions outside the report policy', () => {
    const policy = [{ id: 'optional', label: '可选维度', enabled: false, weight: 5, queryMutable: true }]
    const configured = normalizeRecommendedPoolQueryConfig(
      { dimensions: [{ id: 'optional', enabled: true, weight: 5 }] },
      policy,
    )
    const candidateWithReading = {
      diagnosticReadings: { optional: { ratio: 0.8, availability: 'available' } },
    }
    const disabled = normalizeRecommendedPoolQueryConfig(
      { dimensions: [{ id: 'optional', enabled: false, weight: 5 }] },
      policy,
    )

    expect(configuredDiagnosticRatio(candidateWithReading, configured.dimensions)).toBeCloseTo(0.8)
    expect(configuredDiagnosticRatio(candidateWithReading, disabled.dimensions)).toBe(0)
    expect(() =>
      normalizeRecommendedPoolQueryConfig({ dimensions: [{ id: 'rsi', enabled: true, weight: 50 }] }, policy),
    ).toThrow('unsupported recommended-pool query dimension')
    expect(() =>
      normalizeRecommendedPoolQueryConfig({ dimensions: [{ id: 'optional' }, { id: 'optional' }] }, policy),
    ).toThrow('must be unique')
  })

  it('uses configurable review thresholds and keeps the secondary threshold below the priority threshold', () => {
    const policy = [{ id: 'signal', label: '信号', enabled: true, weight: 10, queryMutable: true }]
    const queryCandidate = {
      symbol: 'A',
      canonicalRank: 0,
      candidateStatus: '等待',
      executionStatus: 'blocked',
      diagnosticReadings: { signal: { ratio: 0.85, availability: 'available' } },
    }
    const strict = runRecommendedPoolQuery(
      [queryCandidate],
      {
        dimensions: policy,
        thresholds: { priorityReviewMin: 0.9, secondaryReviewMin: 0.8 },
      },
      policy,
    )
    const normalized = normalizeRecommendedPoolQueryConfig(
      {
        dimensions: policy,
        thresholds: { priorityReviewMin: 0.3, secondaryReviewMin: 0.8 },
      },
      policy,
    )

    expect(strict.groups['priority-review']).toHaveLength(0)
    expect(strict.groups['secondary-review'].map(({ candidate: item }) => item.symbol)).toEqual(['A'])
    expect(normalized.thresholds).toEqual({ priorityReviewMin: 0.3, secondaryReviewMin: 0.3 })
  })
})
