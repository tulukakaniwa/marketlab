# Market Lab v3 · TradingView 风重写设计

> 状态：已确认，待落实施计划
> 范围：完全重写 App.vue 单页骨架；删左右侧栏；引入 3 抽屉 FAB 模式
> 约束：保留 PR-1（日基弱化 / AdvancedSettings）+ PR-2（narrative 人话摘要）成果；domain 计算层零回归

## 0. 背景

PR-1 完成日基弱化，PR-2 完成图表人话摘要。但当前三栏布局信息密度过高、左右栏堆叠多套语义重叠的导航（QuestionNav / ChainFlow / ProfileTabs / mode-tabs），用户反馈"路人都难分清看哪一刀"。本轮做**视觉骨架彻底重写**——TradingView 风：主图独大，所有支撑信息进抽屉。

## 1. 总体目标

- **D（决定）**：单页 TradingView 风；TopBar 三段决策摘要 + Profile chip；MainChart 占满；3 个 FAB 触发右侧滑入抽屉（决策/计算/设置）
- **N（不做）**：不改 domain 公式数值；不动 narrative / inferTdpy；不引入新依赖；不改 store 对外字段名（仅增删）
- **R（风险）**：抽屉浮层 z-index / 主图 resize / overlay 动态 add/remove series 在 lightweight-charts 上的接口需小心

## 2. 架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│ TopBar                                                          │
│ [Logo Lab] [Search] | [现价 $X ▲%] [narrative] [推荐 65%置信] | │
│ [Profile chip ▾] [🌗] [↻]                                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│                                                                 │
│                  MainChart (占满剩余空间)                        │
│                  K + 成本带 + 入场 + 成交量 + replay markers     │
│                  + 当前决策点                                    │
│                  Δ 子图 / 权益子图 默认隐藏，开关在设置抽屉      │
│                                                                 │
│                                                                 │
│  [入场价 ▾] [IV ▾] [窗口 ▾] [目标 ▾]   ← StatusBar chip 浮底   │
│                                                                 │
│  💡 决策                                                        │
│  📊 计算   ← FAB 浮在主图左下                                   │
│  ⚙️ 设置                                                        │
└─────────────────────────────────────────────────────────────────┘

         右侧滑入抽屉 480px（按需挂载，单例）：
         💡 DecisionDrawer  📊 ComputeDrawer  ⚙️ SettingsDrawer
```

**Drawer 单例**：`activeDrawer` 全局状态，一次只一个抽屉打开。点遮罩 / Esc / X 关闭。打开时浮在主图上层，主图不缩。

**FAB 浮层**：MainChart 内部绝对定位左下角，三圆按钮纵向堆叠 36×36，hover 文字 tooltip。

## 3. 模块清单（修改 / 新增 / 删除）

```
src/
├── components/
│   ├── App.vue                       [完全重写] 单页布局骨架
│   ├── TopBar.vue                    [新] 决策摘要条
│   ├── MainChart.vue                 [基于 MarketChart.vue 重命名+扩展]
│   ├── ChartFabs.vue                 [新] 3 圆按钮
│   ├── ChartStatusBar.vue            [新] 4 chip + popover
│   ├── ParamPopover.vue              [新] 单字段 popover
│   ├── DrawerHost.vue                [新] 抽屉路由
│   ├── DecisionDrawer.vue            [新] 5 分区
│   ├── ComputeDrawer.vue             [新] 5 分区
│   ├── SettingsDrawer.vue            [新] 5 分区
│   ├── ProfileSwitcher.vue           [新] 4 档 + 各档回测概览
│   ├── ProfileChip.vue               [新] TopBar 用的彩色 chip 下拉
│   ├── SimulationInputs.vue          [新] 完整 input 表单
│   ├── ChartOverlayToggles.vue       [新] 8 开关
│   ├── DecisionPanel.vue             [改] 拆出 reason / 动作卡片段
│   ├── ChainFlow.vue                 [改] 去 <details> 折叠
│   ├── QuestionNav.vue               [改] 删 emit 'focus-search'
│   ├── FormulaDrawer.vue             [改] 改成 fragment（去自身 wrapper）
│   ├── AdvancedSettings.vue          [改] 改成 fragment（去自身 <details>）
│   ├── ReplayPanel.vue               [不动]
│   ├── OrderTable.vue                [不动]
│   ├── FormulaNav.vue                [不动]
│   ├── FormulaChart.vue              [不动 · 进 ComputeDrawer]
│   └── MetricStrip.vue               [不动]
├── composables/
│   ├── usePlanning.js                [改] 删 activeMode + activeCapabilityId
│   └── useChartOverlays.js           [新] chartOverlays + 持久化
├── stores/
│   └── labStore.js                   [改] 加 activeDrawer + chartOverlays，
│                                          删 activeMode 引用
└── styles/
    ├── decision.css                  [改] 删 mode-tabs / prof-tabs / wb-* / qn-* 等旧样式
    └── chart.css                     [不动]
```

**已删除（移到回收站）**：无（MarketChart.vue 重命名为 MainChart.vue）

## 4. 模块设计

### 4.1 TopBar.vue（新）

**Props**：
- `marketSummary: { markPrice, costAnchor, costDistance, dailyChange, narrative }`
- `decision: { state, side, confidence }`
- `profileId: string` / `autoProfile: boolean`
- `searchValue: string` (v-model)
- `samples: Array`

**Emit**：
- `update:searchValue`
- `select-sample(sample)`
- `set-profile(id)` / `set-auto-profile(boolean)`
- `toggle-theme`
- `reset`

**布局**：
```
[brand 60px] [search 200px] | [现价段] [narrative 段] [推荐段] | [profile chip] [theme 28px] [reset 56px]
```

中间三段用 `|` 分隔（CSS pseudo-element），narrative 段最大宽 320px 超出则 ellipsis + title。

**响应式**：
- < 1100px：移除"推荐段"
- < 800px：只保留现价 + profile chip

### 4.2 MainChart.vue（基于 MarketChart.vue 改）

**Props**：
- `rows / costPath / formulaPath / market / replay`
- `entryPrice` (保留)
- `overlays: { costBand, entryLine, volBand, volume, replayMarkers, currentDecision, deltaPane, equityPane }`
- `decision: { side, state }` (用于"当前决策点" marker)

**Emit**：
- `cursor-change(idx)`
- `param-change(field, value)` (从 StatusBar popover 触发)
- `open-drawer(name)` (从 FAB 触发)

**结构**：
```vue
<div class="main-chart-shell">
  <div ref="el" class="chart-canvas" />  <!-- lightweight-charts 容器 -->
  <ChartStatusBar :input :market @change="paramChange" />
  <ChartFabs :active-drawer @open="openDrawer" />
</div>
```

**Series 动态管理**：
- `applyOverlays(overlays)` 函数：根据 overlays 状态 add / remove 各 series
- pane stretchFactor 根据可见 pane 动态分配（Δ 关时主图 + 量为 0.85 / 0.15；Δ 开时 0.62 / 0.08 / 0.30；权益开时再加 pane 3）

**当前决策点 marker**：
- 数据：`decision.side` + `rows.at(-1)`
- 形状：buy=arrowUp/绿；sell=arrowDown/红；wait=circle/灰
- 位置：最后一根 K 上 / 下
- 文案：`decision.state`

### 4.3 ChartStatusBar.vue（新）

**Props**：
- `input: { entryPrice, holdingDays, iv, targetReturn }`
- `market: object` (用于 IV 默认值参考)

**Emit**：
- `change(field, value)` — 仅 4 字段中之一

**结构**：
```vue
<div class="status-bar">
  <ChipButton label="入场价" :value="input.entryPrice" format="money" @click="open('entryPrice')" />
  <ChipButton label="IV" :value="input.iv" format="pct" @click="open('iv')" />
  <ChipButton label="窗口" :value="input.holdingDays" format="days" @click="open('holdingDays')" />
  <ChipButton label="目标" :value="input.targetReturn" format="pct" @click="open('targetReturn')" />
  <ParamPopover v-if="openField" :anchor="anchor" :field="openField" :value="..." @confirm="emit-change" @cancel="close" />
</div>
```

**ChipButton 样式**：
- 圆角 chip，bg `var(--surface-alt)`，hover 描边 var(--green)
- 字号 0.74rem
- 含 ▾ 小箭头

### 4.4 ParamPopover.vue（新）

**职责**：通用单字段编辑 popover。

**Props**：
- `anchor: HTMLElement`（chip 元素，用于定位）
- `field: 'entryPrice'|'iv'|'holdingDays'|'targetReturn'`
- `value: number`

**Emit**：
- `confirm(value)` — Enter 或点击"应用"
- `cancel()` — Esc 或点击外侧

**结构**：浮层定位在 anchor 上方居中，220px 宽，含：
- 标题（field 中文名）
- 数字 input（带 step / min）
- [应用] [取消] 两按钮
- Enter 触发 confirm

**校验**：
- entryPrice > 0
- iv: 0~5（百分号显示，内部 0~5 表 0%~500%）
- holdingDays: 1~365 整数
- targetReturn: 0~5

非法值：input 标橙 + tooltip 错，按钮 disabled。

### 4.5 ChartFabs.vue（新）

**Props**：
- `activeDrawer: string|null`

**Emit**：
- `open(name)` — name 为 'decision'|'compute'|'settings'

**结构**：
```vue
<div class="chart-fabs">
  <button :class="{ active: activeDrawer === 'decision' }" @click="$emit('open', 'decision')" title="决策">💡</button>
  <button :class="{ active: activeDrawer === 'compute' }" @click="$emit('open', 'compute')">📊</button>
  <button :class="{ active: activeDrawer === 'settings' }" @click="$emit('open', 'settings')">⚙️</button>
</div>
```

**样式**：
- 36×36 圆 button
- bg var(--panel)，shadow，hover 放大 1.05
- active 时 bg var(--green) text white
- 纵向 gap 8px
- 绝对定位 left:12px bottom:12px z-index:20

### 4.6 DrawerHost.vue（新）

**职责**：根据 activeDrawer 动态挂载对应抽屉。

**Props**：
- `activeDrawer: string|null`
- `lab` reference

**Emit**：
- `close`

**结构**：
```vue
<Teleport to="body">
  <transition name="drawer-slide">
    <div v-if="activeDrawer" class="drawer-overlay" @click.self="$emit('close')">
      <aside class="drawer-panel" :data-name="activeDrawer">
        <header>
          <h2>{{ titles[activeDrawer] }}</h2>
          <button class="drawer-close" @click="$emit('close')">×</button>
        </header>
        <DecisionDrawer v-if="activeDrawer === 'decision'" v-bind="lab" />
        <ComputeDrawer v-else-if="activeDrawer === 'compute'" v-bind="lab" />
        <SettingsDrawer v-else-if="activeDrawer === 'settings'" v-bind="lab" />
      </aside>
    </div>
  </transition>
</Teleport>
<Esc handler 全局监听 -> emit close>
```

**样式**：
- overlay：fixed inset:0，bg rgba(0,0,0,0.18)，z-index:30
- panel：right:0，top:0，bottom:0，width:480px max-w:90vw
- 滑入动画 transform: translateX(0/100%) duration 220ms

### 4.7 DecisionDrawer.vue（新）

**5 分区**：

```vue
<section class="dr-section dr-reason">
  <p class="dr-reason-text">{{ summarizeReason(...) }}</p>
</section>

<section class="dr-section dr-action">
  <h3>推荐动作</h3>
  <article class="action-card">
    <strong>{{ graph.decision.state }}</strong>
    <em>{{ confidence }}% 置信</em>
    <div class="action-grid">
      首笔 / 挂单 / 失效 / 目标 / 第一笔 / 风险预算 6 格
    </div>
  </article>
</section>

<section class="dr-section dr-orders">
  <h3>计划单</h3>
  <OrderTable :title :orders />
</section>

<section class="dr-section dr-risk">
  <h3>风险</h3>
  <div class="risk-row"><span>失效线</span><strong>{{ low }} / {{ high }}</strong></div>
  <div class="risk-row"><span>组合价值</span><strong>{{ portfolio }}</strong></div>
</section>

<section class="dr-section dr-profile">
  <h3>Profile 调优</h3>
  <ProfileSwitcher :profile-replays :active-id :auto @set="..." />
</section>

<section class="dr-section dr-replay">
  <h3>回放历史</h3>
  <ReplayPanel :replay :profile-replays :active-profile-id />
</section>
```

### 4.8 ComputeDrawer.vue（新）

**5 分区**：

```vue
<section><MetricStrip :items="metrics" /></section>
<section><QuestionNav :active-formula-id :input @select-formula="$emit('select-formula', $event)" /></section>
<section><ChainFlow :graph :market :active-id @select="$emit('select-formula', $event)" /></section>
<section class="formula-detail">
  <h3>当前公式：{{ activeFormula.label }}</h3>
  <FormulaChart :formula-id :graph :market :rows :cost-path />
  <FormulaDrawerContent :formula-id :graph :market /> <!-- 现 FormulaDrawer 内容 fragment -->
</section>
<section><FormulaNav :active-id @select="..." /></section>
```

**emit 'select-formula'** 透传到 store.activeFormulaId。

### 4.9 SettingsDrawer.vue（新）

**5 分区**：

```vue
<section><SimulationInputs :input @update="..." /></section>
<section><AdvancedSettingsContent :tdpy-meta :effective-tdpy :symbol @override @reset /></section>
<section><ChartOverlayToggles :overlays @update="..." /></section>
<section class="theme">
  <button @click="setTheme('light')">浅色</button>
  <button @click="setTheme('dark')">深色</button>
</section>
<section class="reset">
  <button @click="confirmReset">清空所有持久化参数 + 刷新</button>
</section>
```

### 4.10 ProfileChip.vue（新）

TopBar 上的彩色 profile chip + 下拉。

**Props**：
- `profileId: string` / `autoProfile: boolean`
- `profileList: Array`

**Emit**：
- `set(id)` / `set-auto(boolean)`

**结构**：
```vue
<div class="profile-chip" :class="profileTone">
  <button @click="open = !open">
    <span class="dot" />
    {{ autoProfile ? `自动 · ${activeLabel}` : activeLabel }}
    <span>▾</span>
  </button>
  <ul v-if="open" class="profile-menu">
    <li @click="setAuto(true)">自动</li>
    <li v-for="p in profileList" @click="set(p.id)">{{ p.label }}</li>
  </ul>
</div>
```

**配色**：conservative=blue / balanced=green / aggressive=orange / auto=neutral。

### 4.11 ProfileSwitcher.vue（新）

DecisionDrawer 内用，4 档按钮 + 各档 returnOnUsedNotional / maxDrawdown 一行小字。

### 4.12 SimulationInputs.vue（新）

完整 input 表单：
- 入场价 / 窗口 / IV / 目标% / 本金 / 风险费率 / 行权价 / 期权类型（put/call）
- 每个 label + input + 数值范围说明
- v-model 绑定到 lab.input

### 4.13 ChartOverlayToggles.vue（新）

8 个开关，每个：
```vue
<label><input type="checkbox" v-model="overlays.costBand" /> 成本锚带</label>
```

### 4.14 改造既有组件

**DecisionPanel.vue**：拆出"reason 大字 + 推荐动作卡片"为可在抽屉中独立用的 sub-component（或保留整体在 DecisionDrawer 中嵌入）

**FormulaDrawer.vue**：原文件本身是一个全屏抽屉。新设计里它的内容要在 ComputeDrawer 中作为 fragment 用。
处理方案：把内容（公式 metadata、当前实时值、上下游依赖）提取到 `FormulaDrawerContent.vue`，旧 `FormulaDrawer.vue` 删除（或暂保留）。

**AdvancedSettings.vue**：原本是 `<details>` 折叠卡，现在在 SettingsDrawer 内已是分区，无需自身折叠。
处理方案：把内部 `<div class="adv-body">` 提取到 `AdvancedSettingsContent.vue`，旧的删除。

**ChainFlow.vue**：去掉外层 `<details>`，直接渲染 cf-strip。

**QuestionNav.vue**：删 emit 'focus-search'（计算抽屉里没法 focus 搜索框）；Q1 改文案为"看什么品种 → 顶栏搜索"，不再 emit。

## 5. 数据流

```
┌────── lab store ──────┐
│ rows / market / graph │
│ replay / profileReplays
│ input / effectiveTdpy │
│ activeDrawer ────┐    │
│ chartOverlays ───┼─┐  │
│ activeFormulaId ─┼─┼─┐│
└──────────────────┴─┴─┴┘
       │           │ │ │
       ▼           ▼ ▼ ▼
   ┌── App.vue ───────────┐
   │ <TopBar />           │
   │ <MainChart           │
   │   :overlays=..       │
   │   :decision=..       │
   │   @open-drawer=.     │
   │   @param-change=. /> │
   │ <DrawerHost          │
   │   :active=activeDrawer│
   │   @close=closeDrawer />│
   └──────────────────────┘
```

## 6. 兼容与迁移

- **LocalStorage**：
  - 删 `lab.activeMode.v1`、`lab.activeCapabilityId.v1`（新设计无对应字段）
  - 新 `lab.activeDrawer.v1`（默认 null）、`lab.chartOverlays.v1`（默认见 §4.13）
  - 保留 `lab.input.v1` / `lab.tdpyOverride.v1` / `lab.theme.v1` / `lab.activeFormulaId.v1` / `lab.advancedOpen.v1`
  - lab.advancedOpen.v1 在新设计中无效，但留着不清，用户旧 storage 不报错
- **store API**：
  - 删 `activeMode` / `activeCapabilityId` / `activeCapability` / `activeCapabilityStages` / `selectCapability`
  - 新增 `activeDrawer` / `openDrawer` / `closeDrawer` / `chartOverlays`
  - 保留所有现有字段
- **测试**：现有 7 套测试中 labStore.test.js 第 4 个用例 `selectCapability` 要删；新增 chartOverlays + drawer 测试

## 7. 错误与边界

- 未加载数据：MainChart 显示 empty-state（保留现实现），FAB 仍可见但点击不响应（disabled）
- graph.decision = null：DecisionDrawer 各分区独立兜底
- ParamPopover 输入非法：chip 标橙，confirm 不 emit
- 抽屉打开期间数据更新：抽屉内组件用 watch / computed 自动响应
- ESC 全局监听：仅在 activeDrawer 不为 null 时拦截

## 8. 测试

| 测试 | 内容 | 数量 |
|---|---|---|
| `tdpy.test.js` | 不变 | 6 |
| `narrative.test.js` | 不变 | 11 |
| `cost.test.js` | 不变 | 9 |
| `formulas.test.js` | 不变 | 9 |
| `replay.test.js` | 不变 | 4 |
| `planning.test.js` | 不变 | 5 |
| `labStore.test.js` | 删 selectCapability 用例；增 activeDrawer 持久化 + chartOverlays 默认值合并 | 7 - 1 + 2 = 8 |
| `useChartOverlays.test.js` | 默认值 / 字段合并 / 持久化 | 3 |
| `ParamPopover.test.js` | 输入合法 emit confirm；非法不 emit；Esc emit cancel | 4 |

总计：6 + 11 + 9 + 9 + 4 + 5 + 8 + 3 + 4 = **59 用例**（现 54 + 5 净增）

新增 + 现有全过 + verify:domain 通过 + check:data 通过 = 完工标志。

## 9. 阶段交付（PR 划分）

| PR | 内容 | 估算复杂度 |
|---|---|---|
| **PR-A** | store / composable 改造（chartOverlays + activeDrawer） + 测试 | 低 |
| **PR-B** | DrawerHost + 3 抽屉壳 + ParamPopover + ChartFabs / StatusBar + 现有组件 fragment 化 | 中 |
| **PR-C** | App.vue 重写 + TopBar + MainChart 改 + ProfileChip + 删旧样式 | 中 |
| **PR-D** | SimulationInputs / ChartOverlayToggles / ProfileSwitcher / 抽屉接线 + 验收清单 | 中 |

每个 PR 独立通过 verify + test 才合并。

## 10. YAGNI 切除

明确不做：
- 抽屉内分区折叠（每个抽屉都是垂直滚动，分区扁平）
- 多抽屉同时打开
- 抽屉拖动调宽
- TopBar 下方再加 sub-toolbar
- 主图叠加项的预设组合（"路人模式"/"分析师模式"）
- 自定义 FAB 顺序

## 11. 验收清单

| 操作 | 期望 |
|---|---|
| 加载 BTC | TopBar 现价、narrative、推荐动作、profile chip 都正常显示 |
| 切到 AAPL | TopBar 整段更新，profile chip 颜色按推荐档变 |
| 主图区 | K + 成本带 + 入场 + 成交量 + replay markers + 当前决策点 7 项可见 |
| Δ / 权益子图 | 默认隐藏，主图区只 2 pane |
| 点 ⚙️ FAB | 设置抽屉滑入；勾"Δ 子图" → 主图加 pane 2 |
| 关 Δ 开关 | pane 2 消失 |
| 点 💡 FAB | 决策抽屉滑入，5 分区可见 |
| 点 📊 FAB | 计算抽屉滑入，5 分区可见 |
| ESC | 当前抽屉关闭 |
| 状态栏 [入场价 ▾] | 弹小 popover；改 95 → 99 + Enter，主图入场价线移到 99 |
| 改 ProfileChip "均衡 → 激进" | 决策摘要更新 |
| 切深色主题 + 刷新 | 主题保留 |
| 清空持久化 | 重置后所有 UI 状态归零 |
| 移动端 < 800px | TopBar 仅现价 + chip；FAB 移到右下 |

## 12. 兼容旧测试

- `labStore.test.js` 现有 5 用例：
  - "对外 API 字段齐全"：删 `activeMode` 断言；新增 `activeDrawer` `chartOverlays` 断言
  - "初始 input 默认值正确"：保留
  - "importText 解析 CSV 并触发输入回填"：保留
  - "selectCapability 切换 active 公式"：**删**（API 不再存在）
  - "A3 回归：tdpy 切换不污染缓存"：保留
  - "effectiveTdpy 默认按 source 自动判断"：保留
  - "用户覆盖优先于自动判断，且 per-symbol 隔离"：保留
- 其他套件零改动

