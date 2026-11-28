import { capitalEfficiencyFrontier } from './capitalEfficiency.js'

const Z95 = 1.959963984540054

/**
 * Prefix-causal half-life weighted directional arithmetic move-scale estimator
 * bridged into CK Part 2's directional capital-efficiency frontier:
 *   w_i = 2^(-(t - i) / halfLifeSessions)
 *   alpha_hat = median_w(exp(r_+) - 1) / median_w(1 - exp(-|r_-|))
 *   3*alpha*u^5 - 5*alpha*u^4 - 5*u + 3 = 0,   x* = (1 - u^4) / (1 + alpha*u^4)
 */
export function estimateDynamicCkSkew({
  rows,
  index = null,
  referencePrice = null,
  halfLifeSessions = null,
  availableAt = null,
} = {}) {
  if (!Array.isArray(rows) || rows.length < 3) {
    return {
      status: 'unavailable',
      reason: 'insufficient-prefix',
      claimClass: 'missing-input',
      executionAuthority: 'none',
    }
  }
  const end = index === null ? rows.length - 1 : index
  if (!Number.isInteger(end) || end < 2 || end >= rows.length) {
    return {
      status: 'unavailable',
      reason: 'invalid-prefix-index',
      claimClass: 'missing-input',
      executionAuthority: 'none',
    }
  }
  const cycle = Number(halfLifeSessions)
  if (!Number.isFinite(cycle) || cycle <= 0) {
    return {
      status: 'unavailable',
      reason: 'formula-cycle-required-for-causal-weighting',
      claimClass: 'missing-input',
      executionAuthority: 'none',
    }
  }

  const positive = []
  const negative = []
  for (let cursor = 1; cursor <= end; cursor += 1) {
    const prev = rows[cursor - 1]?.close
    const curr = rows[cursor]?.close
    if (!Number.isFinite(prev) || prev <= 0 || !Number.isFinite(curr) || curr <= 0) continue
    const logRet = Math.log(curr / prev)
    const weight = Math.pow(2, -(end - cursor) / cycle)
    if (logRet > 0) positive.push({ logMag: logRet, arithMove: Math.exp(logRet) - 1, weight })
    else if (logRet < 0) negative.push({ logMag: -logRet, arithMove: 1 - Math.exp(logRet), weight })
  }

  const posEss = effectiveSampleSize(positive)
  const negEss = effectiveSampleSize(negative)
  if (!(posEss > 1 && negEss > 1)) {
    return {
      status: 'unavailable',
      reason: 'insufficient-two-sided-cycle-samples',
      positiveEffectiveSamples: posEss,
      negativeEffectiveSamples: negEss,
      claimClass: 'missing-input',
      executionAuthority: 'none',
    }
  }

  const upMedianMove = weightedQuantile(
    positive.map((item) => ({ value: item.arithMove, weight: item.weight })),
    0.5,
  )
  const downMedianMove = weightedQuantile(
    negative.map((item) => ({ value: item.arithMove, weight: item.weight })),
    0.5,
  )
  if (!(upMedianMove > 0 && downMedianMove > 0)) {
    return {
      status: 'unavailable',
      reason: 'degenerate-directional-scale',
      claimClass: 'missing-input',
      executionAuthority: 'none',
    }
  }

  const directionalMoveScaleRatio = upMedianMove / downMedianMove
  const logRatioSe = (1 / Math.log(2)) * Math.sqrt(1 / posEss + 1 / negEss)
  const frontier = capitalEfficiencyFrontier({ skew: directionalMoveScaleRatio })
  const price = Number.isFinite(referencePrice) && referencePrice > 0 ? referencePrice : rows[end].close
  if (!frontier || !Number.isFinite(price) || price <= 0) {
    return {
      status: 'unavailable',
      reason: 'frontier-unresolvable',
      claimClass: 'missing-input',
      executionAuthority: 'none',
    }
  }

  return {
    status: 'ok',
    asOfDate: rows[end]?.date ?? null,
    availableAt: availableAt ?? `${rows[end]?.date ?? end}:close`,
    referencePrice: price,
    halfLifeSessions: cycle,
    positiveEffectiveSamples: posEss,
    negativeEffectiveSamples: negEss,
    upMedianArithmeticMove: upMedianMove,
    downMedianArithmeticMove: downMedianMove,
    directionalMoveScaleRatio,
    ckSkewAlphaScenario: directionalMoveScaleRatio,
    logScaleRatioStandardError: logRatioSe,
    ckRangeWidth: frontier.rangeWidth,
    ckDownWidthFraction: frontier.rangeWidth,
    ckUpWidthFraction: directionalMoveScaleRatio * frontier.rangeWidth,
    lowerPrice: price * (1 - frontier.rangeWidth),
    upperPrice: price * (1 + directionalMoveScaleRatio * frontier.rangeWidth),
    efficiencyAtGeometricMidpoint: frontier.efficiencyAtGeometricMidpoint,
    efficiencyAtReferencePrice: frontier.efficiencyAtReferencePrice,
    geometryClaimClass: 'exact-identity',
    scaleRatioClaimClass: 'sample-estimate',
    resultClaimClass: 'scenario-proxy',
    futureRowsUsed: false,
    executionAuthority: 'none',
  }
}

/**
 * Prefix-causal kNN state recurrence estimator with exit-to-reentry waiting intervals
 * and Kaplan-Meier product-limit survival curve + log-log Greenwood 95% bands.
 *   k = ceil(sqrt(N)),   wait_m = episode_{m}.start - episode_{m-1}.end > 0.
 */
export function deriveStateRecurrence({ costDistanceSeries, dates = [], index = null } = {}) {
  if (!Array.isArray(costDistanceSeries) || costDistanceSeries.length < 5) {
    return unavailableRecurrence('insufficient-recurrence-prefix')
  }
  const end = index === null ? costDistanceSeries.length - 1 : index
  if (!Number.isInteger(end) || end < 4 || end >= costDistanceSeries.length) {
    return unavailableRecurrence('invalid-recurrence-index')
  }

  const currentDistance = costDistanceSeries[end]
  if (!Number.isFinite(currentDistance)) return unavailableRecurrence('missing-current-state-distance')

  const candidates = []
  for (let cursor = 0; cursor < end; cursor += 1) {
    const value = costDistanceSeries[cursor]
    if (Number.isFinite(value)) {
      candidates.push({ index: cursor, value, distance: Math.abs(value - currentDistance) })
    }
  }
  if (candidates.length < 4) return unavailableRecurrence('insufficient-recurrence-candidates')

  const neighbourCount = Math.ceil(Math.sqrt(candidates.length))
  const nearest = [...candidates].sort((a, b) => a.distance - b.distance || a.index - b.index)
  const recurrenceRadius =
    nearest[neighbourCount - 1]?.distance > 0
      ? nearest[neighbourCount - 1].distance
      : (nearest.find((item) => item.distance > 0)?.distance ?? null)
  if (!(recurrenceRadius > 0)) return unavailableRecurrence('zero-recurrence-radius')

  const hitIndices = candidates.filter((item) => item.distance <= recurrenceRadius).map((item) => item.index)
  hitIndices.push(end)
  const episodes = mergeEpisodes(hitIndices)
  const intervals = episodes
    .slice(1)
    .map((episode, offset) => episode.startIndex - episodes[offset].endIndex)
    .filter((value) => value > 0)

  const radiusReference = buildRadiusReference(candidates, neighbourCount)
  const empiricalRadiusRank = radiusReference.length
    ? (1 + radiusReference.filter((item) => item <= recurrenceRadius).length) / (radiusReference.length + 1)
    : null
  const currentEpisode = episodes.at(-1)
  const kaplanMeier = buildKaplanMeier(intervals)

  if (!intervals.length) {
    return {
      status: 'unavailable',
      reason: 'no-completed-leave-then-return-episodes',
      currentDistance,
      neighbourCount,
      recurrenceRadius,
      empiricalRadiusRank,
      episodeCount: episodes.length,
      currentEpisodeAgeSessions: currentEpisode ? end - currentEpisode.startIndex : 0,
      kaplanMeier,
      claimClass: 'missing-input',
      futureRowsUsed: false,
      executionAuthority: 'none',
    }
  }

  return {
    status: 'ok',
    asOfDate: dates[end] ?? null,
    currentDistance,
    candidateCount: candidates.length,
    neighbourCount,
    recurrenceRadius,
    empiricalRadiusRank,
    episodeCount: episodes.length,
    completedEventCount: intervals.length,
    censoredCount: 0,
    recurrenceIntervalsSessions: intervals,
    recurrencePeriodSessions: quantile(intervals, 0.5),
    recurrencePeriodQ1Sessions: quantile(intervals, 0.25),
    recurrencePeriodQ3Sessions: quantile(intervals, 0.75),
    currentEpisodeAgeSessions: currentEpisode ? end - currentEpisode.startIndex : 0,
    kaplanMeier,
    claimClass: 'sample-estimate',
    futureRowsUsed: false,
    executionAuthority: 'none',
  }
}

function buildKaplanMeier(intervals) {
  if (!intervals.length) return { status: 'unavailable', eventCount: 0, points: [] }
  const counts = new Map()
  for (const wait of intervals) counts.set(wait, (counts.get(wait) ?? 0) + 1)

  let atRisk = intervals.length
  let survival = 1
  let greenwoodSum = 0
  const points = []
  for (const [timeSessions, events] of [...counts.entries()].sort((a, b) => a[0] - b[0])) {
    survival *= 1 - events / atRisk
    const terminal = events === atRisk
    if (!terminal) greenwoodSum += events / (atRisk * (atRisk - events))
    const se = terminal ? 0 : survival * Math.sqrt(greenwoodSum)
    const band = logLogBand(survival, greenwoodSum)
    points.push({
      timeSessions,
      atRiskCount: atRisk,
      eventCount: events,
      survivalProbability: survival,
      greenwoodStandardError: se,
      confidenceLower95: band.lower,
      confidenceUpper95: band.upper,
    })
    atRisk -= events
  }
  return { status: 'ok', eventCount: intervals.length, points }
}

function logLogBand(survival, greenwoodSum) {
  if (!(survival > 0)) return { lower: 0, upper: 0 }
  if (survival >= 1 || !(greenwoodSum > 0)) return { lower: 1, upper: 1 }
  const logLogSe = Math.sqrt(greenwoodSum) / Math.abs(Math.log(survival))
  return {
    lower: Math.max(0, Math.min(1, Math.pow(survival, Math.exp(Z95 * logLogSe)))),
    upper: Math.max(0, Math.min(1, Math.pow(survival, Math.exp(-Z95 * logLogSe)))),
  }
}

function mergeEpisodes(indices) {
  const sorted = [...new Set(indices)].sort((a, b) => a - b)
  const episodes = []
  for (const idx of sorted) {
    const prev = episodes.at(-1)
    if (prev && idx === prev.endIndex + 1) {
      prev.endIndex = idx
      prev.hitCount += 1
    } else {
      episodes.push({ startIndex: idx, endIndex: idx, hitCount: 1 })
    }
  }
  return episodes
}

function buildRadiusReference(candidates, k) {
  const ordered = [...candidates].sort((a, b) => a.value - b.value)
  const half = Math.max(1, Math.ceil(k / 2))
  return ordered
    .map((item, pos) => {
      const left = ordered[pos - half]
      const right = ordered[pos + half]
      if (!left && !right) return null
      if (!left) return right.value - item.value
      if (!right) return item.value - left.value
      return Math.max(item.value - left.value, right.value - item.value)
    })
    .filter((v) => Number.isFinite(v) && v >= 0)
}

function effectiveSampleSize(items) {
  const w1 = items.reduce((s, item) => s + item.weight, 0)
  const w2 = items.reduce((s, item) => s + item.weight * item.weight, 0)
  return w2 > 0 ? (w1 * w1) / w2 : 0
}

function weightedQuantile(items, p) {
  const ordered = [...items].sort((a, b) => a.value - b.value)
  const total = ordered.reduce((s, item) => s + item.weight, 0)
  if (!(total > 0)) return null
  let acc = 0
  for (const item of ordered) {
    acc += item.weight
    if (acc >= total * p) return item.value
  }
  return ordered.at(-1)?.value ?? null
}

function quantile(values, p) {
  if (!values.length) return null
  const ordered = [...values].sort((a, b) => a - b)
  const pos = (ordered.length - 1) * p
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return ordered[lo] + (ordered[hi] - ordered[lo]) * (pos - lo)
}

function unavailableRecurrence(reason) {
  return {
    status: 'unavailable',
    reason,
    claimClass: 'missing-input',
    futureRowsUsed: false,
    executionAuthority: 'none',
  }
}
