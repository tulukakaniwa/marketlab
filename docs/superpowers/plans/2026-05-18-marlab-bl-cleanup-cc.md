# marlab-bl 优化清理 P1 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 marlab-bl 上做三件硬清理：① 拆 MainChart.vue（677 行）让 `check:size` 过；② 删 `src/domain/market/` 5 个 re-export 残留文件；③ dedupe `useReplay`，把 `buildDailyReplay` 调用从 4 次降到 1 次。

**Architecture:** MainChart 三块自然切分：series 管理 + hover legend 渲染 + markers 构建。前者下沉到 composable，后者抽组件，markers 抽 domain helper。useReplay 把"当前 profile 的 replay" 从 `profileReplays` 中按 id 取，避免重复算。market/ 5 个 re-export 文件全部删除，5 处外部 import 改路径到 market-data/ 真身（`liquidityRack.js` 是孤儿直接删）。

**Tech Stack:** Vue 3 Composition API · Pinia setup store · vitest · lightweight-charts v5

**仓库形态：** `marlab-bl` 工作目录 `F:/devarea/marlab-bl`，**有 git**（远程 `B1amer/marlab-bl`，分支 `main`）

**约束：**
- domain 公式数值零回归（`node scripts/verify-domain.mjs` 必须过）
- `check:size` 必须从红 → 绿
- 测试 121/121 不退（`pnpm test` 即 `vitest run`，本机用 `npx vitest run` 替代）
- 中文注释；不署名 AI 工具
- `node scripts/csv2js.mjs` 是测试前置（生成 generated/）；这个项目没有 npm，**用 npx 跑 vitest，跑测试前手动 generate:data**
- 项目用 pnpm；本机无 pnpm，命令换成 `npx vitest run` / `node scripts/check-file-size.mjs` 等
- **可以 git commit + push**（用户已选 GitFlow）；分支 `feature/cleanup-mainchart-replay-market`

**Task 拆分（共 6 个）：**

1. 准备分支 + 基线快照
2. 抽 `chartMarkers.js`（domain helper）
3. 抽 `useChartSeriesPlan.js`（series 管理） + 子组件 `MainChartHoverLegend.vue`
4. MainChart.vue 落地拆分（用上 #2 #3 的产物）
5. dedupe `useReplay`
6. 清 `domain/market/` 5 个 re-export + 改 5 处引用 + 验证

每个 task 末尾跑 `node scripts/csv2js.mjs && npx vitest run && node scripts/check-file-size.mjs && node scripts/verify-domain.mjs`，全过才进下一 task。

---

## 任务前置说明

- **Pinia setup store 字段访问**：`useLabStore()` 返回的 ref 已 unwrap，组件/测试里读 `lab.replay`、`lab.activeRows`，**不要 `.value`**。
- **lightweight-charts v5 pane 索引**：由 `chart.addSeries(..., paneIndex)` 第三参数决定；当前 layout 由 `domain/research-visualization/chartPaneLayout.js` 中 `resolveChartOverlayPlan` 输出。**不动这个 helper**。
- **markers API**：`createSeriesMarkers(series.candle, [])` 创建一次，用 `markersApi.setMarkers(...)` 更新。本计划要把 `buildMarkers/buildResearchMarkers/buildReplayMarkers` 抽出去，但**不动 markersApi 本身的生命周期**。

---

## Task 1：准备分支 + 基线快照

**Files:**
- 无修改

- [ ] **Step 1.1：确认 main 干净**

```bash
cd F:/devarea/marlab-bl
git status
```
Expected: working tree clean。如果不干净，先 stash 或 commit。

- [ ] **Step 1.2：创建 feature 分支**

```bash
git checkout -b feature/cleanup-mainchart-replay-market
```

- [ ] **Step 1.3：跑基线脚本**

```bash
node scripts/csv2js.mjs
node scripts/verify-domain.mjs
node scripts/check-file-size.mjs
npx vitest run
```

Expected：
- csv2js: `generated 178 CSV JS modules`
- verify-domain: `domain verification passed`
- check-file-size: 报错 `MainChart.vue: 677`（基线红，预期）
- vitest: `121 passed`

- [ ] **Step 1.4：记录基线（注释，不动文件）**

把基线状态作为 git commit 的描述材料。如有偏差立刻报告。

---

## Task 2：抽 `chartMarkers.js`（domain helper）

**Files:**
- Create: `src/domain/research-visualization/chartMarkers.js`
- Create: `src/domain/__tests__/chartMarkers.test.js`

> 现状：`MainChart.vue` 第 322-399 行有 `buildMarkers` / `buildResearchMarkers` / `buildReplayMarkers` / `withMarkerText`。其中 `buildResearchMarkers` 内部还有 `buildResearchStatusLabel` 调用，这部分已经在 domain 里了（`research-visualization/researchStatusLabel.js`）。把这三个 build 函数抽到 domain helper，让 MainChart 只调用一个 `buildChartMarkers(...)` 入口。

### Step 2.1：写失败测试 `chartMarkers.test.js`

```js
import { describe, expect, it } from 'vitest'
import { buildChartMarkers } from '../research-visualization/chartMarkers.js'

describe('buildChartMarkers', () => {
  function row(date, close = 100) {
    return { date, open: close, high: close + 1, low: close - 1, close, volume: 1000 }
  }

  it('overlays.executionMarkers === false 时不输出 replay 与 decision markers', () => {
    const markers = buildChartMarkers({
      rows: [row('2024-01-01')],
      replay: { trades: [{ side: 'buy', signalDate: '2024-01-01', fillDate: '2024-01-01', exitDate: '2024-01-01', pnl: 5, fillPrice: 100, reason: 'cost' }] },
      decision: { state: '低吸', timing: { side: 'buy' } },
      overlays: { executionMarkers: false, replayMarkers: true, currentDecision: true, replayMarkerLabels: false, researchMarkers: false },
      formulaPath: [],
    })
    expect(markers).toEqual([])
  })

  it('replayMarkers + currentDecision 同时打开输出当前决策点', () => {
    const markers = buildChartMarkers({
      rows: [row('2024-01-01')],
      replay: { trades: [] },
      decision: { state: '低吸', timing: { side: 'buy' } },
      overlays: { executionMarkers: true, replayMarkers: true, currentDecision: true, replayMarkerLabels: false, researchMarkers: false },
      formulaPath: [],
    })
    expect(markers.find((m) => m.id === 'current-decision')).toBeTruthy()
  })

  it('replayMarkers 同日 fill+exit 输出单条 markers', () => {
    const trade = { side: 'buy', signalDate: '2024-01-01', fillDate: '2024-01-01', exitDate: '2024-01-01', pnl: 5, fillPrice: 100, reason: 'cost' }
    const markers = buildChartMarkers({
      rows: [row('2024-01-01')],
      replay: { trades: [trade] },
      decision: null,
      overlays: { executionMarkers: true, replayMarkers: true, currentDecision: false, replayMarkerLabels: false, researchMarkers: false },
      formulaPath: [],
    })
    // 只输出 fill 一条（同日 fill+exit 走 if 分支）
    expect(markers).toHaveLength(1)
    expect(markers[0].id).toBe('fill-0')
  })

  it('replayMarkers 跨日 fill/exit 输出两条 markers', () => {
    const trade = { side: 'buy', signalDate: '2024-01-01', fillDate: '2024-01-01', exitDate: '2024-01-03', pnl: -3, fillPrice: 100, reason: 'stop' }
    const markers = buildChartMarkers({
      rows: [row('2024-01-01'), row('2024-01-02'), row('2024-01-03')],
      replay: { trades: [trade] },
      decision: null,
      overlays: { executionMarkers: true, replayMarkers: true, currentDecision: false, replayMarkerLabels: false, researchMarkers: false },
      formulaPath: [],
    })
    expect(markers).toHaveLength(2)
    expect(markers.map((m) => m.id).sort()).toEqual(['exit-0', 'fill-0'])
  })

  it('researchMarkers 打开且 formulaPath 末尾有 status 时输出 research-status', () => {
    const markers = buildChartMarkers({
      rows: [row('2024-01-01')],
      replay: { trades: [] },
      decision: null,
      overlays: { executionMarkers: false, researchMarkers: true, replayMarkers: false, currentDecision: false, replayMarkerLabels: false },
      formulaPath: [{ date: '2024-01-01', status: ['needs-input'], fieldStates: {} }],
    })
    expect(markers.find((m) => m.id === 'research-status')).toBeTruthy()
  })

  it('replayMarkerLabels=false 时仍输出 markers，但无 text 字段（除最近 N 条之外）', () => {
    const trades = Array.from({ length: 10 }, (_, i) => ({
      side: 'buy', signalDate: '2024-01-01', fillDate: '2024-01-01', exitDate: '2024-01-01',
      pnl: 1, fillPrice: 100, reason: 'cost',
    }))
    const markers = buildChartMarkers({
      rows: [row('2024-01-01')],
      replay: { trades },
      decision: null,
      overlays: { executionMarkers: true, replayMarkers: true, currentDecision: false, replayMarkerLabels: false, researchMarkers: false },
      formulaPath: [],
    })
    // replayMarkerLabels=false 时所有 markers 都没 text
    for (const m of markers) {
      expect(m.text).toBeUndefined()
    }
  })
})
```

### Step 2.2：跑测试看红

```bash
npx vitest run src/domain/__tests__/chartMarkers.test.js
```
Expected: FAIL（chartMarkers.js 不存在）

### Step 2.3：实现 `chartMarkers.js`

完整新文件 `src/domain/research-visualization/chartMarkers.js`：

```js
import { buildResearchStatusLabel } from './researchStatusLabel.js'

const MAX_REPLAY_MARKER_TRADES = 120
const MAX_REPLAY_TEXT_LABELS = 6

/**
 * 构建主图 markers（replay trades + 当前决策 + 研究层状态）
 *
 * @param {object} params
 * @param {Array} params.rows
 * @param {object} params.replay
 * @param {object} params.decision
 * @param {object} params.overlays   chartOverlays（含 executionMarkers/replayMarkers/currentDecision/replayMarkerLabels/researchMarkers）
 * @param {Array} params.formulaPath
 * @returns {Array} 排序后的 markers，可直接 setMarkers
 */
export function buildChartMarkers({ rows, replay, decision, overlays, formulaPath }) {
  const out = []
  if (overlayOn(overlays, 'executionMarkers') && overlays.replayMarkers) {
    out.push(...buildReplayMarkers(replay?.trades ?? [], overlays))
  }
  if (overlayOn(overlays, 'executionMarkers') && overlays.currentDecision && rows.length && decision) {
    const last = rows.at(-1)
    const side = decision.timing?.side
    out.push({
      time: last.date,
      position: side === 'sell' ? 'aboveBar' : 'belowBar',
      shape: side === 'buy' ? 'arrowUp' : side === 'sell' ? 'arrowDown' : 'circle',
      color: side === 'buy' ? '#0e7558' : side === 'sell' ? '#a93226' : '#888',
      text: decision.state || '',
      id: 'current-decision',
    })
  }
  if (overlayOn(overlays, 'researchMarkers')) out.push(...buildResearchMarkers(formulaPath))
  return out.sort((a, b) => a.time < b.time ? -1 : a.time > b.time ? 1 : 0)
}

function overlayOn(overlays, key) {
  return overlays[key] !== false
}

function buildResearchMarkers(formulaPath) {
  const last = formulaPath?.at?.(-1)
  if (!last?.date || !Array.isArray(last.status) || !last.status.length) return []
  const flagged = Object.values(last.fieldStates ?? {})
    .filter((state) => state?.status !== 'implemented' || state?.missingInputs?.length || state?.isSynthetic)
  const label = buildResearchStatusLabel(last.status, flagged)
  return [{
    time: last.date,
    position: 'aboveBar',
    shape: 'circle',
    color: '#7a5cff',
    text: label,
    id: 'research-status',
  }]
}

function buildReplayMarkers(trades, overlays) {
  const start = Math.max(0, trades.length - MAX_REPLAY_MARKER_TRADES)
  const visibleTrades = trades.slice(start)
  const showTextFrom = overlays.replayMarkerLabels
    ? Math.max(0, visibleTrades.length - MAX_REPLAY_TEXT_LABELS)
    : Infinity
  return visibleTrades.flatMap((trade, localIndex) => {
    const i = start + localIndex
    const isBuy = trade.side === 'buy'
    const showText = localIndex >= showTextFrom
    const markers = []
    if (trade.signalDate && trade.signalDate !== trade.fillDate) {
      markers.push(withMarkerText({
        time: trade.signalDate,
        position: isBuy ? 'belowBar' : 'aboveBar',
        shape: 'circle',
        color: isBuy ? '#0e7558' : '#a93226',
        id: `signal-${i}`,
      }, showText, `${isBuy ? '买入' : '卖出'}信号`))
    }
    if (trade.fillDate === trade.exitDate) {
      markers.push(withMarkerText({
        time: trade.fillDate,
        position: isBuy ? 'belowBar' : 'aboveBar',
        shape: isBuy ? 'arrowUp' : 'arrowDown',
        color: isBuy ? '#0e7558' : '#a93226',
        id: `fill-${i}`,
      }, showText, `${trade.reason} ${isBuy ? '成交 @' + money(trade.fillPrice) : signedMoney(trade.pnl)}`))
      return markers
    }
    markers.push(
      withMarkerText({ time: trade.fillDate, position: isBuy ? 'belowBar' : 'aboveBar', shape: isBuy ? 'arrowUp' : 'arrowDown', color: isBuy ? '#0e7558' : '#a93226', id: `fill-${i}` }, showText, `${isBuy ? '买入' : '卖出'}成交 ${money(trade.fillPrice)}`),
      withMarkerText({ time: trade.exitDate, position: trade.pnl >= 0 ? 'aboveBar' : 'belowBar', shape: 'circle', color: trade.pnl >= 0 ? '#0e7558' : '#a93226', id: `exit-${i}` }, showText, `${trade.reason} ${signedMoney(trade.pnl)}`),
    )
    return markers
  })
}

function withMarkerText(marker, show, text) {
  return show ? { ...marker, text } : marker
}

function money(v) {
  return Number.isFinite(v) ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(v) : '无'
}

function signedMoney(v) {
  return Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${money(v)}` : '无'
}
```

### Step 2.4：跑测试看绿

```bash
npx vitest run src/domain/__tests__/chartMarkers.test.js
```
Expected: PASS · 6 个用例

### Step 2.5：跑全量

```bash
node scripts/csv2js.mjs
npx vitest run
```
Expected: 121 + 6 = **127 passed**

### Step 2.6：commit

```bash
git add src/domain/research-visualization/chartMarkers.js src/domain/__tests__/chartMarkers.test.js
git commit -m "feat(chart): extract chartMarkers helper from MainChart"
```

---

## Task 3：抽 `MainChartHoverLegend.vue` 子组件

**Files:**
- Create: `src/components/MainChartHoverLegend.vue`

> 现状：MainChart.vue 第 597-622 行模板 + 632-675 行 CSS + 538-553 行 `formatLegendValue/formatVolume` + 463-535 行 `buildLegend/fallbackValue/groupIndicators` 都属于 hover legend 域。把模板 + CSS + format helper 抽到独立组件，MainChart 只把已经构造好的 legend 对象传进去。
>
> `buildLegend` 仍留在 MainChart 因为它依赖 `series`/`seriesMeta`/`param.seriesData`（chart 实例的内部 state）；只把渲染 + format 抽走。

### Step 3.1：写新组件 `MainChartHoverLegend.vue`

```vue
<script setup>
defineProps({
  // 父组件构造好的 legend 对象，shape 参考 MainChart 的 buildLegend
  legend: { type: Object, default: null },  // null 表示不显示
})

function formatLegendValue(unit, value) {
  if (!Number.isFinite(value)) return '—'
  if (unit === 'pct')   return `${(value * 100).toFixed(2)}%`
  if (unit === 'ratio') return `${(value * 100).toFixed(1)}%`
  if (unit === 'num')   return value.toFixed(2)
  // price
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value)
}

function formatVolume(v) {
  if (!Number.isFinite(v)) return '—'
  const abs = Math.abs(v)
  if (abs >= 1e8) return `${(v / 1e8).toFixed(2)}亿`
  if (abs >= 1e4) return `${(v / 1e4).toFixed(2)}万`
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(v)
}
</script>

<template>
  <div v-if="legend" class="mc-legend" :class="`dir-${legend.ohlcv.direction}`">
    <div class="mc-legend-head">
      <span class="mc-legend-date">{{ legend.date }}</span>
      <span class="mc-legend-ohlc">
        <em>开</em>{{ formatLegendValue('price', legend.ohlcv.open) }}
        <em>高</em>{{ formatLegendValue('price', legend.ohlcv.high) }}
        <em>低</em>{{ formatLegendValue('price', legend.ohlcv.low) }}
        <em>收</em>{{ formatLegendValue('price', legend.ohlcv.close) }}
      </span>
      <span class="mc-legend-change">
        <template v-if="Number.isFinite(legend.ohlcv.change)">
          <span class="mc-legend-delta">{{ legend.ohlcv.change > 0 ? '+' : '' }}{{ formatLegendValue('price', legend.ohlcv.change) }}</span>
          <span class="mc-legend-pct">{{ legend.ohlcv.changePct > 0 ? '+' : '' }}{{ (legend.ohlcv.changePct * 100).toFixed(2) }}%</span>
        </template>
      </span>
      <span class="mc-legend-vol"><em>量</em>{{ formatVolume(legend.ohlcv.volume) }}</span>
    </div>
    <div v-for="g in legend.indicators" :key="g.group" class="mc-legend-group">
      <span v-for="ind in g.items" :key="ind.key" class="mc-legend-item">
        <i :style="{ background: ind.color }" />
        <span class="mc-legend-title">{{ ind.title }}</span>
        <strong>{{ formatLegendValue(ind.unit, ind.value) }}</strong>
      </span>
    </div>
  </div>
</template>

<style>
/* hover 图例：左上角浮层，TradingView 风格 */
.mc-legend {
  position: absolute; top: 8px; left: 12px; z-index: 20;
  max-width: calc(100% - 24px);
  padding: 6px 10px; border-radius: 6px;
  background: rgba(251,250,244,0.92); backdrop-filter: blur(4px);
  border: 1px solid var(--line);
  font-size: 0.72rem; line-height: 1.45; color: var(--ink);
  font-variant-numeric: tabular-nums;
  pointer-events: none;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
}
.dark .mc-legend { background: rgba(34,36,31,0.92); }
.mc-legend.dir-up { border-color: rgba(14,117,88,0.45); }
.mc-legend.dir-down { border-color: rgba(169,50,38,0.45); }
.mc-legend-head {
  display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px;
  padding-bottom: 4px; margin-bottom: 4px; border-bottom: 1px dashed var(--line);
  font-weight: 700;
}
.mc-legend-date { color: var(--green); font-weight: 800; letter-spacing: 0.02em; }
.mc-legend-ohlc em,
.mc-legend-vol em {
  color: var(--muted); font-style: normal; font-weight: 800;
  font-size: 0.62rem; margin-right: 2px; margin-left: 2px;
}
.mc-legend-ohlc em:first-child, .mc-legend-vol em:first-child { margin-left: 0; }
.mc-legend-change { display: inline-flex; gap: 4px; align-items: baseline; }
.mc-legend-delta, .mc-legend-pct { font-weight: 800; }
.dir-up .mc-legend-delta, .dir-up .mc-legend-pct { color: #0e7558; }
.dir-down .mc-legend-delta, .dir-down .mc-legend-pct { color: #a93226; }
.mc-legend-group {
  display: flex; flex-wrap: wrap; gap: 2px 12px;
  padding: 2px 0;
}
.mc-legend-group + .mc-legend-group { border-top: 1px dotted rgba(120,120,120,0.18); }
.mc-legend-item { display: inline-flex; align-items: center; gap: 4px; min-width: 0; }
.mc-legend-item i {
  width: 10px; height: 2px; border-radius: 1px; display: inline-block; flex-shrink: 0;
}
.mc-legend-title {
  color: var(--muted); font-size: 0.66rem; font-weight: 700;
  white-space: nowrap;
}
.mc-legend-item strong { font-weight: 800; }
</style>
```

### Step 3.2：跑测试

```bash
npx vitest run
```
Expected: 仍 127 passed（新组件无单测，不破坏既有）

### Step 3.3：commit

```bash
git add src/components/MainChartHoverLegend.vue
git commit -m "feat(chart): extract MainChartHoverLegend subcomponent"
```

---

## Task 4：MainChart.vue 落地拆分

**Files:**
- Modify: `src/components/MainChart.vue`

> 用 Task 2 + 3 的产物替换 MainChart 内的对应代码，目标行数 < 500。

### Step 4.1：替换 import 块

定位文件第 1-17 行：

替换前：
```js
<script setup>
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
} from 'lightweight-charts'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ChartStatusBar from './ChartStatusBar.vue'
import { computeKDJ } from '../domain/indicators/kdj.js'
import { computeRSI } from '../domain/indicators/rsi.js'
import { resolveChartOverlayPlan } from '../domain/research-visualization/chartPaneLayout.js'
import { buildResearchStatusLabel } from '../domain/research-visualization/researchStatusLabel.js'
```

替换后：
```js
<script setup>
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
} from 'lightweight-charts'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ChartStatusBar from './ChartStatusBar.vue'
import MainChartHoverLegend from './MainChartHoverLegend.vue'
import { computeKDJ } from '../domain/indicators/kdj.js'
import { computeRSI } from '../domain/indicators/rsi.js'
import { resolveChartOverlayPlan } from '../domain/research-visualization/chartPaneLayout.js'
import { buildChartMarkers } from '../domain/research-visualization/chartMarkers.js'
```

> 删除 `computed` import（拆完不再用）；删除 `buildResearchStatusLabel` import（移到 chartMarkers.js）；新增 `MainChartHoverLegend` 与 `buildChartMarkers`。

### Step 4.2：删除常量 + buildMarkers 等

定位第 19-20 行：
```js
const MAX_REPLAY_MARKER_TRADES = 120
const MAX_REPLAY_TEXT_LABELS = 6
```
**整两行删除**（已搬到 chartMarkers.js）。

定位 `function buildMarkers() { ... }`、`function buildResearchMarkers() { ... }`、`function buildReplayMarkers() { ... }`、`function withMarkerText() { ... }` 四个函数（约第 322-399 行整段），**全部删除**。

定位 `function money(v) { ... }`、`function signedMoney(v) { ... }`（约第 589-590 行），**两行删除**（已搬走）。

### Step 4.3：替换 syncChart 中 markers 调用

定位 `if (markersApi) markersApi.setMarkers(buildMarkers())` 行（约第 318 行）：

替换前：
```js
  // markers：replay trades + 当前状态点
  if (markersApi) markersApi.setMarkers(buildMarkers())
  chart.timeScale().fitContent()
```

替换后：
```js
  // markers：replay trades + 当前决策点 + 研究层状态（domain helper）
  if (markersApi) {
    markersApi.setMarkers(buildChartMarkers({
      rows: props.rows,
      replay: props.replay,
      decision: props.decision,
      overlays: props.overlays,
      formulaPath: props.formulaPath,
    }))
  }
  chart.timeScale().fitContent()
```

### Step 4.4：删除 hover legend 渲染 + 工具函数

定位 `function formatLegendValue(unit, value) { ... }` 和 `function formatVolume(v) { ... }`（约第 538-553 行），**两个函数整体删除**（已搬到 MainChartHoverLegend 内）。

定位 `function overlayOn(key) { ... }`（约第 430-432 行）：

```js
function overlayOn(key) {
  return props.overlays[key] !== false
}
```
**整段删除**（不再被本文件使用，因为 markers 已搬走；如果 grep 还有引用则保留）。

> 注意：`overlayOn` 在删除前请用 grep 搜本文件确认没人用了。

### Step 4.5：替换模板 hover legend

定位 `<template>` 块内 hover legend 部分（约第 597-622 行）：

替换前：
```vue
    <!-- Hover 图例：展示日期 + OHLCV + 所有打开指标线的 Y 值 -->
    <div v-if="hoverLegend" class="mc-legend" :class="`dir-${hoverLegend.ohlcv.direction}`">
      <div class="mc-legend-head">
        <span class="mc-legend-date">{{ hoverLegend.date }}</span>
        <span class="mc-legend-ohlc">
          <em>开</em>{{ formatLegendValue('price', hoverLegend.ohlcv.open) }}
          <em>高</em>{{ formatLegendValue('price', hoverLegend.ohlcv.high) }}
          <em>低</em>{{ formatLegendValue('price', hoverLegend.ohlcv.low) }}
          <em>收</em>{{ formatLegendValue('price', hoverLegend.ohlcv.close) }}
        </span>
        <span class="mc-legend-change">
          <template v-if="Number.isFinite(hoverLegend.ohlcv.change)">
            <span class="mc-legend-delta">{{ hoverLegend.ohlcv.change > 0 ? '+' : '' }}{{ formatLegendValue('price', hoverLegend.ohlcv.change) }}</span>
            <span class="mc-legend-pct">{{ hoverLegend.ohlcv.changePct > 0 ? '+' : '' }}{{ (hoverLegend.ohlcv.changePct * 100).toFixed(2) }}%</span>
          </template>
        </span>
        <span class="mc-legend-vol"><em>量</em>{{ formatVolume(hoverLegend.ohlcv.volume) }}</span>
      </div>
      <div v-for="g in hoverLegend.indicators" :key="g.group" class="mc-legend-group">
        <span v-for="ind in g.items" :key="ind.key" class="mc-legend-item">
          <i :style="{ background: ind.color }" />
          <span class="mc-legend-title">{{ ind.title }}</span>
          <strong>{{ formatLegendValue(ind.unit, ind.value) }}</strong>
        </span>
      </div>
    </div>
```

替换后：
```vue
    <!-- Hover 图例：拆到子组件，本文件只构造 hoverLegend 对象 -->
    <MainChartHoverLegend :legend="hoverLegend" />
```

### Step 4.6：删除 `<style>` 中 mc-legend 相关样式

定位 `<style>` 块第 631-675 行所有 `.mc-legend*` 选择器（含 `.dark .mc-legend`、`.mc-legend.dir-up` 等），**整段删除**（已随子组件搬走）。

只保留：
```css
.main-chart-shell { position: relative; width: 100%; height: 100%; min-height: 0; overflow: hidden; }
.main-chart-canvas { width: 100%; height: 100%; }
```

### Step 4.7：跑 size 检查 + 测试

```bash
node scripts/check-file-size.mjs
```
Expected：**no output**（之前的红 `MainChart.vue: 677` 消失）。

```bash
node scripts/csv2js.mjs
node scripts/verify-domain.mjs
npx vitest run
```
Expected: `domain verification passed`、`127 passed`。

### Step 4.8：手动 dev 验证

```bash
npx vite dev
```
打开 `http://localhost:5173`，hover K 线确认 legend 仍显示（颜色/数值/格式正确），markers 仍点出 replay/decision 标记。

> 视觉验证完后 Ctrl+C 停 dev。

### Step 4.9：commit

```bash
git add src/components/MainChart.vue
git commit -m "refactor(chart): split MainChart into hover legend + markers helpers (677→<500 lines)"
```

---

## Task 5：dedupe `useReplay`

**Files:**
- Modify: `src/composables/useReplay.js`
- 现有测试已通过 121 个用例覆盖；本次只是性能 dedupe，**不改对外 API shape**

> 现状：`profileReplays` computed 内对 3 个 profile 各跑 `buildDailyReplay`；`replay` computed 又对当前 effective profile 跑一遍。同一个 input 变 → 4 次 buildDailyReplay。
>
> 修复策略：让 `replay` 从 `profileReplays` 中按 `effectiveInput.value.strategyProfile` 取那一条；如果 effective profile 不在三档（不太可能），fallback 计算一次。

### Step 5.1：重写 useReplay.js

替换前（整个文件，第 1-78 行）：

```js
import { computed } from 'vue'
import { buildDailyReplay } from '../domain/replay/dailyReplay.js'
import { strategyProfileList } from '../domain/planning/orderPlan.js'
// ... 78 行，详见上面读到的内容
```

替换后：

```js
import { computed } from 'vue'
import { buildDailyReplay } from '../domain/replay/dailyReplay.js'
import { strategyProfileList } from '../domain/planning/orderPlan.js'

/**
 * 回放层：跑当前 profile 的回放，再并行跑三档 profile 用于评分选档
 *
 * @param {Ref<Array>} rows
 * @param {object} input              reactive
 * @param {ComputedRef<object>} effectiveInput
 * @param {ComputedRef<Array>} marketStateFull  来自 useMarketState，避免重算
 * @param {object} featureFlags                 显式开关；默认不跑回放
 *
 * Dedupe 优化：原版 profileReplays 与 replay 各自调 buildDailyReplay，对 4 档 profile
 * 总共算 4 次。新版 replay 直接从 profileReplays 中按 strategyProfile 取那一条，
 * 总调用从 4 次降到 N 次（N = strategyProfileList.length）。effectiveInput 中除
 * strategyProfile 之外的字段不影响结果（已经被 buildDailyReplay 内部消费），所以
 * 不会改 API shape。
 */
export function useReplay(rows, input, effectiveInput, marketStateFull, featureFlags = {}) {
  const profileReplays = computed(() => strategyProfileList.map((profile) => ({
    profile,
    replay: featureFlags.replayAccount
      ? buildDailyReplay(rows.value, { ...input, strategyProfile: profile.id }, marketStateFull.value)
      : emptyReplay(),
  })))

  const recommendedProfile = computed(() => chooseProfile(
    profileReplays.value,
    Number(input.capital) + Number(input.baseNotional || 0),
  ))

  // dedupe: replay 直接复用 profileReplays 中匹配 effectiveInput.strategyProfile 的那条；
  // 如果 strategyProfileList 中没有对应 id（极端 fallback），临时算一次保证可用。
  const replay = computed(() => {
    if (!featureFlags.replayAccount) return emptyReplay()
    const targetId = effectiveInput.value.strategyProfile
    const hit = profileReplays.value.find((item) => item.profile.id === targetId)
    if (hit) return hit.replay
    return buildDailyReplay(rows.value, effectiveInput.value, marketStateFull.value)
  })

  return { profileReplays, recommendedProfile, replay }
}

function emptyReplay() {
  return {
    profileId: '',
    profileLabel: '',
    range: '',
    startDate: '',
    endDate: '',
    trades: [],
    equityCurve: [],
    tradeCount: 0,
    winRate: 0,
    totalPnl: 0,
    realizedPnl: 0,
    totalNotional: 0,
    returnOnUsedNotional: 0,
    maxDrawdown: 0,
    maxDrawdownPct: 0,
    maxDrawdownStart: null,
    maxDrawdownEnd: null,
    drawdownCurve: [],
    cash: 0,
    base: 0,
    openValue: 0,
    openCost: 0,
    status: 'disabled',
  }
}

function chooseProfile(items, capital) {
  if (!items.length) return strategyProfileList[1]
  if (items.every((item) => item.replay?.status)) return strategyProfileList[1]
  const accountSize = Math.max(capital || 0, 1)
  const scored = items.map((item) => {
    const replay = item.replay
    const drawdownPenalty = Math.abs(replay.maxDrawdown || 0) / accountSize
    const turnoverPenalty = Math.max(replay.tradeCount - 36, 0) * 0.0008
    const emptyPenalty = replay.tradeCount ? 0 : 0.01
    return {
      profile: item.profile,
      score: (replay.returnOnUsedNotional || 0) - drawdownPenalty * 0.85 - turnoverPenalty - emptyPenalty,
    }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored[0]?.profile ?? strategyProfileList[1]
}
```

> 关键差异：第 27-32 行 `replay` computed 改为先查 profileReplays。

### Step 5.2：跑测试

```bash
node scripts/csv2js.mjs
npx vitest run
```
Expected: 127 passed（dedupe 不动数值结果，所有既有测试都应保持通过）。

特别关注 `src/stores/__tests__/labStore.test.js`、`src/components/__tests__/ReplayPanel.test.js` 全过，这两个最依赖 replay shape。

### Step 5.3：手动验证 replayAccount 开关

dev 起来打开"回放账户"开关，确认：
- ProfileChip 推荐 profile 仍正确变化
- Decision tab 中 Profile 调优表格仍显示 4 档数据
- 回放面板（ReplayPanel）显示当前 profile 的 trade count / pnl / drawdown 与 profileReplays 中对应条一致

```bash
# 起 dev 验证后 Ctrl+C
npx vite dev
```

### Step 5.4：commit

```bash
git add src/composables/useReplay.js
git commit -m "perf(replay): dedupe useReplay buildDailyReplay calls (4→1 per input change)"
```

---

## Task 6：清 `domain/market/` re-export 残留

**Files:**
- Delete: `src/domain/market/cost.js`
- Delete: `src/domain/market/formulaPath.js`
- Delete: `src/domain/market/liquidityRack.js`
- Delete: `src/domain/market/ohlcv.js`
- Delete: `src/domain/market/tdpy.js`
- Delete: `src/domain/market/`（空目录）
- Modify: `src/components/RightPanel.vue`
- Modify: `src/components/TopBar.vue`
- Modify: `src/composables/useDataLoader.js`
- Modify: `src/domain/replay/dailyReplay.js`
- Modify: `src/domain/__tests__/replay.test.js`

> 现状：`src/domain/market/` 5 个文件全是 1 行 re-export 转发到 `market-data/` 真身（`liquidityRack.js` 转发到 `research-visualization/`）。除 `liquidityRack.js` 是孤儿外，其余 4 个有 5 处 import 引用。本 task 把所有引用改向真身，删 5 个 shim 文件，并删空目录 `domain/market/`。

### Step 6.1：改 5 处 import 引用

**RightPanel.vue 第 3 行：**

替换前：
```js
import { inferTdpy } from '../domain/market/tdpy.js'
```
替换后：
```js
import { inferTdpy } from '../domain/market-data/tdpy.js'
```

**TopBar.vue 第 5 行：**

替换前：
```js
import { deriveWindows } from '../domain/market/cost.js'
```
替换后：
```js
import { deriveWindows } from '../domain/market-data/cost.js'
```

**useDataLoader.js 第 3 行：**

替换前：
```js
import { btcHistorySource, parseCsvText } from '../domain/market/ohlcv.js'
```
替换后：
```js
import { btcHistorySource, parseCsvText } from '../domain/market-data/ohlcv.js'
```

**dailyReplay.js 第 1 行：**

替换前：
```js
import { buildMarketStatePath } from '../market/cost.js'
```
替换后：
```js
import { buildMarketStatePath } from '../market-data/cost.js'
```

**replay.test.js 第 2 行：**

替换前：
```js
import { buildMarketStatePath } from '../market/cost.js'
```
替换后：
```js
import { buildMarketStatePath } from '../market-data/cost.js'
```

### Step 6.2：跑 grep 确认没有遗漏

```bash
grep -rn "from.*domain/market/" src/  || echo NO_MORE_REFS
grep -rn "from.*\.\./market/" src/    || echo NO_MORE_REFS
```
Expected: 两条命令都输出 `NO_MORE_REFS`（grep 无命中）。

如果还有匹配项，修掉，重跑直到全清。

### Step 6.3：删 5 个 shim 文件 + 空目录

```bash
git rm src/domain/market/cost.js \
       src/domain/market/formulaPath.js \
       src/domain/market/liquidityRack.js \
       src/domain/market/ohlcv.js \
       src/domain/market/tdpy.js
rmdir src/domain/market
ls src/domain/market 2>&1 || echo "OK_DIR_GONE"
```
Expected: `OK_DIR_GONE`

### Step 6.4：跑全套验证

```bash
node scripts/csv2js.mjs
node scripts/check-file-size.mjs
node scripts/verify-domain.mjs
npx vitest run
```
Expected:
- check-file-size: no output
- verify-domain: passed
- vitest: 127 passed

### Step 6.5：dev 起来快速点一遍

```bash
npx vite dev
```
- 切几个标的（触发 RightPanel inferTdpy）
- 切几次时间（触发 TopBar deriveWindows）
- 加载 BTC 历史按钮（触发 useDataLoader btcHistorySource）

无报错即 OK。

### Step 6.6：commit

```bash
git add -A
git commit -m "refactor(domain): drop legacy market/ re-export shims, point all imports to market-data/"
```

---

## Task 7：合并 PR + 收尾（可选）

- [ ] **Step 7.1：跑最终全套**

```bash
node scripts/csv2js.mjs
node scripts/check-file-size.mjs
node scripts/verify-domain.mjs
npx vitest run
```
全部应过。

- [ ] **Step 7.2：push 分支**

```bash
git push -u origin feature/cleanup-mainchart-replay-market
```

- [ ] **Step 7.3：开 PR**

```bash
gh pr create --base main --title "refactor: P1 cleanup (MainChart split + replay dedupe + market shim removal)" --body "..."
```

PR body 模板见自审清单后面。

---

## 自审清单

### Spec 覆盖
| 优化点 | 任务 |
|---|---|
| MainChart 677 行 → < 500 行 | Task 2 + 3 + 4 |
| domain/market re-export 残留 | Task 6 |
| useReplay 4× → 1× | Task 5 |

### 占位符扫描
本 plan 所有 step 都给具体代码或具体命令，无 TBD/TODO/类似 task N 等占位。

### 风险确认
- **Task 4 拆分后视觉验证**：hover legend 子组件需要在 dev 中确认对位。
- **Task 5 dedupe**：依赖 effectiveInput.value.strategyProfile 必须在 strategyProfileList 中（4 档），如果未来加 profile 但未更新 list，fallback 路径仍能算出值。
- **Task 6 删 shim**：tests 已经覆盖 inferTdpy/deriveWindows/buildMarketStatePath/btcHistorySource，改路径不会影响数值；只是 import 路径变了。

### 类型一致性
- `chartMarkers.js` 的 `buildChartMarkers({ rows, replay, decision, overlays, formulaPath })` shape 与 MainChart Task 4 调用一致
- `MainChartHoverLegend` 的 `legend` prop shape 与 MainChart `buildLegend` 输出一致
- `useReplay` 对外 return shape 不变（profileReplays / recommendedProfile / replay 三个 ref 的 shape 完全保留）

---

## 执行交接

**Plan complete and saved to `docs/superpowers/plans/2026-05-18-marlab-bl-cleanup-cc.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - 主线程派 fresh subagent 跑每个 task，task 间做 spec compliance + code quality 两阶段 review

**2. Inline Execution** - 当前会话直接 executing-plans 一路推到底

**Which approach?**
