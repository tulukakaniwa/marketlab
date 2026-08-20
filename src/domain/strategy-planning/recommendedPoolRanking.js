export function configuredDiagnosticRatio(candidate, dimensions) {
  const ratios = candidate?.diagnosticRanking?.dimensions ?? {}
  const active = dimensions
    .filter((dimension) => dimension.enabled && dimension.weight > 0)
    .map((dimension) => ({ dimension, result: ratios[dimension.id] }))
    .filter(({ result }) => result && !result.missing && !result.disabled && Number.isFinite(result.ratio))
  const totalWeight = active.reduce((sum, { dimension }) => sum + dimension.weight, 0)
  if (totalWeight <= 0) return 0
  const weightedScore = active.reduce((sum, { dimension, result }) => sum + result.ratio * dimension.weight, 0)
  return weightedScore / totalWeight
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
  const comparator = comparators[mode] ?? comparators.canonical
  return rows.toSorted(comparator)
}
