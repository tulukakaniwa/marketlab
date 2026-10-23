import { collectEthOptionsSnapshot } from './eth-options/collect.mjs'
import { saveOptionsBundle } from './eth-options/localFiles.mjs'
import { parseArgs } from './eth-lp/localFiles.mjs'

try {
  const args = parseArgs(process.argv.slice(2), ['--trades'])
  if (args.help) {
    console.info('pnpm research:eth-options:collect [--trades 30]')
    console.info('Deribit 生产公共数据；最近 1–30 笔成交、最多 12 个期权 ticker、ETH-PERPETUAL 深度 20。')
    console.info('仅保存到 data/local-research/eth-options/；这不是完整历史，也不是做市商仓位。')
  } else {
    const bundle = await collectEthOptionsSnapshot({
      tradeCount: args['--trades'] === undefined ? 30 : Number(args['--trades']),
      onProgress: (message) => console.error(JSON.stringify(message)),
    })
    const path = await saveOptionsBundle(bundle)
    console.info(
      JSON.stringify(
        {
          path,
          kind: bundle.kind,
          collectedAt: bundle.collectedAt,
          scope: bundle.provenance.scope,
          trades: bundle.trades.length,
          tickers: bundle.tickers.length,
          quality: bundle.provenance.quality,
          completeHistory: false,
        },
        null,
        2,
      ),
    )
  }
} catch (error) {
  console.error(
    `ETH options collection failed: ${String(error.message).replace(/https?:\/\/\S+/g, '[redacted-endpoint]')}`,
  )
  process.exitCode = 1
}
