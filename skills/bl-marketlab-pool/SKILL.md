---
name: bl-marketlab-pool
description: '读取 Market Lab 标准推荐观察池快照（v5 契约），生成清晰可读的研究摘要或企业微信简报；仅在用户明确要求时推送 webhook。'
---

# Market Lab 研究观察池简报（bl-marketlab-pool）

## 职责与边界

本 Skill 读取 `pnpm run generate:recommended-pool` 生成的权威 JSON 快照，校验数据时效与四态契约，输出紧凑、说人话的观察池简报；**仅在用户明确要求发送且提供 webhook 时调用推送**。

核心语义红线：

- **不二次算分、不越权升级**：直接消费快照中的 `candidateStatus`（`观察 / 等待 / 剔除 / 需刷新数据`）、`scoreStatus` 与 `executionStatus`；高诊断分不能把 `等待` 改写为 `观察`。
- **规范字段口径**：统一使用 `*Sessions` 与 `arCoefficient`（如 `halfLifeSessions`、`formulaHorizonSessions`），若读到旧版 `halfLifeDays`、`halfLifeRho`、`regressionProbability`、`entryTargetPrice` 等废弃字段，立即标记 `legacy-contract` 并停止推送。
- **准确表述算法含义**：
  - `zScore` / `deviationPercentile` / `twoSidedTailProbability` 度量偏离极端度，不是未来回归概率；
  - `syntheticCkGeometry` 是基于滚动成本锚的无量纲形状分位，不是真实链上 LP 仓位或手续费收益；
  - `annualVol` 为历史已实现波动情景值（非期权市场 IV）。

## 数据源路径

1. **本地权威快照（优先）**：
   - 最新：`src/data/recommended-pool-latest.json`
   - 历史按日：`src/data/recommended-pools/stock-pool-<YYYY-MM-DD>.json`
   - 若本地文件不存在或需刷新，先执行：`pnpm run generate:recommended-pool`
2. **远程静态站点（当指定 `siteUrl` 时）**：
   - 页面核对：`${siteUrl}/recommended-pool/`

## 标准数据契约（`market-lab.recommended-pool-report.v5`）

重点核验以下顶层与候选字段：

- `schemaVersion`: `"market-lab.recommended-pool-report.v5"`
- `generatedAt`, `generatedDate`, `evidenceDigest`, `markets`, `totalCandidates`
- `canonicalSummary.freshness`: `newestDataThrough`, `maxStaleDays`, `staleThresholdDays`（超过 `staleThresholdDays` 必须在首行提示数据滞后）
- `canonicalSummary.statusCounts`: `{ 观察, 等待, 剔除, 需刷新数据 }` 与 `latestSignalCount`
- 候选条目：包含 `symbol`, `name`, `market`, `dataThrough`, `candidateStatus`, `score`, `cost`, `deviation`, `meanReversion`（`arCoefficient`, `halfLifeSessions`）, `dynamicHolding`（`phaseLabel`, 第一目标 `costLow` 与中枢 `costAnchor`）。

## 输出模板

### 1. 详版简报（`narrative`）

```markdown
【Market Lab 结构观察池 · {generatedDate}】
覆盖：{markets} 共 {totalCandidates} 只（观察 {观察数} · 等待 {等待数} · 数据截止 {newestDataThrough}）

1. {name}（{symbol} · {market}）｜状态：{candidateStatus}（诊断分 {score}）

- 成本结构：现价 {markPrice}，较成本锚 {costAnchor} 偏离 {costDistancePct}%，第一修复位 {costLow}
- 节奏与极端度：Z={zScore}σ（双尾极端度 {tailPct}%）· AR 系数 {arCoefficient} · 半衰期 {halfLifeSessions} 会话
- 动态门禁：{phaseLabel}；{statusReason}

风险边界：基于本地日线因果算子的结构筛选（simulation-only），不构成实盘指令；入场需结合次日开盘跳空重算与失效止损线。
```

### 2. 速览摘要（`digest`）

```markdown
【观察池速览 {generatedDate}】观察 {观察数} 只 / 等待 {等待数} 只（截止 {newestDataThrough}）

1. {name}({symbol}) [{candidateStatus}] 分 {score} · 偏离 {costDistancePct}% · Z {zScore}σ · HL {halfLifeSessions}会话 · {phaseLabel}
   ...
   注：纯结构研究快照，非买卖建议。
```

## 企业微信推送（仅在用户明确指令发送时执行）

```bash
curl -fsSL -X POST "$webhookUrl" \
  -H 'Content-Type: application/json' \
  -d '{"msgtype":"markdown","markdown":{"content":"<已校验简报内容>"}}'
```

若单条超过 4096 字节，按标的分组拆分，每条保留日期与边界说明；若 `观察` 档为 0 只，如实输出“本期无标的通过右侧观察门禁（等待档 N 只）”，不得硬凑推荐。
