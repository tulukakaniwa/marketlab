import { collectEthLpWindow } from './eth-lp/collect.mjs'
import { replayPoolEvents } from '../src/domain/market-impact/uniswapV3Replay.js'
import { parseArgs, saveBundle } from './eth-lp/localFiles.mjs'

try {
  const args = parseArgs(process.argv.slice(2), ['--blocks', '--word-radius', '--end-block'])
  if (args.help) {
    console.info('pnpm research:eth-lp:collect [--blocks 100] [--word-radius 1] [--end-block NUMBER]')
    console.info('ETH_RPC_URL 可覆盖只读 RPC；默认使用 finalized 区块。输出只在 data/local-research/eth-lp/。')
  } else {
    const bundle = await collectEthLpWindow({
      rpcUrl: process.env.ETH_RPC_URL || 'https://ethereum-rpc.publicnode.com',
      blockCount: args['--blocks'] === undefined ? 100 : Number(args['--blocks']),
      wordRadius: args['--word-radius'] === undefined ? 1 : Number(args['--word-radius']),
      endBlock: args['--end-block'] === undefined ? undefined : Number(args['--end-block']),
      onProgress: (message) => console.error(typeof message === 'string' ? message : JSON.stringify(message)),
    })
    const verification = replayPoolEvents(bundle, { includeSteps: false })
    const path = await saveBundle(bundle)
    console.info(
      JSON.stringify(
        {
          path,
          status: verification.status,
          issues: verification.issues,
          seedBlock: bundle.seed.block.number,
          endBlock: bundle.checkpoint.block.number,
          events: bundle.events.length,
          ticks: bundle.seed.ticks.length,
          scope: 'local-research',
        },
        null,
        2,
      ),
    )
    if (verification.status !== 'verified') process.exitCode = 2
  }
} catch (error) {
  // Do not echo transport URLs or provider response bodies: URLs may contain credentials.
  console.error(`ETH LP collection failed: ${String(error.message).replace(/https?:\/\/\S+/g, '[redacted-endpoint]')}`)
  process.exitCode = 1
}
