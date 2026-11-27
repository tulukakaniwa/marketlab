import { buildExpectation, buildHoldingPlan, buildMilestones, phaseLabel, unique } from './dynamicHoldingSupport.js'
import { defineLegacyAliasContract } from './legacyAliases.js'

export function buildDynamicState({ phase, state, structural, profiles }) {
  const milestones = structural ? buildMilestones(structural) : []
  const shortTrade = buildHoldingPlan({ kind: 'shortTrade', profile: profiles.shortTrade, phase, milestones })
  const fundCycle = buildHoldingPlan({ kind: 'fundCycle', profile: profiles.fundCycle, phase, milestones })
  const status =
    phase === 'falling-expansion'
      ? '等待'
      : [shortTrade, fundCycle].some((plan) => plan.status === '观察')
        ? '观察'
        : [shortTrade, fundCycle].every((plan) => plan.status === '剔除')
          ? '剔除'
          : '等待'

  return {
    status,
    phase,
    phaseLabel: phaseLabel(phase),
    state,
    milestones,
    expectation: buildExpectation({ milestones, structural, profiles }),
    holdingPlan: { shortTrade, fundCycle },
    profiles,
    blockedReasons: unique([...shortTrade.blockedReasons, ...fundCycle.blockedReasons]),
  }
}

export function buildTargetCandidate({
  id,
  rawPrice,
  direction,
  zScore,
  halfLifeSessions,
  entryPrice,
  anchorGap,
  minAbsZ,
  minExecutableSessions,
  maxHoldingSessions,
  minimumGrossReturn,
  side,
}) {
  const targetPrice = Number(rawPrice)
  if (!Number.isFinite(targetPrice) || targetPrice <= 0) return null

  const rawMove = (targetPrice - entryPrice) * direction
  const recoveryFraction = rawMove / anchorGap
  const effectiveTargetPrice = targetPrice
  const blockedReasons = []

  if (!passesZDirection({ zScore, minAbsZ, side })) blockedReasons.push('z-threshold')
  if (recoveryFraction <= 0) blockedReasons.push('target-behind-entry')
  if (recoveryFraction >= 1) blockedReasons.push('post-anchor-extension')

  const partialRecoverySessions =
    recoveryFraction > 0 && recoveryFraction < 1 ? halfLifeSessions * log2(1 / (1 - recoveryFraction)) : null
  const executableHoldingSessions =
    partialRecoverySessions !== null ? Math.max(minExecutableSessions, Math.ceil(partialRecoverySessions)) : null
  const grossReturn = direction === 1 ? effectiveTargetPrice / entryPrice - 1 : entryPrice / effectiveTargetPrice - 1

  if (partialRecoverySessions === null) blockedReasons.push('non-finite-target-horizon')
  if (Number.isFinite(maxHoldingSessions) && partialRecoverySessions > maxHoldingSessions)
    blockedReasons.push('holding-window')
  if (!Number.isFinite(grossReturn) || grossReturn < minimumGrossReturn) blockedReasons.push('gross-return')

  return {
    id,
    targetPrice,
    effectiveTargetPrice,
    recoveryFraction,
    zAtTarget: zScore * (1 - Math.max(0, Math.min(recoveryFraction, 1))),
    halfLifeSessions,
    partialRecoverySessions,
    executableHoldingSessions,
    horizonUnit: 'trading-session',
    horizonRounding: 'ceil-to-whole-trading-session',
    grossReturn,
    isAnchorProxy: false,
    horizonMode: 'formula-derived-from-target-recovery',
    eligible: blockedReasons.length === 0,
    blockedReasons,
  }
}

export function drawdownDepthAt(rows, index, lookback) {
  const end = Math.min(Math.max(index, 0), rows.length - 1)
  const start = Math.max(0, end - lookback + 1)
  const sample = rows.slice(start, end + 1).filter((row) => Number.isFinite(row?.close) && row.close > 0)
  if (!sample.length) return 0
  const peak = Math.max(...sample.map((row) => row.close))
  return sample.at(-1).close / peak - 1
}

export function insufficientDrawdown(sampleSize, windowSpec = null) {
  return {
    status: 'insufficient-history',
    sampleSize,
    drawdownDepth: null,
    drawdownSpeedFast: null,
    drawdownSpeedSlow: null,
    drawdownRepair: null,
    drawdownAge: { peakSessions: null, troughSessions: null },
    windowSpec,
  }
}

export function deriveDrawdownWindowSpec(sampleSize, explicitLookback) {
  if (!Number.isFinite(sampleSize) || sampleSize < 3) return null
  const fastLagSessions = Math.max(1, Math.floor(Math.cbrt(sampleSize)))
  const slowLagSessions = Math.min(sampleSize - 1, Math.max(fastLagSessions + 1, Math.floor(Math.sqrt(sampleSize))))
  return {
    fastLagSessions,
    slowLagSessions,
    lagMode: explicitLookback ? 'adaptive-within-explicit-scenario' : 'adaptive-prefix',
  }
}

export function positiveInteger(value) {
  const next = Number(value)
  return Number.isInteger(next) && next > 0 ? next : null
}

export function clamp01(value) {
  return Math.max(0, Math.min(1, value))
}

export function passesZDirection({ zScore, minAbsZ, side }) {
  if (side === 'long') return zScore <= -minAbsZ
  if (side === 'short') return zScore >= minAbsZ
  return Math.abs(zScore) >= minAbsZ
}

export function resolveMinimumGrossReturn({ minimumGrossReturn, legacyMinimumGrossReturn }) {
  if (minimumGrossReturn !== undefined && minimumGrossReturn !== null) {
    if (!Number.isFinite(minimumGrossReturn) || minimumGrossReturn < 0) return null
    return { value: minimumGrossReturn, source: 'minimumGrossReturn' }
  }
  if (legacyMinimumGrossReturn !== undefined && legacyMinimumGrossReturn !== null) {
    if (!Number.isFinite(legacyMinimumGrossReturn) || legacyMinimumGrossReturn < 0) return null
    return {
      value: legacyMinimumGrossReturn,
      source: 'deprecated:minGrossReturn',
      legacyContract: defineLegacyAliasContract({ minGrossReturn: 'minimumGrossReturn' }),
    }
  }
  return { value: 0, source: 'query-default' }
}

export function log2(value) {
  return Math.log(value) / Math.log(2)
}

export function unavailableRecovery(reason, audit = {}) {
  const status = recoveryAvailabilityStatus(reason)
  return {
    ...audit,
    status,
    eligible: false,
    reason,
    identityClaimClass: 'exact-identity',
    resultClaimClass: status === 'missing-input' ? 'missing-input' : null,
  }
}

function recoveryAvailabilityStatus(reason) {
  if (reason === 'invalid-recovery-input') return 'missing-input'
  if (['cycle-start-at-or-beyond-anchor', 'target-already-crossed-at-cycle-start'].includes(reason))
    return 'not-applicable'
  return 'model-gate-failed'
}
