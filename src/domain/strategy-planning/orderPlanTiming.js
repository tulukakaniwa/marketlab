import { deviationScore } from '../formulas/core.js'
import { ensureExecutableProfile } from './orderPlanProfile.js'
import { clamp, erfApprox, fmt, pctFmt, positive } from './orderPlanUtils.js'
import { strategyProfiles } from './strategyProfile.js'

export function buildEntryTiming(market, bands, profile = strategyProfiles.balanced, inputs = {}) {
  const executableProfile = ensureExecutableProfile(profile, market)
  const atr = market.atrPercent || 0
  const formulaHorizonSessions = positive(inputs.formulaHorizonSessions)
  const explicitScenario = inputs.horizonMode === 'explicit-scenario'
  const hasFormulaBinding =
    explicitScenario ||
    (['long', 'short'].includes(inputs.formulaHorizonSide) &&
      positive(inputs.horizonAnchorPrice) &&
      positive(inputs.horizonTargetPrice) &&
      positive(inputs.horizonHalfLifeSessions))
  const missingFormulaInputs = [
    formulaHorizonSessions ? null : 'formula-derived-horizon',
    hasFormulaBinding ? null : 'side-target-horizon-binding',
    positive(inputs.iv) ? null : 'volatility',
    positive(inputs.tradingDaysPerYear) ? null : 'trading-days-per-year',
    bands ? null : 'delta-band',
  ].filter(Boolean)
  if (missingFormulaInputs.length) {
    return waitTiming({
      state: '周期待推导',
      reason: '当前前缀无法从单调 AR 半衰期与结构目标得到有限周期，默认挂单保持关闭。',
      facts: {
        regime: null,
        zScore: null,
        zStrength: null,
        costDistance: market.costDistance,
        signalStrength: 0,
        signalSemantics: 'missing-formula-input-not-confidence-or-win-probability',
        triggeredConditions: [],
        blockedReasons: ['缺少公式推导周期或对应 Delta 带'],
        missingInputs: missingFormulaInputs,
      },
    })
  }
  const deviation = deviationScore({
    costDistance: market.costDistance,
    annualVol: market.annualVol,
    formulaHorizonSessions,
    tradingDaysPerYear: inputs.tradingDaysPerYear,
  })
  const periodVol = deviation?.periodVol
  const zScore = deviation?.z ?? null
  if (!Number.isFinite(periodVol) || !Number.isFinite(zScore)) {
    return waitTiming({
      state: '波动待估计',
      reason: '周期波动或偏离值不可计算，默认挂单保持关闭。',
      facts: {
        regime: null,
        zScore: null,
        zStrength: null,
        costDistance: market.costDistance,
        signalStrength: 0,
        signalSemantics: 'missing-formula-input-not-confidence-or-win-probability',
        triggeredConditions: [],
        blockedReasons: ['周期波动不可计算'],
        missingInputs: ['period-volatility'],
      },
    })
  }
  const zAbs = Math.abs(zScore)

  const signalStrength = clamp(zAbs < 8 ? 1 - 2 * (1 - (0.5 + 0.5 * erfApprox(zAbs / Math.sqrt(2)))) : 1, 0, 1)

  // Dynamic edge: actual distance from cost, normalized by ATR
  const minEdge = Math.max(atr * executableProfile.edgeAtr, executableProfile.minEdge)
  const buyEdge = market.costAnchor > market.markPrice ? (market.costAnchor - market.markPrice) / market.markPrice : 0
  const sellEdge = market.markPrice > market.costAnchor ? (market.markPrice - market.costAnchor) / market.markPrice : 0

  const belowCost = market.markPrice < market.costLow
  const aboveCost = market.markPrice > market.costHigh
  const insideLongBand = !bands || market.markPrice >= bands.long.low
  const insideShortBand = !bands || market.markPrice <= bands.short.high
  const costStillFalling =
    market.costSlopeRecent < -Math.max(atr * executableProfile.costSlopeAtr, executableProfile.costSlopeMin)
  const momentumRising = market.momentumFast > executableProfile.momentumMin

  const regimeLabel = belowCost ? '折价区' : aboveCost ? '溢价区' : '成本回归区'
  const zLabel = zAbs < 0.5 ? '弱' : zAbs < 1.5 ? '中' : '强'
  const momThresh = Math.max(atr * 0.5, 0.005)
  const momentumLabel = market.momentumFast > momThresh ? '↑' : market.momentumFast < -momThresh ? '↓' : '→'
  const slopeThresh = Math.max(atr * 0.2, 0.002)
  const costTrendLabel =
    market.costSlopeRecent < -slopeThresh ? '↓降' : market.costSlopeRecent > slopeThresh ? '↑升' : '→平'

  const confHigh = Math.max(0.6, 1 - atr * 12)
  const confMid = Math.max(0.3, 1 - atr * 24)
  const baseFacts = {
    regime: regimeLabel,
    zScore,
    zStrength: zLabel,
    costDistance: market.costDistance,
    signalStrength,
    signalSemantics: 'normal-reference-extremeness-not-confidence-or-win-probability',
    triggeredConditions: [],
    blockedReasons: [],
    missingInputs: [],
  }

  function buildReason() {
    const parts = [
      `${regimeLabel} · Z=${zScore.toFixed(2)}σ · ${zLabel}`,
      `动量 ${momentumLabel}`,
      `成本 ${costTrendLabel}`,
    ]
    if (belowCost && momentumRising && !costStillFalling) parts.push('动量止跌条件满足')
    if (belowCost && (costStillFalling || !momentumRising)) parts.push('止跌条件未满足')
    if (aboveCost) parts.push('处于成本带上方')
    return parts.join(' · ')
  }

  if (belowCost && !insideLongBand) {
    return waitTiming({
      state: '低于波动带',
      reason: `价格 ${fmt(market.markPrice)} 低于波动带下沿 ${fmt(bands?.long?.low)}。`,
      facts: withFacts(baseFacts, {
        triggeredConditions: ['价格低于成本带', '价格低于 GetDelta 下沿'],
        blockedReasons: ['超出当前默认入场带，需要额外风控输入'],
      }),
    })
  }
  if (belowCost && (costStillFalling || !momentumRising)) {
    return waitTiming({
      state: '低于成本带',
      reason: `价格低于成本带 ${pctFmt(Math.abs(market.costDistance))}，但止跌条件未同时满足。`,
      facts: withFacts(baseFacts, {
        triggeredConditions: ['价格低于成本带'],
        blockedReasons: [
          costStillFalling ? '成本锚仍在下降' : null,
          !momentumRising ? '自适应快动量未越过策略档位阈值' : null,
        ].filter(Boolean),
      }),
    })
  }
  if (belowCost && buyEdge >= minEdge) {
    return activeTiming({
      state: '低于成本带',
      side: 'buy',
      action: signalStrength > confHigh ? '条件满足' : signalStrength > confMid ? '条件部分满足' : '条件观察',
      reason: buildReason(),
      signalStrength,
      edge: buyEdge,
      stop: Math.min(market.costLow, bands?.long.low ?? market.costLow),
      target: positive(inputs.horizonTargetPrice) ?? market.costLow,
      ...withFacts(baseFacts, {
        triggeredConditions: [
          '价格低于成本带',
          '成本未继续下行',
          '自适应快动量满足策略档位阈值',
          '折价幅度达到策略档位阈值',
        ],
      }),
    })
  }
  if (aboveCost && !explicitScenario && inputs.formulaHorizonSide !== 'short') {
    return waitTiming({
      state: '上沿周期待推导',
      reason: '当前周期绑定的是多头成本下沿修复，不能复用于上沿减仓；需独立推导 short-side 目标与周期。',
      facts: withFacts(baseFacts, {
        triggeredConditions: ['价格高于成本带'],
        blockedReasons: ['缺少与上沿方向及目标绑定的 short-side 周期'],
        missingInputs: ['short-side-target-horizon-binding'],
      }),
    })
  }
  if (aboveCost && !insideShortBand) {
    return waitTiming({
      state: '高于波动带',
      reason: `价格 ${fmt(market.markPrice)} 高于波动带上沿 ${fmt(bands?.short?.high)}。`,
      facts: withFacts(baseFacts, {
        triggeredConditions: ['价格高于成本带', '价格高于 GetDelta 上沿'],
        blockedReasons: ['模拟挂单不把研究层或高位状态翻译成追价动作'],
      }),
    })
  }
  if (aboveCost && sellEdge >= minEdge) {
    return activeTiming({
      state: '高于成本带',
      side: 'sell',
      action: signalStrength > confHigh ? '条件满足' : '条件部分满足',
      reason: buildReason(),
      signalStrength,
      edge: sellEdge,
      stop: Math.max(market.costHigh, bands?.short.high ?? market.costHigh),
      target: positive(inputs.horizonTargetPrice) ?? market.costHigh,
      ...withFacts(baseFacts, {
        triggeredConditions: ['价格高于成本带', '溢价幅度达到策略档位阈值'],
      }),
    })
  }
  if (zAbs < 0.5) {
    return waitTiming({
      state: '成本带内',
      reason: `偏离 ${zScore.toFixed(2)}σ，未达到信号条件。`,
      facts: withFacts(baseFacts, { blockedReasons: ['偏离幅度低于 0.5σ'] }),
    })
  }
  return waitTiming({
    state: regimeLabel,
    reason: `${regimeLabel} · 偏离 ${pctFmt(market.costDistance)} · 未达到信号条件`,
    facts: withFacts(baseFacts, { blockedReasons: ['价格位置或动量条件未同时满足'] }),
  })
}

function activeTiming(timing) {
  return { ...timing, path: timing.side === 'buy' ? '低于成本带条件链' : '高于成本带条件链' }
}

function waitTiming({ state, reason, facts }) {
  return {
    state,
    side: null,
    action: '未触发',
    path: '信号条件未触发',
    edge: 0,
    stop: null,
    target: null,
    reason,
    ...facts,
  }
}

function withFacts(baseFacts, patch = {}) {
  return {
    ...baseFacts,
    ...patch,
    triggeredConditions: patch.triggeredConditions ?? baseFacts.triggeredConditions,
    blockedReasons: patch.blockedReasons ?? baseFacts.blockedReasons,
    missingInputs: patch.missingInputs ?? baseFacts.missingInputs,
  }
}
