# ETH LP 本地研究接入

第一阶段接入 Ethereum Uniswap v3 WETH/USDC 0.05% 池：
`0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640`。
采集、验证、分析通过 Node CLI 完成，不进入静态部署的数据流水线。

## 运行

```sh
pnpm research:eth-lp:collect --blocks 100 --word-radius 1
pnpm research:eth-lp:analyze --input data/local-research/eth-lp/文件名.json
pnpm research:eth-lp:verify-quoter --input data/local-research/eth-lp/文件名.json
pnpm test:eth-lp
```

默认 RPC 是 `https://ethereum-rpc.publicnode.com`，可用 `ETH_RPC_URL` 环境变量覆盖。
端点必须能读取固定历史区块状态。不要把带密钥的 URL 放进命令参数、提交或研究报告。
默认终点为 finalized 区块，`--end-block` 可指定更早区块。
采集器限制窗口、bitmap word 数和 tick 数；超出限制需拆成多个窗口。

默认比较两笔独立假设订单：卖出 1 WETH，或用 5,000 USDC 买 WETH。
可用 `--base-raw` / `--quote-raw` 传入正整数原子单位，分别按 18 / 6 位小数换算。
这些是可调的深度探针，不是配置权重、仓位建议或预期真实订单。

`verify-quoter` 在同一 checkpoint 区块对六笔双向探针调用官方 QuoterV2，逐整数核对
输出金额与成交后平方根价格。它只使用 `eth_call`，不签名、不发交易。
测试超出本地覆盖范围时明确为未完成比较；网络验收独立于普通离线测试。

## 数据与证据契约

- 所有输出保存在 `data/local-research/eth-lp/`，已加入 Git 忽略。
  原始数据不进入 `public/`、`src/data/`、自动刷新 workflow 或构建产物。
- 文件包含原始 logs、解码事件、连续区块头、seed、checkpoint、池元数据、采集时间和覆盖范围。
  外层 SHA-256 用于检测本地文件意外变更，不是来自第三方的签名或真实性证明。
- seed 在 `B0` 的块末；事件窗口为 `[B0+1, B1]`；checkpoint 在 `B1` 的块末。
  状态读取锁定区块，区块 hash、父链与重读结果必须一致。
- tick 数据保存有符号 `liquidityNet` 和绝对 `liquidityGross`；L 是协议单位，不是美元资金。
  coverage 表示已完整枚举 bitmap 的 tick 范围；范围外深度未知。
- 事件按 `(blockNumber, transactionIndex, logIndex)` 排序。
  removed、重复、区块不连续、raw log 与解码值不匹配、末状态不匹配都使回放 blocked。
  “verified”表示同一 RPC 数据包内证据一致，不表示已独立验证节点或取得全市场数据。
- `eventTime` 是区块时间；`availableAt` / `fetchedAt` 是本次采集可用时间。
  历史重建不代表当时已取得数据；不能拿此包回填无未来数据的策略历史。

## 领域职责

| 模块                                                 | 职责                                              |
| ---------------------------------------------------- | ------------------------------------------------- |
| `scripts/eth-lp/`                                    | 只读 RPC、固定块状态与日志采集、本地文件 I/O      |
| `uniswapV3EventEvidence` / `uniswapV3ReplayEvidence` | ABI、来源、顺序、状态与覆盖资格                   |
| `uniswapV3Replay`                                    | 纯事件状态转移与末状态核对                        |
| `uniswapV3Math` / `uniswapV3Quote`                   | BigInt 协议舍入、手续费、跨 tick exact-input 报价 |
| `ethLpResearch`                                      | 同一订单在每次 LP 动作前后的条件冲击比较          |

Mint/Burn 改变区间流动性；只有覆盖当前 tick 的区间改变当前 active L。
它们不直接移动 `sqrtPriceX96`。Burn 记入应收本金，Collect 可领取本金和费用，均不能自动视为卖出。
Swap 保存池收到的正数量、付出的负数量以及事件末状态。回放用之前的状态与穿越 tick 核对 L；
该事件末价格不作为此前报价的输入。checkpoint 只做验收，不反向修正 seed 或历史步骤。
事件快照的 `cursor` 明确标注 before-log / after-log 及交易、日志序号；它们不是块末状态。
固定区块的 Quoter 只能直接校验 end-of-block 状态，不能据此宣称已经验过区块内每个事件的报价。

报价的原子数量、价格平方根与 L 均采用整数计算。展示价格才转 Number，价格单位是 **USDC/WETH**，
不假设 USDC 恒等于 USD。费用计入输入；gas、路由、多池套利、MEV 与用户滑点保护不在模型内。
计算保留 bitmap word 边界的舍入，并能穿越零 L 区间；到未知覆盖边界或步数上限则返回 `partial`。
`partial` 的均价只描述已成交部分，不能当作整笔订单的报价。

- `marginalImpactBps`：成交后边际池价相对初始价的有符号变化。
- `executionImpactBps`：含池手续费的平均成交价相对初始价的有符号变化。
- `unfilledAmountInRaw`：未成交输入，不能丢弃或补零伪造完整成交。
- 所有输出 `executionAuthority: 'none'`，不改变 `GetDelta`、`OrderPlan` 或默认挂单。

LP 动作前后比较只回答条件问题：“相同订单遇到不同深度会怎样？”
它不证明 LP 动作导致全市场 ETH 价格变化，也不识别 LP 最终持有人或撤资动机。

## 后续接入边界

期权模块应另行接入合约规格、逐笔成交、IV/Greeks 与标的执行市场深度。
公开 OI 与吃单方向不能直接识别做市商净库存；目标对冲需求和实际对冲成交必须分列。
研究查询经 ViewModel 投影到现有研究图层，保持规划查询与研究快照分离。
现有 store、图表、GetDelta 和 OrderPlan 保持独立。
期权快照与本地研究入口见 [ETH 期权研究](./eth-options-research.md)。

## 参考与许可

算法参照 [Uniswap v3-core](https://github.com/Uniswap/v3-core) 的 TickMath、SqrtPriceMath、
SwapMath、TickBitmap 和池事件接口。移植说明和完整许可见 `public/licenses/uniswap-v3/`。
RPC 的固定区块语义参照 [EIP-1898](https://eips.ethereum.org/EIPS/eip-1898)。
