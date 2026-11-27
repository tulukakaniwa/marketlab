import {
  DEFAULT_DYNAMIC_HOLDING_PROFILES,
  classifyPhase,
  emptyDynamicState,
  normalizeProfiles,
} from './dynamicHoldingSupport.js'
import { recoveryHorizonAudit } from './recoveryHorizonAudit.js'
import {
  buildDynamicState,
  buildTargetCandidate,
  clamp01,
  deriveDrawdownWindowSpec,
  drawdownDepthAt,
  insufficientDrawdown,
  log2,
  passesZDirection,
  positiveInteger,
  resolveMinimumGrossReturn,
  unavailableRecovery,
} from './shortHoldHelpers.js'

export { DEFAULT_DYNAMIC_HOLDING_PROFILES } from './dynamicHoldingSupport.js'
export { deriveRunupFeatures } from './shortHoldHelpers.js'

export function deriveShortHoldWindow({
  zScore,
  halfLifeSessions,
  costDistance = null,
  recoveryFraction = null,
  zExit = 1,
  minAbsZ = 1.5,
  minExecutableSessions = 0,
  maxHoldingSessions = null,
  minimumGrossReturn,
  minGrossReturn: legacyMinimumGrossReturn,
  side = 'long',
} = {}) {
  const grossReturnGate = resolveMinimumGrossReturn({ minimumGrossReturn, legacyMinimumGrossReturn })
  if (!grossReturnGate) return null
  if (![zScore, halfLifeSessions, recoveryFraction, zExit, minAbsZ, minExecutableSessions].every(Number.isFinite))
    return null
  if (maxHoldingSessions !== null && (!Number.isFinite(maxHoldingSessions) || maxHoldingSessions <= 0)) return null
  if (halfLifeSessions <= 0 || recoveryFraction <= 0 || recoveryFraction >= 1 || zExit <= 0) return null
  if (
    minAbsZ < 0 ||
    minExecutableSessions < 0 ||
    (Number.isFinite(maxHoldingSessions) && minExecutableSessions > maxHoldingSessions)
  )
    return null

  const absZ = Math.abs(zScore)
  const sessionsToZExit = absZ > zExit ? halfLifeSessions * log2(absZ / zExit) : 0
  const partialRecoverySessions = halfLifeSessions * log2(1 / (1 - recoveryFraction))
  const executableHoldingSessions = Math.max(minExecutableSessions, Math.ceil(partialRecoverySessions))
  const expectedGrossReturn = Number.isFinite(costDistance) ? Math.abs(costDistance) * recoveryFraction : null
  const minExecutableRecoveryFraction = 1 - Math.pow(2, -minExecutableSessions / halfLifeSessions)
  const maxWindowRecoveryFraction = Number.isFinite(maxHoldingSessions)
    ? 1 - Math.pow(2, -maxHoldingSessions / halfLifeSessions)
    : null

  const blockedReasons = []
  if (!passesZDirection({ zScore, minAbsZ, side })) blockedReasons.push('z-threshold')
  if (Number.isFinite(maxHoldingSessions) && partialRecoverySessions > maxHoldingSessions)
    blockedReasons.push('holding-window')
  if (expectedGrossReturn !== null && expectedGrossReturn < grossReturnGate.value) blockedReasons.push('gross-return')

  return {
    eligible: blockedReasons.length === 0,
    status: blockedReasons.length === 0 ? 'eligible' : 'wait',
    side,
    zScore,
    absZ,
    zExit,
    recoveryFraction,
    halfLifeSessions,
    sessionsToZExit,
    partialRecoverySessions,
    executableHoldingSessions,
    minExecutableSessions,
    maxHoldingSessions,
    horizonUnit: 'trading-session',
    horizonRounding: 'ceil-to-whole-trading-session',
    horizonMode: 'formula-derived-from-recovery-target',
    fixedHoldingCapApplied: Number.isFinite(maxHoldingSessions),
    expectedGrossReturn,
    minimumGrossReturn: grossReturnGate.value,
    minimumGrossReturnSource: grossReturnGate.source,
    ...(grossReturnGate.legacyContract ?? {}),
    minExecutableRecoveryFraction,
    maxWindowRecoveryFraction,
    blockedReasons,
  }
}

export function deriveStructuralHoldWindow({
  zScore,
  halfLifeSessions,
  entryPrice,
  anchorPrice,
  targetPrices = {},
  minAbsZ = 1.5,
  minExecutableSessions = 0,
  maxHoldingSessions = null,
  minimumGrossReturn,
  minGrossReturn: legacyMinimumGrossReturn,
  side = 'long',
} = {}) {
  const grossReturnGate = resolveMinimumGrossReturn({ minimumGrossReturn, legacyMinimumGrossReturn })
  if (!grossReturnGate) return null
  if (![zScore, halfLifeSessions, entryPrice, anchorPrice, minAbsZ, minExecutableSessions].every(Number.isFinite))
    return null
  if (halfLifeSessions <= 0 || entryPrice <= 0 || anchorPrice <= 0) return null
  if (maxHoldingSessions !== null && (!Number.isFinite(maxHoldingSessions) || maxHoldingSessions <= 0)) return null
  if (
    minAbsZ < 0 ||
    minExecutableSessions < 0 ||
    (Number.isFinite(maxHoldingSessions) && minExecutableSessions > maxHoldingSessions)
  )
    return null

  const direction = side === 'short' ? -1 : 1
  const anchorGap = (anchorPrice - entryPrice) * direction
  if (anchorGap <= 0) return null

  const candidates = Object.entries(targetPrices)
    .map(([id, rawPrice]) =>
      buildTargetCandidate({
        id,
        rawPrice,
        direction,
        zScore,
        halfLifeSessions,
        entryPrice,
        anchorPrice,
        anchorGap,
        minAbsZ,
        minExecutableSessions,
        maxHoldingSessions,
        minimumGrossReturn: grossReturnGate.value,
        side,
      }),
    )
    .filter(Boolean)

  const selected = candidates.find((candidate) => candidate.eligible) ?? null
  return {
    eligible: selected !== null,
    status: selected ? 'eligible' : 'wait',
    side,
    entryPrice,
    anchorPrice,
    horizonUnit: 'trading-session',
    horizonRounding: 'ceil-to-whole-trading-session',
    horizonMode: 'formula-derived-per-structural-target',
    fixedHoldingCapApplied: Number.isFinite(maxHoldingSessions),
    minimumGrossReturn: grossReturnGate.value,
    minimumGrossReturnSource: grossReturnGate.source,
    ...(grossReturnGate.legacyContract ?? {}),
    selected,
    candidates,
  }
}

/**
 * Exact recovery-horizon identity conditional on an estimated half-life and a
 * target strictly between the cycle start and the frozen anchor. The identity
 * is exact, while an estimated half-life leaves the result sample-conditioned.
 * `resultClaimClass` is null when no result exists due to an inapplicable structure or failed model gate.
 */
export function deriveRecoveryHorizon({
  cycleStartPrice,
  anchorPrice,
  targetPrice,
  halfLifeSessions,
  side = 'long',
  availableAt = null,
} = {}) {
  const audit = recoveryHorizonAudit(cycleStartPrice, anchorPrice, targetPrice, halfLifeSessions, side, availableAt)
  if (![cycleStartPrice, anchorPrice, targetPrice, halfLifeSessions].every(Number.isFinite)) {
    return unavailableRecovery('invalid-recovery-input', audit)
  }
  if (cycleStartPrice <= 0 || anchorPrice <= 0 || targetPrice <= 0 || halfLifeSessions <= 0) {
    return unavailableRecovery('invalid-recovery-input', audit)
  }

  const { anchorGap, targetGap } = audit
  if (!(anchorGap > 0)) return unavailableRecovery('cycle-start-at-or-beyond-anchor', audit)
  if (!(targetGap > 0)) return unavailableRecovery('target-already-crossed-at-cycle-start', audit)

  const recoveryFraction = audit.rawRecoveryFraction
  if (!(recoveryFraction > 0 && recoveryFraction < 1)) {
    return unavailableRecovery('target-not-strictly-between-cycle-start-and-anchor', audit)
  }

  const modelHorizonRaw = halfLifeSessions * log2(1 / (1 - recoveryFraction))
  if (!Number.isFinite(modelHorizonRaw) || modelHorizonRaw <= 0) {
    return unavailableRecovery('non-finite-recovery-horizon', audit)
  }

  return {
    ...audit,
    status: 'eligible',
    eligible: true,
    recoveryFraction,
    modelHorizonRaw,
    modelHorizonSessions: Math.ceil(modelHorizonRaw),
    horizonUnit: 'trading-session',
    horizonRounding: 'ceil-to-whole-trading-session',
    availableAt,
    formula: 'H=HL*log2(1/(1-recoveryFraction))',
    identityClaimClass: 'exact-identity',
    resultClaimClass: 'scenario-proxy',
    inputSemantics: 'canonical-half-life-sessions',
  }
}

export function deriveDrawdownFeatures({ rows, index = null, lookback = null, minSamples = null } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return insufficientDrawdown(rows?.length ?? 0)
  const end = Number.isInteger(index) ? Math.min(Math.max(index, 0), rows.length - 1) : rows.length - 1
  const visibleCount = end + 1
  const explicitLookback = positiveInteger(lookback)
  const lookbackSessions = Math.min(explicitLookback ?? visibleCount, visibleCount)
  const minimumRequired = positiveInteger(minSamples) ?? Math.max(3, Math.ceil(Math.sqrt(lookbackSessions)))
  const start = Math.max(0, end - lookbackSessions + 1)
  const sample = rows.slice(start, end + 1).filter((row) => Number.isFinite(row?.close) && row.close > 0)
  const windowSpec = deriveDrawdownWindowSpec(sample.length, explicitLookback !== null)
  if (sample.length < minimumRequired || !windowSpec) {
    return insufficientDrawdown(sample.length, {
      lookbackSessions,
      minimumRequired,
      mode: explicitLookback === null ? 'expanding-prefix' : 'explicit-scenario',
    })
  }

  let peakRel = 0
  for (let i = 1; i < sample.length; i += 1) if (sample[i].close >= sample[peakRel].close) peakRel = i
  let troughRel = peakRel
  for (let i = peakRel; i < sample.length; i += 1) if (sample[i].close <= sample[troughRel].close) troughRel = i

  const current = sample.at(-1).close
  const peak = sample[peakRel].close
  const trough = sample[troughRel].close
  const drawdownDepth = current / peak - 1
  const drawdownSpeedFast = drawdownDepth - drawdownDepthAt(rows, end - windowSpec.fastLagSessions, lookbackSessions)
  const drawdownSpeedSlow = drawdownDepth - drawdownDepthAt(rows, end - windowSpec.slowLagSessions, lookbackSessions)
  const drawdownRepair = peak > trough ? clamp01((current - trough) / (peak - trough)) : 1
  const peakAgeSessions = sample.length - 1 - peakRel
  const troughAgeSessions = sample.length - 1 - troughRel

  return {
    status: 'ok',
    lookbackSessions: sample.length,
    drawdownDepth,
    drawdownSpeedFast,
    drawdownSpeedSlow,
    drawdownRepair,
    drawdownAge: {
      peakSessions: peakAgeSessions,
      troughSessions: troughAgeSessions,
    },
    windowSpec: {
      ...windowSpec,
      lookbackSessions: sample.length,
      minimumRequired,
      mode: explicitLookback === null ? 'expanding-prefix' : 'explicit-scenario',
    },
    peakPrice: peak,
    troughPrice: trough,
  }
}

export function deriveDynamicHoldingState({
  zScore,
  halfLifeSessions,
  entryPrice,
  anchorPrice,
  targetPrices = {},
  drawdown,
  lpPercentile = null,
  costSlopePct = 0,
  minAbsZ = 1.5,
  profiles = DEFAULT_DYNAMIC_HOLDING_PROFILES,
  side = 'long',
} = {}) {
  const normalizedProfiles = normalizeProfiles(profiles)
  if (!drawdown || drawdown.status === 'insufficient-history') {
    return emptyDynamicState({
      status: '需刷新数据',
      phase: 'insufficient-history',
      structural: null,
      profiles: normalizedProfiles,
    })
  }

  const phase = classifyPhase({ drawdown, entryPrice, anchorPrice, costSlopePct, side })
  const state = {
    zScore,
    absZ: Math.abs(zScore),
    halfLifeSessions,
    lpPercentile,
    costSlopePct,
    drawdown,
  }

  // A long position above its anchor no longer has a valid mean-reversion gap.
  // Preserve the phase and risk state instead of misreporting valid history as missing.
  if (phase === 'post-anchor-extension') {
    return buildDynamicState({ phase, state, structural: null, profiles: normalizedProfiles })
  }

  const structural = deriveStructuralHoldWindow({
    zScore,
    halfLifeSessions,
    entryPrice,
    anchorPrice,
    targetPrices,
    minAbsZ,
    minExecutableSessions: 0,
    maxHoldingSessions: null,
    minimumGrossReturn: 0,
    side,
  })

  if (!structural) {
    return emptyDynamicState({
      status: '需刷新数据',
      phase: 'insufficient-history',
      structural,
      profiles: normalizedProfiles,
    })
  }

  return buildDynamicState({ phase, state, structural, profiles: normalizedProfiles })
}
