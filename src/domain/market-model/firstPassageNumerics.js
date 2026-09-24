// Stable normal tails: integrate every cell and both absorbing tails, without
// truncating Gaussian support or renormalizing a surviving price distribution.
const CDF_ERROR_BOUND = 7.5e-8
export const MASS_TOLERANCE = 1e-9
export const NORMAL_CDF_ERROR_BOUND = CDF_ERROR_BOUND

function normalTail(nonNegativeZ) {
  if (nonNegativeZ === 0) return 0.5
  if (nonNegativeZ === Infinity) return 0
  const x = nonNegativeZ / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * x)
  const polynomial = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))))
  return 0.5 * polynomial * Math.exp(-0.5 * nonNegativeZ * nonNegativeZ)
}

function normalInterval(left, right) {
  if (left >= 0) return normalTail(left) - normalTail(right)
  if (right <= 0) return normalTail(-right) - normalTail(-left)
  return 1 - normalTail(-left) - normalTail(right)
}

export function gaussianCellKernel({ mean, variance, edges }) {
  if (!Number.isFinite(mean) || !Number.isFinite(variance) || variance < 0) return null
  const count = edges.length - 1
  const probabilities = new Float64Array(count + 2)
  if (variance === 0) {
    if (mean <= edges[0]) probabilities[0] = 1
    else if (mean >= edges[count]) probabilities[count + 1] = 1
    else {
      const cell = Math.min(count - 1, Math.floor(((mean - edges[0]) / (edges[count] - edges[0])) * count))
      probabilities[cell + 1] = 1
    }
    return { probabilities, correction: 0 }
  }
  const sigma = Math.sqrt(variance)
  const standardized = edges.map((edge) => (edge - mean) / sigma)
  const lower = standardized[0]
  const upper = standardized[count]
  probabilities[0] = lower <= 0 ? normalTail(-lower) : 1 - normalTail(lower)
  probabilities[count + 1] = upper >= 0 ? normalTail(upper) : 1 - normalTail(-upper)
  for (let cell = 0; cell < count; cell += 1) {
    probabilities[cell + 1] = normalInterval(standardized[cell], standardized[cell + 1])
  }
  let mass = 0
  let largest = 0
  for (let index = 0; index < probabilities.length; index += 1) {
    if (!Number.isFinite(probabilities[index]) || probabilities[index] < -MASS_TOLERANCE) return null
    // A correction at floating-point tolerance is not a probability-model fit.
    if (probabilities[index] < 0) probabilities[index] = 0
    mass += probabilities[index]
    if (probabilities[index] > probabilities[largest]) largest = index
  }
  const correction = 1 - mass
  if (Math.abs(correction) > MASS_TOLERANCE) return null
  probabilities[largest] += correction
  return { probabilities, correction }
}

export function transitionWeights(weights, matrix) {
  return weights.map((_, destination) =>
    weights.reduce((sum, weight, source) => sum + weight * matrix[source][destination], 0),
  )
}

export function normalizeProbabilityVector(values) {
  if (!Array.isArray(values) || values.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
    return null
  }
  const sum = values.reduce((total, value) => total + value, 0)
  if (Math.abs(sum - 1) > MASS_TOLERANCE) return null
  const corrected = [...values]
  let largest = 0
  for (let index = 1; index < corrected.length; index += 1) {
    if (corrected[index] > corrected[largest]) largest = index
  }
  corrected[largest] += 1 - sum
  return { values: corrected, correction: 1 - sum }
}

export function sumMass(mass) {
  return mass.reduce((sum, row) => sum + row.reduce((total, value) => total + value, 0), 0)
}
