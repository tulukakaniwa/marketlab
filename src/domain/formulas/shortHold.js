export function deriveShortHoldWindow({
  zScore,
  halfLifeDays,
  costDistance = null,
  recoveryFraction = 0.2,
  zExit = 1,
  minAbsZ = 1.5,
  minExecutableDays = 2,
  maxHoldingDays = 5,
  minGrossReturn = 0.01,
  side = 'long',
} = {}) {
  if (![zScore, halfLifeDays, recoveryFraction, zExit, minAbsZ, minExecutableDays, maxHoldingDays, minGrossReturn].every(Number.isFinite)) return null
  if (halfLifeDays <= 0 || recoveryFraction <= 0 || recoveryFraction >= 1 || zExit <= 0) return null
  if (minAbsZ < 0 || minExecutableDays < 0 || maxHoldingDays <= 0 || minExecutableDays > maxHoldingDays || minGrossReturn < 0) return null

  const absZ = Math.abs(zScore)
  const daysToZExit = absZ > zExit ? halfLifeDays * log2(absZ / zExit) : 0
  const partialRecoveryDays = halfLifeDays * log2(1 / (1 - recoveryFraction))
  const executableHoldingDays = Math.max(minExecutableDays, partialRecoveryDays)
  const expectedGrossReturn = Number.isFinite(costDistance) ? Math.abs(costDistance) * recoveryFraction : null
  const minExecutableRecoveryFraction = 1 - Math.pow(2, -minExecutableDays / halfLifeDays)
  const maxWindowRecoveryFraction = 1 - Math.pow(2, -maxHoldingDays / halfLifeDays)

  const blockedReasons = []
  if (!passesZDirection({ zScore, minAbsZ, side })) blockedReasons.push('z-threshold')
  if (partialRecoveryDays > maxHoldingDays) blockedReasons.push('holding-window')
  if (expectedGrossReturn !== null && expectedGrossReturn < minGrossReturn) blockedReasons.push('gross-return')

  return {
    eligible: blockedReasons.length === 0,
    status: blockedReasons.length === 0 ? 'eligible' : 'wait',
    side,
    zScore,
    absZ,
    zExit,
    recoveryFraction,
    halfLifeDays,
    daysToZExit,
    partialRecoveryDays,
    executableHoldingDays,
    minExecutableDays,
    maxHoldingDays,
    expectedGrossReturn,
    minExecutableRecoveryFraction,
    maxWindowRecoveryFraction,
    blockedReasons,
  }
}

export function deriveStructuralHoldWindow({
  zScore,
  halfLifeDays,
  entryPrice,
  anchorPrice,
  targetPrices = {},
  anchorRecoveryFraction = 0.875,
  minAbsZ = 1.5,
  minExecutableDays = 2,
  maxHoldingDays = 5,
  minGrossReturn = 0.01,
  side = 'long',
} = {}) {
  if (![zScore, halfLifeDays, entryPrice, anchorPrice, anchorRecoveryFraction, minAbsZ, minExecutableDays, maxHoldingDays, minGrossReturn].every(Number.isFinite)) return null
  if (halfLifeDays <= 0 || entryPrice <= 0 || anchorPrice <= 0 || anchorRecoveryFraction <= 0 || anchorRecoveryFraction >= 1) return null
  if (minAbsZ < 0 || minExecutableDays < 0 || maxHoldingDays <= 0 || minExecutableDays > maxHoldingDays || minGrossReturn < 0) return null

  const direction = side === 'short' ? -1 : 1
  const anchorGap = (anchorPrice - entryPrice) * direction
  if (anchorGap <= 0) return null

  const candidates = Object.entries(targetPrices)
    .map(([id, rawPrice]) => buildTargetCandidate({
      id,
      rawPrice,
      direction,
      zScore,
      halfLifeDays,
      entryPrice,
      anchorPrice,
      anchorGap,
      anchorRecoveryFraction,
      minAbsZ,
      minExecutableDays,
      maxHoldingDays,
      minGrossReturn,
      side,
    }))
    .filter(Boolean)

  const selected = candidates.find((candidate) => candidate.eligible) ?? null
  return {
    eligible: selected !== null,
    status: selected ? 'eligible' : 'wait',
    side,
    entryPrice,
    anchorPrice,
    anchorRecoveryFraction,
    selected,
    candidates,
  }
}

export const DEFAULT_DYNAMIC_HOLDING_PROFILES = {
  shortTrade: { minDays: 2, maxDays: 10, minGrossReturn: 0.03 },
  fundCycle: { minDays: 20, maxDays: 120, minGrossReturn: 0.03 },
}

export function deriveDrawdownFeatures({ rows, index = null, lookback = 120, minSamples = 30 } = {}) {
  if (!Array.isArray(rows) || rows.length < minSamples) return insufficientDrawdown(rows?.length ?? 0)
  const end = Number.isInteger(index) ? Math.min(Math.max(index, 0), rows.length - 1) : rows.length - 1
  const start = Math.max(0, end - lookback + 1)
  const sample = rows.slice(start, end + 1).filter((row) => Number.isFinite(row?.close) && row.close > 0)
  if (sample.length < minSamples) return insufficientDrawdown(sample.length)

  let peakRel = 0
  for (let i = 1; i < sample.length; i += 1) if (sample[i].close >= sample[peakRel].close) peakRel = i
  let troughRel = peakRel
  for (let i = peakRel; i < sample.length; i += 1) if (sample[i].close <= sample[troughRel].close) troughRel = i

  const current = sample.at(-1).close
  const peak = sample[peakRel].close
  const trough = sample[troughRel].close
  const drawdownDepth = current / peak - 1
  const drawdownSpeed5 = drawdownDepth - drawdownDepthAt(rows, end - 5, lookback)
  const drawdownSpeed20 = drawdownDepth - drawdownDepthAt(rows, end - 20, lookback)
  const drawdownRepair = peak > trough ? clamp01((current - trough) / (peak - trough)) : 1

  return {
    status: 'ok',
    lookbackDays: sample.length,
    drawdownDepth,
    drawdownSpeed5,
    drawdownSpeed20,
    drawdownRepair,
    drawdownAge: {
      peakDays: sample.length - 1 - peakRel,
      troughDays: sample.length - 1 - troughRel,
    },
    peakPrice: peak,
    troughPrice: trough,
  }
}

export function deriveDynamicHoldingState({
  zScore,
  halfLifeDays,
  entryPrice,
  anchorPrice,
  targetPrices = {},
  drawdown,
  lpPercentile = null,
  costSlopePct = 0,
  anchorRecoveryFraction = 0.875,
  minAbsZ = 1.5,
  profiles = DEFAULT_DYNAMIC_HOLDING_PROFILES,
  side = 'long',
} = {}) {
  const normalizedProfiles = normalizeProfiles(profiles)
  const maxWindow = Math.max(normalizedProfiles.shortTrade.maxDays, normalizedProfiles.fundCycle.maxDays)
  const structural = deriveStructuralHoldWindow({
    zScore,
    halfLifeDays,
    entryPrice,
    anchorPrice,
    targetPrices,
    anchorRecoveryFraction,
    minAbsZ,
    minExecutableDays: 1,
    maxHoldingDays: maxWindow,
    minGrossReturn: 0,
    side,
  })

  if (!drawdown || drawdown.status === 'insufficient-history' || !structural) {
    return emptyDynamicState({ status: '需刷新数据', phase: 'insufficient-history', structural, profiles: normalizedProfiles })
  }

  const milestones = buildMilestones(structural)
  const phase = classifyPhase({ drawdown, entryPrice, anchorPrice, costSlopePct })
  const shortTrade = buildHoldingPlan({ kind: 'shortTrade', profile: normalizedProfiles.shortTrade, phase, milestones })
  const fundCycle = buildHoldingPlan({ kind: 'fundCycle', profile: normalizedProfiles.fundCycle, phase, milestones })
  const status = phase === 'falling-expansion'
    ? '等待'
    : [shortTrade, fundCycle].some((plan) => plan.status === '观察')
      ? '观察'
      : [shortTrade, fundCycle].every((plan) => plan.status === '剔除') ? '剔除' : '等待'

  return {
    status,
    phase,
    phaseLabel: phaseLabel(phase),
    state: {
      zScore,
      absZ: Math.abs(zScore),
      halfLifeDays,
      lpPercentile,
      costSlopePct,
      drawdown,
    },
    milestones,
    expectation: buildExpectation({ milestones, structural, profiles: normalizedProfiles }),
    holdingPlan: { shortTrade, fundCycle },
    blockedReasons: unique([...shortTrade.blockedReasons, ...fundCycle.blockedReasons]),
  }
}

function buildTargetCandidate({
  id,
  rawPrice,
  direction,
  zScore,
  halfLifeDays,
  entryPrice,
  anchorPrice,
  anchorGap,
  anchorRecoveryFraction,
  minAbsZ,
  minExecutableDays,
  maxHoldingDays,
  minGrossReturn,
  side,
}) {
  const targetPrice = Number(rawPrice)
  if (!Number.isFinite(targetPrice) || targetPrice <= 0) return null

  const rawMove = (targetPrice - entryPrice) * direction
  let recoveryFraction = rawMove / anchorGap
  let effectiveTargetPrice = targetPrice
  const blockedReasons = []

  if (id === 'anchor' && recoveryFraction >= 1) {
    recoveryFraction = anchorRecoveryFraction
    effectiveTargetPrice = entryPrice + direction * anchorGap * anchorRecoveryFraction
  }

  if (!passesZDirection({ zScore, minAbsZ, side })) blockedReasons.push('z-threshold')
  if (recoveryFraction <= 0) blockedReasons.push('target-behind-entry')
  if (recoveryFraction >= 1) blockedReasons.push('post-anchor-extension')

  const partialRecoveryDays = recoveryFraction > 0 && recoveryFraction < 1
    ? halfLifeDays * log2(1 / (1 - recoveryFraction))
    : null
  const executableHoldingDays = partialRecoveryDays !== null ? Math.max(minExecutableDays, partialRecoveryDays) : null
  const grossReturn = direction === 1 ? effectiveTargetPrice / entryPrice - 1 : entryPrice / effectiveTargetPrice - 1

  if (partialRecoveryDays === null || partialRecoveryDays > maxHoldingDays) blockedReasons.push('holding-window')
  if (!Number.isFinite(grossReturn) || grossReturn < minGrossReturn) blockedReasons.push('gross-return')

  return {
    id,
    targetPrice,
    effectiveTargetPrice,
    recoveryFraction,
    zAtTarget: zScore * (1 - Math.max(0, Math.min(recoveryFraction, 1))),
    halfLifeDays,
    partialRecoveryDays,
    executableHoldingDays,
    grossReturn,
    isAnchorProxy: id === 'anchor' && targetPrice === anchorPrice,
    eligible: blockedReasons.length === 0,
    blockedReasons,
  }
}

function buildMilestones(structural) {
  const alias = { costLower: 'firstRepair', anchor: 'baseAnchor', lpUpper: 'stretch' }
  return structural.candidates.map((candidate) => ({
    id: alias[candidate.id] ?? candidate.id,
    sourceId: candidate.id,
    targetPrice: candidate.targetPrice,
    effectiveTargetPrice: candidate.effectiveTargetPrice,
    expectedDays: candidate.partialRecoveryDays,
    executableDays: candidate.executableHoldingDays,
    halfLifeDays: candidate.halfLifeDays,
    grossReturn: candidate.grossReturn,
    returnPerDayPct: Number.isFinite(candidate.grossReturn) && Number.isFinite(candidate.partialRecoveryDays) ? round(candidate.grossReturn * 100 / candidate.partialRecoveryDays, 4) : null,
    monthlyEfficiencyPct: Number.isFinite(candidate.grossReturn) && Number.isFinite(candidate.partialRecoveryDays) ? round(candidate.grossReturn * 100 / candidate.partialRecoveryDays * 21, 2) : null,
    recoveryFraction: candidate.recoveryFraction,
    zAtTarget: candidate.zAtTarget,
    isStretch: candidate.id === 'lpUpper',
    blockedReasons: candidate.blockedReasons,
  }))
}

function buildHoldingPlan({ kind, profile, phase, milestones }) {
  if (phase === 'insufficient-history') return plan('需刷新数据', 'refresh-data', null, ['insufficient-history'])
  if (phase === 'falling-expansion') return plan('等待', 'wait-drawdown-stabilize', null, ['drawdown-expanding'])
  if (phase === 'post-anchor-extension') return plan('等待', 'review-extension', milestoneById(milestones, 'stretch'), ['post-anchor-extension'])

  const firstRepair = milestoneById(milestones, 'firstRepair')
  const baseAnchor = milestoneById(milestones, 'baseAnchor')
  const candidates = kind === 'fundCycle' ? [baseAnchor, firstRepair] : [firstRepair, baseAnchor]
  const target = candidates.find((item) => usableMilestone(item, profile, kind))

  if (kind === 'shortTrade' && phase === 'low-compression') return plan('观察', 'wait-repair-start', firstRepair, ['drawdown-repair-insufficient'])
  if (target) {
    const action = kind === 'fundCycle' ? 'review' : 'execute'
    return {
      ...plan('观察', action, target, []),
      firstReviewDays: Number.isFinite(firstRepair?.expectedDays) ? Math.max(1, Math.round(firstRepair.expectedDays)) : null,
    }
  }

  const horizonCandidate = candidates.find((item) => Number.isFinite(item?.expectedDays))
  const reasons = horizonCandidate?.expectedDays > profile.maxDays ? ['holding-window'] : ['no-structural-target']
  return plan(reasons.includes('no-structural-target') ? '剔除' : '等待', 'wait-window', horizonCandidate ?? null, reasons)
}

function usableMilestone(item, profile, kind) {
  if (!item || item.blockedReasons.includes('post-anchor-extension')) return false
  if (!Number.isFinite(item.expectedDays) || item.expectedDays > profile.maxDays) return false
  if (kind === 'fundCycle' && item.id !== 'firstRepair' && item.expectedDays < profile.minDays) return false
  if (kind !== 'fundCycle' && item.expectedDays < profile.minDays) return false
  return Number.isFinite(item.grossReturn) && item.grossReturn >= profile.minGrossReturn
}

function classifyPhase({ drawdown, entryPrice, anchorPrice, costSlopePct }) {
  if (entryPrice >= anchorPrice) return 'post-anchor-extension'
  if (drawdown.drawdownSpeed5 <= -0.015 || drawdown.drawdownSpeed20 <= -0.035) return 'falling-expansion'
  if (drawdown.drawdownRepair >= 0.35) return 'mean-reverting'
  if (drawdown.drawdownRepair >= 0.15 && drawdown.drawdownSpeed5 >= -0.005 && costSlopePct >= -1.5) return 'repair-start'
  return 'low-compression'
}

function buildExpectation({ milestones, structural, profiles }) {
  const firstRepair = milestoneById(milestones, 'firstRepair')
  const baseAnchor = milestoneById(milestones, 'baseAnchor')
  const stretch = milestoneById(milestones, 'stretch')
  return {
    firstRepairDays: roundNullable(firstRepair?.expectedDays),
    baseAnchorDays: roundNullable(baseAnchor?.expectedDays),
    stretchDays: roundNullable(stretch?.expectedDays),
    baseReturnPct: rangePct(firstRepair?.grossReturn, baseAnchor?.grossReturn),
    stretchReturnPct: roundNullable((stretch?.grossReturn ?? null) * 100),
    profileExpectations: {
      shortTrade: buildProfileExpectation({ profile: profiles.shortTrade, structural, milestones }),
      fundCycle: buildProfileExpectation({ profile: profiles.fundCycle, structural, milestones }),
    },
  }
}

function buildProfileExpectation({ profile, structural, milestones }) {
  if (!structural) {
    return {
      minDays: profile.minDays,
      maxDays: profile.maxDays,
      expectedReturnAtMinPct: null,
      expectedReturnAtMaxPct: null,
      expectedReturnRangePct: null,
      monthlyEfficiencyPct: null,
      reachedMilestone: null,
      nextMilestone: null,
    }
  }
  const atMin = expectedReturnAtDays({ days: profile.minDays, structural, milestones })
  const atMax = expectedReturnAtDays({ days: profile.maxDays, structural, milestones })
  const targetInWindow = milestones.find((item) => Number.isFinite(item.expectedDays) && item.expectedDays >= profile.minDays && item.expectedDays <= profile.maxDays && !item.blockedReasons.includes('post-anchor-extension')) ?? null
  const nextMilestone = milestones.find((item) => Number.isFinite(item.expectedDays) && item.expectedDays > profile.maxDays && !item.blockedReasons.includes('post-anchor-extension')) ?? null
  return {
    minDays: profile.minDays,
    maxDays: profile.maxDays,
    expectedReturnAtMinPct: atMin.returnPct,
    expectedReturnAtMaxPct: atMax.returnPct,
    expectedReturnRangePct: rangePct(atMin.grossReturn, atMax.grossReturn),
    monthlyEfficiencyPct: atMax.days > 0 && Number.isFinite(atMax.grossReturn) ? round(atMax.grossReturn * 100 / atMax.days * 21, 2) : null,
    reachedMilestone: targetInWindow?.id ?? null,
    nextMilestone: nextMilestone?.id ?? null,
  }
}

function expectedReturnAtDays({ days, structural, milestones }) {
  const halfLifeDays = milestones.find((item) => Number.isFinite(item.expectedDays))?.halfLifeDays
  if (!Number.isFinite(days) || !Number.isFinite(halfLifeDays) || halfLifeDays <= 0) return { days, grossReturn: null, returnPct: null }
  const direction = structural.side === 'short' ? -1 : 1
  const anchorGap = (structural.anchorPrice - structural.entryPrice) * direction
  if (!Number.isFinite(anchorGap) || anchorGap <= 0) return { days, grossReturn: null, returnPct: null }
  const baseAnchor = milestoneById(milestones, 'baseAnchor')
  const cap = Number.isFinite(baseAnchor?.recoveryFraction) ? baseAnchor.recoveryFraction : 0.875
  const recoveryFraction = Math.min(cap, 1 - Math.pow(2, -days / halfLifeDays))
  const price = structural.entryPrice + direction * anchorGap * recoveryFraction
  const grossReturn = direction === 1 ? price / structural.entryPrice - 1 : structural.entryPrice / price - 1
  return { days, grossReturn, returnPct: roundNullable(grossReturn * 100) }
}

function plan(status, action, target, blockedReasons) {
  return {
    status,
    action,
    target,
    targetId: target?.id ?? null,
    expectedDays: roundNullable(target?.expectedDays),
    expectedReturnPct: roundNullable((target?.grossReturn ?? null) * 100),
    blockedReasons,
  }
}

function normalizeProfiles(profiles) {
  return {
    shortTrade: { ...DEFAULT_DYNAMIC_HOLDING_PROFILES.shortTrade, ...(profiles?.shortTrade ?? {}) },
    fundCycle: { ...DEFAULT_DYNAMIC_HOLDING_PROFILES.fundCycle, ...(profiles?.fundCycle ?? {}) },
  }
}

function emptyDynamicState({ status, phase, structural, profiles }) {
  const milestones = structural ? buildMilestones(structural) : []
  return {
    status,
    phase,
    phaseLabel: phaseLabel(phase),
    state: null,
    milestones,
    expectation: buildExpectation({ milestones, structural, profiles }),
    holdingPlan: {
      shortTrade: plan(status, 'refresh-data', null, ['insufficient-history']),
      fundCycle: plan(status, 'refresh-data', null, ['insufficient-history']),
    },
    profiles,
    blockedReasons: ['insufficient-history'],
  }
}

function drawdownDepthAt(rows, index, lookback) {
  const end = Math.min(Math.max(index, 0), rows.length - 1)
  const start = Math.max(0, end - lookback + 1)
  const sample = rows.slice(start, end + 1).filter((row) => Number.isFinite(row?.close) && row.close > 0)
  if (!sample.length) return 0
  const peak = Math.max(...sample.map((row) => row.close))
  return sample.at(-1).close / peak - 1
}

function insufficientDrawdown(sampleSize) {
  return { status: 'insufficient-history', sampleSize, drawdownDepth: null, drawdownSpeed5: null, drawdownSpeed20: null, drawdownRepair: null, drawdownAge: { peakDays: null, troughDays: null } }
}

function milestoneById(milestones, id) { return milestones.find((item) => item.id === id) ?? null }
function rangePct(a, b) { return [a, b].every(Number.isFinite) ? `${roundNullable(a * 100)}%~${roundNullable(b * 100)}%` : null }
function roundNullable(value, digits = 2) { return Number.isFinite(value) ? round(value, digits) : null }
function round(value, digits = 2) { const factor = 10 ** digits; return Math.round(value * factor) / factor }
function clamp01(value) { return Math.max(0, Math.min(1, value)) }
function unique(values) { return [...new Set(values.filter(Boolean))] }

function phaseLabel(phase) {
  return ({
    'falling-expansion': '下跌扩张',
    'low-compression': '低位压缩',
    'repair-start': '修复启动',
    'mean-reverting': '回归中',
    'post-anchor-extension': '锚后扩展',
    'insufficient-history': '数据不足',
  })[phase] ?? phase
}

function passesZDirection({ zScore, minAbsZ, side }) {
  if (side === 'long') return zScore <= -minAbsZ
  if (side === 'short') return zScore >= minAbsZ
  return Math.abs(zScore) >= minAbsZ
}

function log2(value) {
  return Math.log(value) / Math.log(2)
}
