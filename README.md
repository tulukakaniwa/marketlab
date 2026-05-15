# 市场路径实验台 (Market Lab)

独立的纯前端交易工作台，用来处理市场路径、公式图、价格带、挂单计划和后续账户回放。

这是公开源码项目，但不是宽松许可证项目。代码按强 copyleft 许可证发布，任何分发、改作、派生集成或网络部署都必须认真遵守许可证义务。

它和 blog 分开：

- blog：思考、日志、公式解释、来源
- market-lab：数据、公式、图表、控件、回放、账户模拟

## 公开项目与许可证

- 本项目以 `AGPL-3.0-or-later` 发布，完整法律文本见 [LICENSE](./LICENSE)。
- 这是强 copyleft 许可证：如果你分发本项目、修改版本、派生作品，或把修改后的版本作为网络服务提供给用户，需要按 AGPL 要求提供对应源码。
- 欢迎学习、审阅、提交 issue 和 PR；如果你希望把本项目或派生版本用于闭源产品、闭源 SaaS、闭源内部发行或无法履行 AGPL 义务的场景，需要先取得单独书面授权。
- README 中的许可证说明只用于协作提醒；具体权利和义务以 `LICENSE` 文件为准。

## 技术栈

- `Vue 3` + `Vite` + `pnpm`
- `Pinia`（状态）
- `lightweight-charts`（K 线）
- `d3-dsv`（CSV 解析）
- `xlsx`（仅 `scripts/convert-stocks-xlsx.mjs` 离线数据预处理用，`devDependencies`）
- 部署：`AWS Amplify`（静态构建到 `dist/`）

## 命令

```bash
pnpm install
pnpm run dev               # 本地开发
pnpm run verify:domain     # domain 层数值验证
pnpm run build             # 验证 + 构建（部署用）
pnpm run preview           # 预览构建产物
```

## 目录结构

```
src/
├── App.vue                # 三栏工作台（左导航 / 中图表 / 右决策）
├── main.js                # 入口：Vue + Pinia + 4 个 CSS
├── stores/labStore.js     # 单一 Pinia store：数据 / 计算 / 加载
├── domain/                # 纯函数计算层（无 Vue 依赖）
│   ├── formulas/
│   │   ├── core.js        # GetDelta / BS / LP / IL / CE / Asian / Fusion / 二阶
│   │   └── registry.js    # 21 个公式 + 6 个能力的元数据
│   ├── market/
│   │   ├── cost.js        # 滚动 VWAP 成本带 + 市场态路径（窗口由 rows.length 自适应）
│   │   ├── ohlcv.js       # CSV 解析 + 数据集清单
│   │   └── formulaPath.js # 公式输出沿 K 线展开
│   ├── planning/orderPlan.js   # 决策图：timing → position → plan
│   └── replay/dailyReplay.js   # 日线回放引擎
├── components/            # 视图层（8 个组件）
└── styles/                # 4 个 CSS（base / chart / decision / status）

public/data/               # 165+ CSV：A 股 / 港股 / 美股 / ETF / BTC
scripts/verify-domain.mjs  # 构建前数值断言（domain 层集成测试）
```

## 决策模型

### 核心循环

```
OHLCV → 成本/波动 → Δ 价格带 → 失效与目标 → 挂单梯队 → 历史回放检验
```

### 关键变量约定

| 变量 | 含义 | 不能等同于 |
|---|---|---|
| `markPrice` / `P` | 当前观察价格 | 不是成本 |
| `entryPrice` | 用户入场价 | 不自动等于现价 |
| `costAnchor` | 滚动 VWAP 成本锚 | 不是预测价 |
| `holdingDays` / `T` | 持仓窗口（天） | 单位必须明确 |
| `iv` / `σ` | 年化波动率 | 历史波动 ≠ 市场 IV |
| `targetReturn` / `d` | 目标收益缓冲 | 必须扣手续费/资金费 |

### `GetDelta` 价格带（第一层引擎）

```
e_T = √(T / (N · 2π))         // N = tradingDaysPerYear
r_T = ((1 + σ·e_T) / (1 - σ·e_T))²
K   = entryPrice · (d·r_T - d + 1)² / r_T
```

时间基 `N` 可切：`365`（日历）/ `252`（美股）/ `242`（港股）/ `179`（质数基）。

### 三档策略 Profile

| 档位 | edgeσ | momσ | risk% | exposure% | firstWeight | cooldown |
|---|---|---|---|---|---|---|
| **保守** | 1.15 | 0.6 | 0.8% | 18% | 32% | 2.5× |
| **均衡** | 0.80 | 0 | 1.2% | 30% | 42% | 1.5× |
| **激进** | 0.55 | -0.5 | 2.0% | 45% | 50% | 1.0× |

模板会按市场 `ATR` / `annualVol` 重新缩放（`scaleProfileToMarket`），不是硬阈值。

**自动选档**：跑三档回放，按 `score = 收益 - 0.85·回撤罚 - 换手罚 - 空策略罚` 取最高。

### 三段决策（`buildEntryTiming`）

1. **折价区**（`mark < costLow`）：动量止跌且成本不再下降 → `buy`，挂单梯权重 `[0.2, 0.3, 0.5]`
2. **回归区**：等待
3. **溢价区**（`mark > costHigh`）：仅作底仓减压，**绝不做空**

### 失效条件

- 收盘越过失效线（`Δ` 带下沿 ∩ 成本下沿）
- 触及回归目标（成本锚）
- 持仓 `holdingDays` 后未触发回归

### 回放语义

- 暖机期：`clamp(rows·3%, 20, 80)`
- 风控双轨：回到成本（止盈）/ 动量止跌（cut momentum）
- 默认手续费：`0.1%`
- 回放与主决策共享 `marketStates`，不重复计算

## 原则

- `entryPrice` 不是 `markPrice`
- `holdingDays` 是原公式里的 `T`
- `GetDelta(entryPrice, T, iv, targetReturn)` 是第一层价格带引擎
- 成本和波动来自导入的市场路径
- 挂单计划必须消费公式带和成本状态
- 主工作台不放长解释（深度公式说明放 `docs/formula-understanding-audit.md`）

## 路径别名

`@` 指向 `src/`：

```js
import { useLabStore } from '@/stores/labStore.js'
```

（现有 import 仍用相对路径，新代码可逐步切换）
