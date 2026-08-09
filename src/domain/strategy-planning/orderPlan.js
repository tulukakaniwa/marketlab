import { buildFormulaStrategyComposition } from './formulaStrategy.js'
import { buildAccount, buildDecision, buildExecutableContext, emptyGraph } from './orderPlanContext.js'
import { buildExecutionPlan, buildPositionPlan } from './orderPlanExecution.js'
import { buildEntryTiming } from './orderPlanTiming.js'
import {
  resolveExecutableProfile,
  resolveProfile,
  scaleProfileToMarket,
  strategyProfileList,
  strategyProfiles,
} from './strategyProfile.js'

export { buildExecutionPlan, buildPositionPlan } from './orderPlanExecution.js'
export { buildEntryTiming } from './orderPlanTiming.js'
export { resolveExecutableProfile, resolveProfile, scaleProfileToMarket, strategyProfileList, strategyProfiles }

export function buildDecisionGraph({ market, input, account }) {
  if (!market) return emptyGraph()
  const executable = buildExecutableContext({ market, input })
  const profile = resolveExecutableProfile(input?.strategyProfile, market, input)
  const nextAccount = buildAccount({ account, input, markPrice: market.markPrice })
  const timing = buildEntryTiming(market, executable.deltaBands, profile, executable.inputs)
  const position = buildPositionPlan(timing, executable.deltaBands, nextAccount, profile, market, executable.inputs)
  const plan = buildExecutionPlan(position, executable.deltaBands, nextAccount, market)
  const formulaStrategy = buildFormulaStrategyComposition({
    market,
    executable,
    timing,
    position,
    plan,
    account: nextAccount,
  })

  return {
    ...executable,
    formulaStrategy,
    profile,
    account: nextAccount,
    position,
    decision: buildDecision({
      market,
      timing,
      position,
      formulaHorizonSessions: position.formulaHorizonSessions ?? executable.inputs.formulaHorizonSessions,
    }),
    plan,
  }
}
