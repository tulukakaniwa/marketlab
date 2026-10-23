import { analyzeEthLpBundle } from '../../src/domain/market-impact/ethLpResearch.js'
import { analyzeEthMarketBundle } from '../../src/domain/market-impact/ethMarketSnapshot.js'
import { analyzeEthOptionsBundle } from '../../src/domain/market-impact/ethOptionsResearch.js'

export function validateResearchBundle(kind, bundle) {
  const analyzers = { lp: analyzeEthLpBundle, market: analyzeEthMarketBundle, options: analyzeEthOptionsBundle }
  const report = analyzers[kind](bundle)
  if (!['ready', 'verified', 'partial'].includes(report?.status)) throw new Error('research-domain-validation-failed')
  return kind === 'options' ? report.summary?.availableAt : report.availableAt
}
