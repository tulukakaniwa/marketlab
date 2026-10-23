import { analyzeEthOptionsBundle } from '../src/domain/market-impact/ethOptionsResearch.js'
import { parseArgs } from './eth-lp/localFiles.mjs'
import { readLocalOptionsBundle, saveOptionsAnalysis } from './eth-options/localFiles.mjs'

try {
  const args = parseArgs(process.argv.slice(2), ['--input', '--scenario', '--hedge-ratio', '--already-hedged-eth'])
  if (args.help) {
    console.info(
      'pnpm research:eth-options:analyze --input data/local-research/eth-options/FILE.json [--scenario passive-hedge] [--hedge-ratio 1] [--already-hedged-eth 0]',
    )
    console.info('默认只显示观测。显式 --scenario passive-hedge 才启用被动对手增量对冲假设。')
  } else {
    if (!args['--input']) throw new Error('--input is required')
    if (args['--scenario'] && args['--scenario'] !== 'passive-hedge') throw new Error('unsupported-scenario')
    const { path, bundle, sha256 } = await readLocalOptionsBundle(args['--input'])
    const report = analyzeEthOptionsBundle(bundle, {
      enabled: args['--scenario'] === 'passive-hedge',
      hedgeRatio: args['--hedge-ratio'] === undefined ? 1 : Number(args['--hedge-ratio']),
      alreadyHedgedEth: args['--already-hedged-eth'] === undefined ? 0 : Number(args['--already-hedged-eth']),
    })
    const output = await saveOptionsAnalysis(path, { inputSha256: sha256, ...report })
    console.info(
      JSON.stringify(
        {
          path: output,
          status: report.status,
          issues: report.issues,
          summary: report.summary,
          scenario: report.scenario,
          executionAuthority: report.executionAuthority,
        },
        null,
        2,
      ),
    )
    if (report.status === 'blocked' || report.scenario?.status === 'blocked') process.exitCode = 2
  }
} catch (error) {
  console.error(
    `ETH options analysis failed: ${String(error.message).replace(/https?:\/\/\S+/g, '[redacted-endpoint]')}`,
  )
  process.exitCode = 1
}
