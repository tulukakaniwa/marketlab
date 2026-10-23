import { collectEthMarketSnapshot } from './eth-market/collect.mjs'
import { saveMarketBundle } from './eth-market/localFiles.mjs'
import { parseArgs } from './eth-lp/localFiles.mjs'

function utcTimestamp(value) {
  if (value === undefined) return undefined
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new Error('start/end requires an ISO timestamp with timezone')
  }
  const result = Date.parse(value)
  if (!Number.isSafeInteger(result) || result <= 0) throw new Error('Invalid start/end timestamp')
  return result
}

try {
  const args = parseArgs(process.argv.slice(2), ['--interval', '--start', '--end', '--limit'])
  if (args.help) {
    console.info('pnpm research:eth-market:collect [--interval 5m|1h] [--start ISO] [--end ISO] [--limit 288]')
    console.info('Binance ETHUSDT 公共真实 K 线；按交易所服务器时间仅保留已闭合区间，最多 1000 根。')
    console.info('仅写入 data/local-research/eth-market/，保留原始字段、响应摘要、UTC 开收盘时间。')
  } else {
    const bundle = await collectEthMarketSnapshot({
      interval: args['--interval'] ?? '5m',
      startTime: utcTimestamp(args['--start']),
      endTime: utcTimestamp(args['--end']),
      limit: args['--limit'] === undefined ? 288 : Number(args['--limit']),
    })
    const path = await saveMarketBundle(bundle)
    console.info(
      JSON.stringify(
        {
          path,
          source: bundle.source,
          symbol: bundle.symbol,
          interval: bundle.interval,
          collectedAt: bundle.collectedAt,
          serverTime: new Date(bundle.serverTime).toISOString(),
          candles: bundle.candles.length,
          firstOpen: new Date(bundle.candles[0].openTime).toISOString(),
          lastClose: new Date(bundle.candles.at(-1).closeTime).toISOString(),
          quality: bundle.provenance.quality,
        },
        null,
        2,
      ),
    )
  }
} catch (error) {
  console.error(
    `ETH market collection failed: ${String(error.message).replace(/https?:\/\/\S+/g, '[redacted-endpoint]')}`,
  )
  process.exitCode = 1
}
