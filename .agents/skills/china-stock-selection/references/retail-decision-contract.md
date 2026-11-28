# 交易决策纪律契约（Retail Decision Contract）

本契约用于约束候选排序、个股解读与模拟交易预案，目标是**用结构门禁过滤亏损陷阱，用清晰人话呈现可执行复核的事实**，既不制造虚假确定性，也不堆砌机械免责套话。

## 1. 四态独立原则

严禁把高评分直接等同于“可买”：

- `dataState`：`ready` / `provisional` / `stale` / `invalid`。本地日线 CSV 因缺少实时停复牌、除权公告与盘口深度，最新有效态统一为 `provisional`。
- `scoreStatus`：`diagnostic-high` / `diagnostic-medium` / `diagnostic-low`，仅反映多维几何与偏离打分高低，不授予入场权限。
- `candidateStatus`：`需刷新数据` / `剔除` / `等待` / `观察`。只有通过单调 AR 回归与右侧相位门禁才可进入 `观察`；`low-compression`（低位钝化）即使算出前向目标价，也必须保持 `等待`，防止左侧盲目抄底。
- `executionStatus`：静态环境下仅限 `blocked` 或 `simulation-only`，实盘下单需独立补齐实时盘口、账户风险预算与交割规则。

## 2. 最小决策底稿（Backing Record）

对重点分析标的，底稿需覆盖以下结构化要素（缺失项显式标注，不得编造）：

```text
instrument: 代码 / 带来源简称 / 市场（A股 | 港股）
data: 数据源 / dataThrough / K线根数 / staleDays / 启用过滤项
state: dataState / scoreStatus -> candidateStatus / executionStatus
thesis: 一句话可证伪的交易逻辑（例：筹码锚走平下的超跌右侧首轮修复至成本下沿）
claims: 关键量对应的证据等级（exact-identity | sample-estimate | calibrated-estimate | scenario-proxy | missing-input）
supportingEvidence: 支撑该逻辑的 domain 结构指标（折价深度、单调 AR 半衰期、止跌相位）
counterEvidence: 反面风险（成本斜率转负、样本偏短、缺乏基本面/财报事件核验）
invalidation: 明确的失效退场条件（跌破 GetDelta 下沿或预设止损、成本锚加速下移）
riskBudget: 账户单笔风险预算与模拟名义仓位（未配置本金时标为 unavailable）
executionGate: blocked | simulation-only 及缺失输入列表
nextCheck: 下一步观察触发点（如次日开盘跳空重算周期、观察能否站回 costLow）
```

## 3. 面向用户的五问精简视图

主回复直接回答交易者最关心的五个问题：

1. **数据够新吗？**（截止日、样本量、是否过期）
2. **当前什么状态？**（`观察` / `等待` / `剔除`）
3. **核心依据是什么？**（成本折价、AR 半衰期、右侧止跌是否共振）
4. **哪里算错离场？**（明确的价格失效线或结构破坏条件）
5. **下一步盯什么？**（次日开盘重绑定、第一目标 `costLow` 保本棘轮、或需补充的盘前核查）

## 4. 仓位与历史回放准则

- **仓位计算前提**：必须具备账户权益、单笔最大亏损预算、T+1/T+0 制度、整手规则与交易摩擦假设；否则只展示条件收益率情景，不给具体股数。
- **A 股 T+1 纪律**：收盘信号最早次日开盘成交，且成交当日不可卖出（`settlementLagSessions=1`）；日内同 K 线同时触及止盈止损时，一律按保守止损优先（`stop-first-conservative-when-both-hit`）结算。
- **回放统计完整性**：汇报回放表现时，除胜率与均值外，必须同时给出交易笔数、中位数、下分位（P10/最差单笔）与费率假设，区分样本内回放与样本外验证。

## 5. 表达规范

- **标准状态词**：`观察`、`等待`、`剔除`、`需刷新数据`、`结构目标`、`条件情景`、`失效线`。
- **禁用误导词**：严禁输出 `必涨`、`确定反转`、`无脑抄底`、`回归概率`、`做市商囤满`、`稳赚手续费`、`机构托底` 或未经限定的 `预期月化收益`。展示历史回放或 AR 投影收益时，明确冠以 `历史回放净收益` 或 `零冲击条件空间`。
