const baseProfiles = {
  conservative: {
    id: 'conservative', label: '保守',
    edgeSigma: 1.15, momentumSigma: 0.6, costSlopeSigma: 0.75,
    riskPct: 0.008, exposurePct: 0.18,
    firstWeight: 0.32, cooldownFactor: 2.5,
    takeProfitSigma: 1.0, cutLossSigma: 1.2,
  },
  balanced: {
    id: 'balanced', label: '均衡',
    edgeSigma: 0.8, momentumSigma: 0, costSlopeSigma: 0.6,
    riskPct: 0.012, exposurePct: 0.30,
    firstWeight: 0.42, cooldownFactor: 1.5,
    takeProfitSigma: 0.8, cutLossSigma: 1.1,
  },
  aggressive: {
    id: 'aggressive', label: '激进',
    edgeSigma: 0.55, momentumSigma: -0.5, costSlopeSigma: 0.45,
    riskPct: 0.02, exposurePct: 0.45,
    firstWeight: 0.5, cooldownFactor: 1.0,
    takeProfitSigma: 0.6, cutLossSigma: 1.0,
  },
}

const customDefaults = { ...baseProfiles.balanced, id: 'custom', label: '自定义' }

export const strategyProfiles = {
  ...baseProfiles,
  custom: customDefaults,
}

export const strategyProfileList = [
  baseProfiles.conservative,
  baseProfiles.balanced,
  baseProfiles.aggressive,
  customDefaults,
]

export function resolveProfile(id, input = {}) {
  if (id === 'custom') return buildCustomProfile(input)
  return strategyProfiles[id] ?? strategyProfiles.balanced
}

export function resolveExecutableProfile(id, market, input = {}) {
  return scaleProfileToMarket(resolveProfile(id, input), market)
}

export function buildCustomProfile(input = {}) {
  return {
    id: 'custom',
    label: '自定义',
    edgeSigma: numberIn(input.strategyEdgeSigma, 0.1, 3, customDefaults.edgeSigma),
    momentumSigma: numberIn(input.strategyMomentumSigma, -2, 2, customDefaults.momentumSigma),
    costSlopeSigma: numberIn(input.strategyCostSlopeSigma, 0, 3, customDefaults.costSlopeSigma),
    riskPct: numberIn(input.strategyRiskPct, 0.001, 0.08, customDefaults.riskPct),
    exposurePct: numberIn(input.strategyExposurePct, 0.01, 1, customDefaults.exposurePct),
    firstWeight: numberIn(input.strategyFirstWeight, 0.05, 1, customDefaults.firstWeight),
    cooldownFactor: numberIn(input.strategyCooldownFactor, 0.25, 8, customDefaults.cooldownFactor),
    takeProfitSigma: numberIn(input.strategyTakeProfitSigma, 0.1, 5, customDefaults.takeProfitSigma),
    cutLossSigma: numberIn(input.strategyCutLossSigma, 0.1, 5, customDefaults.cutLossSigma),
  }
}

export function scaleProfileToMarket(profile, market) {
  const atr = market?.atrPercent || 0.02
  const annVol = market?.annualVol || 0.4
  const dailyVol = annVol / Math.sqrt(365)
  const volRatio = dailyVol / 0.02

  return {
    ...profile,
    edgeAtr: profile.edgeSigma,
    minEdge: Math.max(profile.edgeSigma * atr * 0.3, 0.005),
    momentumMin: profile.momentumSigma * dailyVol,
    costSlopeAtr: profile.costSlopeSigma * volRatio,
    costSlopeMin: Math.max(profile.costSlopeSigma * dailyVol * 0.3, 0.003),
    riskMin: Math.max(profile.riskPct * 0.4, 0.003),
    riskMax: Math.max(profile.riskPct, 0.008),
    exposureMin: Math.max(profile.exposurePct * 0.4, 0.05),
    exposureMax: Math.max(profile.exposurePct, 0.15),
    firstWeight: profile.firstWeight,
    buyCooldown: Math.max(Math.round(profile.cooldownFactor * 3), 2),
    sellCooldown: Math.max(Math.round(profile.cooldownFactor), 1),
    takeProfitAtr: profile.takeProfitSigma,
    takeProfitMin: Math.max(profile.takeProfitSigma * atr * 0.3, 0.01),
    cutMomentumAtr: profile.cutLossSigma,
    cutMomentumMin: Math.max(profile.cutLossSigma * dailyVol * 0.4, 0.015),
  }
}

function numberIn(value, min, max, fallback) {
  const next = Number(value)
  if (!Number.isFinite(next)) return fallback
  return Math.min(max, Math.max(min, next))
}
