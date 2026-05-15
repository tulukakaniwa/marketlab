# Market Lab 第二轮改造设计

> 状态：草案，待用户确认
> 范围：日基弱化 / 策略整理 / 图表解释 / 交互骨架
> 约定：保持 domain 计算层零回归，UI/composable 层做归并和重排

## 0. 背景

第一轮（A~F 批次）完成 Bug 修复、模块拆分、问题驱动导航、决策回放联动等。当前用户在使用中发现：

1. 年时间基（`tradingDaysPerYear`，下文称 `tdpy`）作为公式参数和入场价/IV/目标%平级，视觉过强，且默认 365 与品种属性脱节
2. 策略入口存在三套并列（右栏 4 档 profile、左栏 Q3 4 选 1 盈利来源、ChainFlow 两层管线），语义重叠，决策路径不清
3. 图表解读偏技术语言（`溢价 0.8%`、`Δ=0`、`Greeks×Δ带`、`回归 65%`），普通人难以秒懂
4. 三栏密度偏高，顶栏 / 右栏堆叠多组件，主次不分明

本次改造目标：**降低用户认知负担，把"计算口径"层与"决策"层视觉分离，把抽象指标翻译成人话**，但保持决策模型与回放数值零回归。

## 1. 总体目标

- **D（决定）**：保留 4 档 profile 为策略主轴；自动品种 → tdpy；新增人话摘要句；顶栏与右栏分区
- **N（不做）**：不动 domain 计算公式、不动回放算法、不引入 TS、不改 store 对外字段名、不删 ChainFlow（仅折叠）
- **R（风险点）**：tdpy 在多处链路有用，必须保证"自动品种 + 用户覆盖"的 effective 值贯通到 cost、formulaPath、replay、orderPlan 全链路

## 2. 模块清单（修改/新增）

```
src/
├── domain/
│   ├── market/
│   │   └── tdpy.js                  [新] 品种 → tdpy 自动判断 + 元信息
│   └── decision/
│       └── narrative.js             [新] 人话摘要拼装（区间、回归概率、决策原因）
├── composables/
│   ├── usePlanning.js               [改] 加 tdpyOverride 持久化 + effective 计算
│   └── usePersisted.js              [不动]
├── stores/
│   └── labStore.js                  [改] 加 effectiveTdpy / tdpyMeta 暴露 + 回填 watch 用 effective
├── components/
│   ├── App.vue                      [改] 顶栏精简、公式参数区去 tdpy、右栏分区
│   ├── QuestionNav.vue              [改] 删 Q3 4 选 1
│   ├── ChainFlow.vue                [改] 套 <details> 折叠
│   ├── MarketChart.vue              [改] 上方 chart-state-strip 加摘要句
│   ├── DecisionPanel.vue            [改] reason 走 narrative 模板
│   ├── ProfileTabs.vue              [新] 拆出 profile 4 档 + 副标题
│   ├── AdvancedSettings.vue         [新] tdpy 覆盖 / 复位
│   └── RightTabs.vue                [新] 决策/计划/风险/依据 路由
├── styles/
│   └── decision.css                 [改] 新增 .narrative / .advanced-card / .right-tabs
└── docs/
    └── superpowers/specs/
        └── 2026-05-14-lab-v2-design-cc.md   [本文件]
```

## 3. 模块设计

### 3.1 `domain/market/tdpy.js`（新）

**职责**：根据品种元信息推断 tdpy，提供来源标签。

**接口**：

```js
/**
 * @typedef {object} TdpyMeta
 * @property {number} value    自动推断 tdpy
 * @property {string} basis    'crypto'|'us'|'hk'|'cn'|'fallback'
 * @property {string} label    '加密 365'|'美股 252'|'港股 242'|'A 股 242'|'默认 365'
 */

export function inferTdpy(sample): TdpyMeta
```

**判定顺序**（命中即返回）：

1. `sample.market === '加密'` 或 symbol 含 `BTC`/`ETH`/`USDT`/`USDC` → 365 / `crypto`
2. `sample.market === '美股'` 或 symbol 全字母（无 `.HK` 后缀，无纯数字） → 252 / `us`
3. `sample.market === '港股'` 或 symbol 含 `.HK` → 242 / `hk`
4. `sample.market === 'A股'` 或 symbol 为纯 6 位数字 → 242 / `cn`（A 股交易日 ~244，复用 242 档无明显数值差异，避免再开新档）
5. fallback → 365 / `fallback`

**测试**（`__tests__/tdpy.test.js`，5 用例）：

- BTCUSDT → 365 crypto
- AAPL → 252 us
- 0700.HK → 242 hk
- 600519 → 242 cn
- 未知 sample → 365 fallback

### 3.2 `composables/usePlanning.js`（改）

**新增**：

```js
const tdpyOverride = persistedRef('lab.tdpyOverride.v1', {})  // { [symbol]: number }
```

`tdpyOverride` 是一个对象，按 symbol 存覆盖值。换品种时不清空（用户可能在多个品种间切换并保留各自覆盖）。

**删除**：`input.tradingDaysPerYear` 字段从 `persistedReactive` 移除（迁移：旧版本 `lab.input.v1` 里若存在该字段，由字段级合并自然忽略）。

**导出新方法**：

```js
function setTdpyOverride(symbol, value)  // value === null 表示清除
function clearTdpyOverride(symbol)
```

### 3.3 `stores/labStore.js`（改）

**新增 computed**：

```js
const tdpyMeta = computed(() => inferTdpy(data.source.value))
const effectiveTdpy = computed(() => {
  const sym = data.source.value?.symbol
  const override = sym ? planning.tdpyOverride[sym] : null
  return Number.isFinite(override) && override > 0 ? override : tdpyMeta.value.value
})
```

**effectiveInput 改造**：

```js
const effectiveInput = computed(() => ({
  ...input,
  tradingDaysPerYear: effectiveTdpy.value,
  strategyProfile: input.autoProfile && replayLayer
    ? replayLayer.recommendedProfile.value.id
    : input.strategyProfile,
}))
```

**所有下游统一吃 `effectiveInput.tradingDaysPerYear`**：
- `useMarketState` 的 `getMarketStatePath` 改读 `effectiveInput.tradingDaysPerYear`（接口改为接收 `effectiveInput` 而非 `input`）
- `useReplay` 改读 `effectiveInput`
- `buildDecisionGraph` 已经吃 effectiveInput，无变化
- `watch(rows)` 回填里的 `tdpy` 改用 `effectiveTdpy.value`

**对外暴露**：`tdpyMeta`、`effectiveTdpy`、`setTdpyOverride`、`clearTdpyOverride`。

### 3.4 `domain/decision/narrative.js`（新）

**职责**：把数值组装成人话短句，供 `MarketChart` 摘要条与 `DecisionPanel` reason 复用。

**接口**：

```js
/**
 * 区间摘要：现价相对成本带的位置
 * @returns {string} 例：'现价 95.21，比近 60 日均价低 0.8%，处于折价区间'
 */
export function summarizeRegime({ markPrice, costAnchor, costDistance, costWindow })

/**
 * 回归概率短句
 * @returns {string|null} 例：'历史上类似情况 65% 概率回归均价'
 */
export function summarizeRegression({ regressionProb, regime })

/**
 * 决策原因人话化（覆盖 graph.decision.timing.reason）
 * @returns {string} 例：'再等更便宜一点，价格离均价不到 1%'
 */
export function summarizeReason({ state, costDistance, atrPercent, side })
```

**模板表**（节选）：

| 输入条件 | 输出 |
|---|---|
| `costDistance < -0.05` | `深度折价 X%，可分批吸纳` |
| `costDistance < -0.01` | `小幅折价 X%，再等更便宜或开始买` |
| `abs(costDistance) <= 0.01` | `贴近均价，等价格给出明确折价` |
| `costDistance > 0.05` | `溢价 X%，仅减仓不进场` |
| 否则 | `回归 X%，观察方向` |

`costWindow` 写成"近 N 日均价"，N 取 `deriveWindows(rows.length).cost`。

**测试**（`__tests__/narrative.test.js`，6 用例覆盖五档区间 + 一个 null 容错）。

### 3.5 `App.vue`（改）

**顶栏**：

```vue
<header class="top-bar">
  <div class="brand"><span>Market Lab</span><h1>公式工作台</h1></div>
  <div class="bar-act">
    <input ref="searchInput" v-model="tickerSearch" class="ticker-search" />
    <datalist id="ticker-list">…全部品种</datalist>
    <button class="theme-btn" @click="toggleTheme">…</button>
    <button class="reset-btn" @click="resetWorkbench">重置</button>
  </div>
</header>
```

去掉一排 `marketSamples` 按钮，搜索框成为唯一入口。搜索框宽度从 100px 加宽到 180px。

**公式参数区** `<header class="wf-head">`：

```vue
<div class="wf-params">
  <label><span>入场价</span><input v-model.number="lab.input.entryPrice" /></label>
  <label><span>窗口(天)</span><input v-model.number="lab.input.holdingDays" /></label>
  <label><span>波动率%</span><input v-model.number="ivP" /></label>
  <label><span>目标%</span><input v-model.number="trP" /></label>
</div>
```

删除 `<select v-model="lab.input.tradingDaysPerYear">`。

**右栏**：

```vue
<aside class="wb-right">
  <ExecStrip :brief="brief" />          <!-- 不变，加大字号 -->
  <ProfileTabs />                       <!-- 接管 / 保守 / 均衡 / 激进 + 副标题 -->
  <RightTabs v-model="lab.activeMode"   <!-- 决策 / 计划 / 风险 / 依据 -->
             :graph="lab.graph"
             :market="lab.market"
             :replay="lab.replay" />
  <AdvancedSettings :tdpy-meta="lab.tdpyMeta"
                    :effective-tdpy="lab.effectiveTdpy"
                    :symbol="lab.source?.symbol"
                    @override="lab.setTdpyOverride"
                    @reset="lab.clearTdpyOverride" />
</aside>
```

`mode-tabs` / `prof-tabs` / 内联 `DecisionPanel` / `OrderTable` / risk-box 全部迁入 `RightTabs.vue`。

### 3.6 `QuestionNav.vue`（改）

删除 `q-edge`（Q3 4 选 1）。剩 3 个问题块。`qn-hint` 文案更新。

### 3.7 `ChainFlow.vue`（改）

包一层 `<details>`：

```vue
<details class="cf-toggle">
  <summary>查看计算过程（基础管线 → 公式融合）</summary>
  <div class="cf-strip">…现有内容…</div>
</details>
```

默认收起。

### 3.8 `MarketChart.vue`（改）

**props 新增**：`market: { type: Object, default: null }`（来自 `lab.market`），`App.vue` 传入。

`chart-state-strip` 第 1 个 article 改造：

```vue
<article class="state-chip narrative">
  <span>当前判断</span>
  <strong class="narr-text">{{ narrative.regimeLine }}</strong>
  <small class="narr-prob">{{ narrative.probLine }}</small>
</article>
```

`narrative` 在 `MarketChart.vue` 内部用 `computed` 调 `summarizeRegime({ markPrice, costAnchor, costDistance, costWindow })` 与 `summarizeRegression({ regressionProb, regime })` 拼装，输入取自 props 已有的 `rows[activeIndex]` / `costPath[activeIndex]` 与 `market`（需把 `market` 加入 props 传入）。不通过父组件 prop 注入文本，避免双向耦合。

### 3.9 `DecisionPanel.vue`（改）

`decision-hero` 的 `<small>` 改为：

```vue
<small>{{ summarizeReason(graph.decision, market) || graph.decision?.path }}</small>
```

### 3.10 `ProfileTabs.vue`（新）

```
┌──────────┬──────────┬──────────┬──────────┐
│ 接管     │ 保守     │ 均衡     │ 激进     │
│ 手动控制 │ 成本回归 │ 成本+波动│ 波动+资金│
└──────────┴──────────┴──────────┴──────────┘
```

副标题文案约定（与 domain/planning/orderPlan 的 profile 元数据对齐）：

| profile | 副标 |
|---|---|
| auto | 手动控制 |
| conservative | 成本回归 |
| balanced | 成本 + 波动 |
| aggressive | 波动 + 资金 |

副标静态文案，不参与决策计算。

### 3.11 `AdvancedSettings.vue`（新）

折叠卡：

```
▶ 高级 · 计算口径
  当前年时间基：252（按品种自动 · 美股）
  [365] [252] [242] [179] [自定义 ___]
  [恢复自动]
```

折叠态默认收起，用户主动打开后持久化展开态（`lab.advancedOpen.v1`）。覆盖时显示橙色 chip "已手动覆盖"。

### 3.12 `RightTabs.vue`（新）

```vue
<nav class="right-tabs">
  <button :class="{active: mode === 'decision'}" @click="mode='decision'">决策</button>
  <button :class="{active: mode === 'orders'}" @click="mode='orders'">计划</button>
  <button :class="{active: mode === 'risk'}" @click="mode='risk'">风险</button>
  <button :class="{active: mode === 'formula'}" @click="mode='formula'">依据</button>
</nav>
<DecisionPanel v-if="mode==='decision'" :graph :market />
<OrderTable v-if="mode==='orders'" :title :orders />
<div v-if="mode==='risk'" class="risk-tab">
  <div class="risk-box"><span>失效线</span>…</div>
  <div class="risk-box"><span>组合价值</span>…</div>
  <ReplayPanel :replay :profile-replays :active-profile-id />
</div>
<FormulaIODetails v-if="mode==='formula'" :formula :graph />
```

把 `lab.activeMode` 的取值集合从 `'orders'|'risk'|'formula'` 扩到 `'decision'|'orders'|'risk'|'formula'`，默认 `'decision'`。

`<ReplayPanel>` 移到风险 tab 内（与失效/组合价值同组），不再常驻。

## 4. 数据流

```
sample (data.source) ──► tdpyMeta (inferTdpy)
                                │
planning.tdpyOverride[symbol] ──┴──► effectiveTdpy
                                          │
                                          ▼
input + effectiveTdpy ────► effectiveInput ───► useMarketState ──► market/costPath/formulaPath
                                          │                          │
                                          └──► useReplay ◄───────────┘
                                          │
                                          ▼
                                   buildDecisionGraph ──► graph
                                          │
                                          ▼
                                  narrative.summarize* ──► UI
```

## 5. 兼容与迁移

- `localStorage` 旧版本 `lab.input.v1` 含 `tradingDaysPerYear` 字段：字段级合并自然忽略，无需手动清理
- `lab.tdpyOverride.v1` 是新 key，初次空对象
- `lab.activeMode.v1` 旧值 `'orders'|'risk'|'formula'` 仍合法，只是新增 `'decision'` 默认值。旧用户首次进来 mode 仍是 `'orders'`，无中断
- `App.vue` 顶栏不再渲染 `marketSamples` 按钮，但 `lab.loadSample` 仍由搜索框 enter 触发，行为不变
- store 对外 API 保持不变，**新增** `tdpyMeta` `effectiveTdpy` `setTdpyOverride` `clearTdpyOverride`，**不删字段**

## 6. 错误与边界

- `inferTdpy(null)` → fallback 365（已通过 sample = null 测试）
- 用户在 `AdvancedSettings` 输入非数字 / 负数 / 0：clamp 到合法档（最近的预设档）+ toast 提示；clamp 行为单元测试覆盖
- `summarizeRegime(null market)` → `'载入 K 线后判断'`（与现有 `regimeFor` 行为一致）
- `tdpyOverride` 持久化体积：每个 symbol 1 个数字，整体不会超过 KB 量级，无需清理策略

## 7. 测试

| 测试 | 覆盖 |
|---|---|
| `tdpy.test.js` × 5 | 品种推断五种 basis |
| `narrative.test.js` × 6 | 五档区间 + null 容错 |
| `labStore.test.js`（增 2） | 切品种 effectiveTdpy 跟随；手动覆盖优先 |
| `verify-domain.mjs` | 数值不变（关键回归守门员） |

新增和现有 vitest 全过 + verify-domain 通过 + check:data 通过 即为本批次完成标志。

## 8. 阶段交付

为方便分批 commit / review，建议拆 3 个 PR：

1. **PR-1：日基弱化**：`tdpy.js` + usePlanning + labStore 改造 + `AdvancedSettings.vue` + 公式参数区去 tdpy 下拉 + 测试
2. **PR-2：图表解释**：`narrative.js` + MarketChart 摘要条 + DecisionPanel reason + 测试
3. **PR-3：交互骨架**：QuestionNav 删 Q3 + ChainFlow 折叠 + ProfileTabs + RightTabs + ExecStrip + 顶栏精简 + 样式整理

每个 PR 独立通过 verify + test 才合并。

## 9. YAGNI 切除

明确不做：

- 多语言（人话摘要只做中文）
- 自定义模板编辑（narrative 模板硬编码到 .js）
- profile 4 档之外加自定义档
- 顶栏添加更多按钮（保持精简）
- ChainFlow 重新设计（只折叠，不重画）

## 10. 验收清单

| 操作 | 期望 |
|---|---|
| 加载 BTC | 高级设置卡显示"加密 365" |
| 切到 AAPL | 自动变 252，IV 数值变化 |
| 高级卡点 365 | tdpy 变 365，副标变"手动覆盖"，重新加载 AAPL 仍是 365 |
| 高级卡点"恢复自动" | 回到 252，覆盖记录清空 |
| 切到 0700.HK | 自动 242 |
| 顶栏数据集按钮 | 已移除 |
| 公式参数区 | 4 个 label，无 tdpy |
| 左栏 | 3 个问题块（无盈利来源 4 选 1） |
| K 线下方 ChainFlow | 默认收起，需点击 details 展开 |
| 图表 chart-state-strip 第 1 格 | 显示人话摘要 + 概率短句 |
| 决策 hero `<small>` | 显示 narrative 短句 |
| 右栏顶部 | exec-strip + ProfileTabs（4 档+副标） |
| 右栏中部 | 4 tabs（决策/计划/风险/依据），切换内容互斥 |
| 风险 tab | 失效/组合 + Replay 面板 |
| 加载 + 刷新页面 | 高级卡覆盖值保留 |
