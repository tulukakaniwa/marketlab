# ETH 期权快照与工作台研究面板

期权接入保存 Deribit 公共观测数据，计算增量对冲情景；数据仅用于本地研究。
不从 OI 推断做市商净仓，也不把公开成交视为已观测到的对冲。

## 运行

```sh
pnpm research:eth-options:collect --trades 12
pnpm research:eth-options:analyze --input data/local-research/eth-options/文件名.json
pnpm dev --host 127.0.0.1
```

打开开发服务显示的地址，从现有 Market Lab 顶栏进入“市场冲击研究”（移动端在“更多”菜单），分别导入 LP 和期权原始数据包。
页面在浏览器本地校验 SHA-256 并交由 Worker 分析，不上传文件，不直接调用交易所。
LP 数据包用 `research:eth-lp:collect` 生成，详情见 [ETH LP 接入](./eth-lp-research.md)。

研究面板由 App 懒加载，在同一工作台内打开；返回行情图时保留图表和研究状态。
它使用独立研究 ViewModel，不修改 labStore 或量价地图的规划查询。
`pnpm run build` 将面板代码打入静态 `dist/`，本地数据留在忽略目录，不进入部署产物。
开发服务使用 loopback 地址；本地数据目录由 Vite 文件访问规则阻止直接读取。

## 采集范围

生产 Deribit 公共 GET：当前 ETH 期权合约规格、最近有限笔成交、最多 12 个相关合约 ticker，
以及 ETH-PERPETUAL 的合约规格与 20 档盘口。支持 `--trades 1…30`，默认 30。
超过 ticker 覆盖范围的成交保留并标记缺口；不静默补值，不宣称完整市场历史。
采集成功不代表不同接口提供同一原子快照，必须检查时间差。
`availableAt` 保守取客户端采集完成与来源时间戳的最大值，保留毫秒时钟偏差；
超出 JavaScript 安全整数范围的交易所编号、纳秒时间保留为十进制字符串。

本地文件位于 `data/local-research/eth-options/`，包含原始响应与完整性摘要。
Deribit 公共行情可读不代表可公开再分发；当前实现没有发布这些数据的路径。

## 观测与情景

观测包括：吃单方向、ETH 数量、成交价、采集时 IV/Greeks、OI、标的盘口及各自时间戳。
未知量包括：开平仓、客户/做市商身份、初始净库存、实际对冲时间与场所。

情景仅在用户显式开启“被动对手方对冲”时计算：

1. 假设近期成交的被动对手方承担交易篮子库存变化。
2. 用**采集时** ticker 重估这批交易的增量 Delta，不能称为成交当时的对冲需求。
3. 逆向 ETH 期权使用 NTD = BS Delta − ETH 计价 markPrice；仅适用已校验的合约规格。
4. 根据用户设置的对冲比例，扣除已经完成的有符号增量对冲，得到剩余 ETH 等价需求。
5. 买入需求消耗永续 asks，卖出需求消耗 bids；盘口 USD 数量除以各档价格得到 ETH 等价量。

盘口结果是连续深度估计，未按最小合约单位取整；美元量表示名义合约金额，不是实际支付的保证金。
平均成交价、边际价格变化、未填满需求分开输出。它不是可以直接提交给交易所的订单。
不把当前期权数据自动接到更早的 LP 区块上，两个市场的时间与报价币种分别显示。

所有查询 `executionAuthority: 'none'`。研究页和 CLI 不修改 GetDelta、OrderPlan 或默认计划。
快照过期、缺少合约/Greeks、单位不支持或深度不足时必须显示状态，不能用零值冒充观测。

## 来源

- [Deribit ticker 与 Greeks 口径](https://docs.deribit.com/api-reference/market-data/public-ticker)
- [合约规格接口](https://docs.deribit.com/api-reference/market-data/public-get_instruments)
- [标的订单簿](https://docs.deribit.com/api-reference/market-data/public-get_order_book)
- [Deribit FZE 使用条款](https://support.deribit.com/hc/en-us/articles/25944532191645-Deribit-Exchange-Membership-Terms-Deribit-FZE)
