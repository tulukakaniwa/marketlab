---
name: china-stock-selection
description: Use this skill for Market Lab A-share and Hong Kong stock screening, dynamic holding-state timing, T+1 structural short-hold replay, and multi-strategy trading plan construction around cost anchors, monotonic AR(1) horizons, GetDelta price bands, and synthetic CK geometry.
---

# A股 / 港股结构化选股与交易计划（China Stock Selection）

基于 Market Lab 本地因果算子体系，从 `src/data/stock-index.json` 与 `public/data/*.csv` 构建带数据源溯源的 A 股 / 港股候选池、右侧入场门禁与 T+1 历史回放。Canonical implementation: `.agents/skills/china-stock-selection`。

## 必读参考路由

- 输出候选分析、持仓状态或操作预案前，先读 `references/retail-decision-contract.md`。
- 调用 CLI 或解析 JSON 字段前，先读 `references/cli-contract.md`。
- 解释 CK、LP、AMM、期权 Greeks、波动率或组合归因字段前，先读 `references/formula-risk-contract.md`。
- `references/stock-names.json` 仅作本地中文简称映射，不代表实时证券主数据。

---

## 核心算法如何组合出正期望策略

不要用 MA / RSI / KDJ 等滞后均线指标（本 Skill 严禁接入此类指标）。我们的核心超额收益来自 **四个正交结构算子的串联过滤**：

1. **真实成交量成本结构（`costAnchor` / `costLow` / `costHigh` / `costSlopeRecent`）**
   - 识别真实筹码换手重心。做多只在现价跌破 `costLow`（折价区）且 `costSlopeRecent` 未坍塌（主力成本锚走平或抬升）时寻找机会，拒绝在成本重心加速下移的价值毁灭趋势中接飞刀。
2. **内生单调 AR(1) 修复周期（`arCoefficient` $\in (0,1)$ + `halfLifeSessions`）**
   - 仅保留满足过原点单调均值回归（`decayMode=monotonic-decay`）的标的。利用精确恒等式：
     $$q = \frac{P_{\text{target}} - P_{\text{start}}}{P_{\text{anchor}} - P_{\text{start}}}, \qquad H = \left\lceil \text{HL} \cdot \log_2\frac{1}{1 - q} \right\rceil$$
     内生推导结构目标周期 `modelHorizonSessions`，严禁使用 5/10/30/60/90 天等拍脑袋固定持仓期或 `0.875` 硬编码比例。
3. **右侧回撤相位门禁（`dynamicHolding` 相位过滤）**
   - 偏离极值（`deviationScore` / `synthetic CK geometry` 低分位）只说明“跌得深”，**不是未来回归概率（`probabilitySemantics`: normal-reference extremeness, not a future mean-reversion probability）**。
   - 必须等待相位从 `falling-expansion`（急跌扩张）与 `low-compression`（低位钝化，保持 `等待`）切换至 **`repair-start`（止跌修复启动）或 `mean-reverting`（回归中）**，才升级为 `观察`。
4. **`GetDelta` 价格带梯队、T+1 开盘重绑定与保本棘轮退出**
   - **T+1 信号重算**：日线收盘出信号后，次日开盘价若仍在允许跳空范围内，按实际开盘价重新计算 $q$ 与 `modelHorizonSessions`。
   - **分批与风控**：挂单落在 `[现价, √(现价·GetDelta下沿), GetDelta下沿]`；第一结构目标 `costLow` 触达后可将防守线提至保本位，博弈第二中枢目标 `costAnchor`；若跌破止损线或耗尽 `modelHorizonSessions` 未达标则纪律离场。

---

## 标准执行工作流

```bash
# 1. 校验本地数据覆盖与生成模块完整性
pnpm run check:data && pnpm run check:generated-data

# 2. 运行 A+H 全市场结构筛选（JSON 供精确分析，markdown 供速览）
node .agents/skills/china-stock-selection/scripts/screen-cn-stocks.mjs --market A股,港股 --top 20 --format json

# 3. 扫描当前最新交易日满足右侧门禁的实时信号（--fee 必填，0 表示零费率基准）
node .agents/skills/china-stock-selection/scripts/replay-short-hold.mjs --profile combo --mode latest --market A股,港股 --fee 0.0011

# 4. 历史 T+1 非重叠回放验证（含双边综合费率拖累，如千分之 1.1）
node .agents/skills/china-stock-selection/scripts/replay-short-hold.mjs --profile combo --mode replay --market A股 --fee 0.0011
```

常用参数变体：

```bash
# 港股独立筛选（港股自动绕过仅限 A 股的社保白名单，且无 T+1 隔日卖出限制）
node .agents/skills/china-stock-selection/scripts/screen-cn-stocks.mjs --market 港股 --top 15 --format json

# 显式传入期权到期会话情景（绝不可把股票修复周期当作期权到期日）
node .agents/skills/china-stock-selection/scripts/screen-cn-stocks.mjs --market 港股 --top 10 --format json --option-tenor-sessions 30

# 关闭特定行业排除或社保过滤
node .agents/skills/china-stock-selection/scripts/screen-cn-stocks.mjs --market A股 --require-shebao false --exclude-banks false
```

---

## 评分与四态分离契约（硬约束）

### 诊断评分（满分 100 分，仅作同档排序，不可越权）

| 维度 | 权重 | 作用 |
| --- | ---: | --- |
| 成本结构（Cost Structure） | 30 | 衡量折价深度与近期成本斜率稳定性 |
| 合成几何（`synthetic CK geometry`） | 35 | 基于 `liquidity=1`、ATR 对称区间的无量纲形状诊断（非真实 LP 仓位、非手续费收益） |
| 偏离极端度（Deviation Extremeness） | 25 | 同周期标准化 Z 偏离与历史经验分位（非胜率或回归概率） |
| 数据完整度（Data Completeness） | 10 | 新鲜度与自适应前缀样本厚度（无全局固定行数门槛） |

### 四态严格独立（高分绝不能覆盖门禁阻断）

每条候选记录必须同时保留并区分四个状态：
1. `dataState`：`provisional` / `stale` / `invalid`（本地静态 CSV 未含实时停复牌、除权与盘口深度，正常最新态标记为 `provisional`）。
2. `scoreStatus`：`diagnostic-high` / `diagnostic-medium` / `diagnostic-low`（纯诊断分档）。
3. `candidateStatus`：`观察` / `等待` / `剔除` / `需刷新数据`（经 `dynamicHolding` 与 `orderPlan.blockedReasons` 联合门禁过滤后的真实候选态；排序先按 `candidateStatus`，再按组内 `score`）。
4. `executionStatus`：`blocked` / `simulation-only`（缺账户资金、单笔风险预算、实时盘口与滑点输入时保持 `blocked`，静态 Skill 永不直接输出实盘可执行指令）。

所有非平凡结论必须按 `references/formula-risk-contract.md` 标注 `exact-identity`、`sample-estimate`、`calibrated-estimate`、`scenario-proxy` 或 `missing-input`。

---

## 输出清单（精炼人话，拒绝废话套话）

向用户汇报筛选或回放结论时，保持紧凑、直接、可执行复核：

1. **数据基线**：市场范围、数据截止日 `dataThrough`、K 线根数、`staleDays`、是否启用 A 股社保过滤与行业剔除。
2. **门禁状态**：直接给出 `candidateStatus`（`观察 / 等待 / 剔除`）与一句话核心原因。
3. **结构坐标**：现价、成本下沿 `costLow`（第一修复目标）、成本锚 `costAnchor`（中枢目标）、`GetDelta` 支撑带、AR 半衰期与条件修复会话数。
4. **反证与失效线**：指出什么情况代表逻辑证伪（如成本锚加速下移、跌破止损位、回放同 K 线止损优先 `stop-first-conservative-when-both-hit`）。
5. **下一步动作**：进入主图打开「结构低吸 / 全天候组合」策略图层核对历史信号，或补齐账户本金与费率做模拟挂单测算。
