import { analyzeEthLpBundle } from '../src/domain/market-impact/ethLpResearch.js'
import { parseArgs, readLocalBundle, saveAnalysis } from './eth-lp/localFiles.mjs'

try {
  const args = parseArgs(process.argv.slice(2), ['--input', '--base-raw', '--quote-raw'])
  if (args.help) {
    console.info(
      'pnpm research:eth-lp:analyze --input data/local-research/eth-lp/FILE.json [--base-raw 1000000000000000000] [--quote-raw 5000000000]',
    )
    console.info('比较每次 Mint/Burn 前后同一笔假设订单；base 为 WETH 原子单位，quote 为 USDC 原子单位。')
  } else {
    if (!args['--input']) throw new Error('--input is required')
    const { path, bundle, sha256 } = await readLocalBundle(args['--input'])
    const report = analyzeEthLpBundle(bundle, {
      baseAmountRaw: args['--base-raw'],
      quoteAmountRaw: args['--quote-raw'],
    })
    const output = await saveAnalysis(path, { inputSha256: sha256, ...report })
    console.info(
      JSON.stringify(
        {
          path: output,
          status: report.status,
          issues: report.issues,
          counts: report.counts,
          actions: report.actions?.length,
          endpointQuotes: report.endpointQuotes,
          executionAuthority: report.executionAuthority,
        },
        null,
        2,
      ),
    )
    if (report.status !== 'verified') process.exitCode = 2
  }
} catch (error) {
  console.error(`ETH LP analysis failed: ${error.message}`)
  process.exitCode = 1
}
