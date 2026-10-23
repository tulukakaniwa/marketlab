import { quoteExactInput } from '../src/domain/market-impact/uniswapV3Quote.js'
import { replayPoolEvents } from '../src/domain/market-impact/uniswapV3Replay.js'
import { parseArgs, readLocalBundle, saveAnalysis } from './eth-lp/localFiles.mjs'
import { createRpcClient } from './eth-lp/rpc.mjs'
import { argument, words, uint, header, quantity } from './eth-lp/abi.mjs'

// Official Ethereum deployment and static tuple ABI:
// https://developers.uniswap.org/docs/protocols/v3/deployments/v3-ethereum-deployments
// https://github.com/Uniswap/v3-periphery/blob/main/contracts/interfaces/IQuoterV2.sol
const QUOTER = '0x61ffe014ba17989e743c5f6cb21bf9697530b21e'
const SELECTOR = '0xc6a5026a' // quoteExactInputSingle((address,address,uint256,uint24,uint160))
const probes = [
  [1, '1000000000000000000'],
  [1, '100000000000000000000'],
  [1, '1000000000000000000000'],
  [0, '5000000000'],
  [0, '500000000000'],
  [0, '5000000000000'],
]

try {
  const args = parseArgs(process.argv.slice(2), ['--input'])
  if (args.help) {
    console.info('pnpm research:eth-lp:verify-quoter --input data/local-research/eth-lp/FILE.json')
    console.info('只通过 eth_call 查询固定区块的 QuoterV2；不会签名、发交易或消耗钱包资金。')
  } else {
    if (!args['--input']) throw new Error('--input is required')
    const { path, bundle, sha256 } = await readLocalBundle(args['--input'])
    const replay = replayPoolEvents(bundle, { includeSteps: false })
    if (replay.status !== 'verified') throw new Error(`replay-blocked: ${replay.issues.join(',')}`)
    const rpc = createRpcClient({ url: process.env.ETH_RPC_URL || 'https://ethereum-rpc.publicnode.com' })
    if ((await rpc.call('eth_chainId', [])) !== '0x1') throw new Error('not-ethereum-mainnet')
    const block = bundle.checkpoint.block
    const before = header(await rpc.call('eth_getBlockByNumber', [quantity(block.number), false]))
    if (before.hash !== block.hash) throw new Error('checkpoint-no-longer-canonical')
    const results = []
    for (const [tokenIn, amountInRaw] of probes) {
      const local = quoteExactInput({ pool: bundle.pool, state: replay.state, tokenIn, amountInRaw })
      if (local.status !== 'complete') {
        results.push({ tokenIn, amountInRaw, status: 'not-compared', reason: local.reason })
        continue
      }
      const data =
        SELECTOR +
        [
          bundle.pool[`token${tokenIn}`].address,
          bundle.pool[`token${1 - tokenIn}`].address,
          amountInRaw,
          bundle.pool.feePips,
          0,
        ]
          .map(argument)
          .join('')
      const raw = await rpc.call('eth_call', [
        { to: QUOTER, data, gas: '0x7a1200' },
        { blockHash: block.hash, requireCanonical: true },
      ])
      const response = words(raw, 4)
      const amountOutRaw = uint(response[0]).toString()
      const sqrtPriceX96After = uint(response[1], 160).toString()
      results.push({
        tokenIn,
        amountInRaw,
        status:
          local.amountOutRaw === amountOutRaw && local.sqrtPriceX96After === sqrtPriceX96After ? 'matched' : 'mismatch',
        local: { amountOutRaw: local.amountOutRaw, sqrtPriceX96After: local.sqrtPriceX96After },
        reference: { amountOutRaw, sqrtPriceX96After, initializedTicksCrossed: Number(uint(response[2], 32)) },
      })
    }
    const after = header(await rpc.call('eth_getBlockByNumber', [quantity(block.number), false]))
    if (after.hash !== block.hash) throw new Error('checkpoint-changed-during-verification')
    const status = results.every((result) => result.status === 'matched') ? 'matched' : 'incomplete-or-mismatch'
    const report = {
      status,
      inputSha256: sha256,
      block,
      quoter: QUOTER,
      checkedAt: new Date().toISOString(),
      scope: 'local-research',
      executionAuthority: 'none',
      results,
    }
    const output = await saveAnalysis(path, report, 'quoter-check')
    console.info(JSON.stringify({ path: output, ...report }, null, 2))
    if (status !== 'matched') process.exitCode = 2
  }
} catch (error) {
  console.error(
    `Quoter verification failed: ${String(error.message).replace(/https?:\/\/\S+/g, '[redacted-endpoint]')}`,
  )
  process.exitCode = 1
}
