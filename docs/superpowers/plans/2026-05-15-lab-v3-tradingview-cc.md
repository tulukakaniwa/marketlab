# Market Lab v3 · TradingView 风重写实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Market Lab 从三栏布局重写为 TradingView 风：单页 TopBar + MainChart 占满 + 3 个右侧滑入抽屉（决策/计算/设置），保留 PR-1（日基弱化）+ PR-2（narrative 人话摘要）成果，domain 计算公式数值零回归。

**Architecture:** 顶部 `<TopBar>` 决策摘要条；中间 `<MainChart>` 占满，自带状态栏 chip + 三 FAB；浮层 `<DrawerHost>` 监听 `lab.activeDrawer` 单例挂载抽屉。Store 新增 `activeDrawer` / `chartOverlays`，删除 `activeMode` / `activeCapability*` / `selectCapability`。

**Tech Stack:** Vue 3 Composition API · Pinia setup store · vitest · `@vue/test-utils` · lightweight-charts · 现有 `usePersisted` localStorage 封装

**Spec:** `docs/superpowers/specs/2026-05-15-lab-v3-tradingview-design-cc.md`

**约束**：
- domain 公式数值零回归（`npm run verify:domain` 必须过）
- 保留 `inferTdpy` / `narrative.js` / `AdvancedSettings.vue` 内容
- 中文注释；测试中文 describe/it
- 项目源码不加 `-cc` 后缀；文件内容不署名工具
- 浅色主题为主

**命令注意**：
- 本机无 `pnpm`，全部用 `npx` / `npm`：
  - 跑单文件 vitest：`npx vitest run <path>`
  - 全量测试：`npm test`
  - verify:domain：`npm run verify:domain`
  - 启动 dev：`npm run dev`
- `npm run build` 脚本硬编码 pnpm，会失败。改用：`npm run check:data && npm run verify:domain && npx vite build`

**PR 划分**：
- **PR-A（任务 1-3）**：store / composable + 测试
- **PR-B（任务 4-9）**：抽屉壳 + 工具组件 + 现有组件 fragment 化
- **PR-C（任务 10-13）**：App.vue 重写 + TopBar + MainChart 改 + ProfileChip
- **PR-D（任务 14-18）**：抽屉接线 + 验收

每完成一个 PR 末尾跑一遍 `npm run check:data && npm run verify:domain && npm test`，全过才进下一个 PR。

---

## 任务前置说明

- **Pinia setup store 字段访问形式**：`useLabStore()` 返回的对象在 setup store 中已 unwrap，组件 / 测试中读 `lab.tdpyMeta.basis`、`lab.effectiveTdpy`、`lab.source.symbol` 等，**不要 `.value`**。在测试里赋值 `lab.source = { ... }` 即可。
- **DOM teleport**：抽屉用 `<Teleport to="body">`，避免被父布局 overflow 裁剪
- **保持兼容性**：旧 localStorage key 不主动清理（字段级合并已自动忽略不识别字段），但 `activeMode` / `activeCapabilityId` 不再被读取

---

## PR-A：store / composable 改造

### Task 1：新建 `composables/useChartOverlays.js` 与单测

**Files:**
- Create: `src/composables/useChartOverlays.js`
- Create: `src/composables/__tests__/useChartOverlays.test.js`

> 项目当前没有 composables/__tests__ 目录，先创建。

- [ ] **Step 1.1：创建测试目录**

```bash
ls src/composables/__tests__ 2>/dev/null || mkdir -p src/composables/__tests__
```

- [ ] **Step 1.2：写失败测试**

`src/composables/__tests__/useChartOverlays.test.js`：

```js
import { describe, expect, it, beforeEach } from 'vitest'
import { useChartOverlays } from '../useChartOverlays.js'

describe('useChartOverlays', () => {
  beforeEach(() => {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem('lab.chartOverlays.v1')
    }
  })

  it('返回 8 个开关字段，默认值符合 spec', () => {
    const o = useChartOverlays()
    expect(o.costBand).toBe(true)
    expect(o.entryLine).toBe(true)
    expect(o.volBand).toBe(true)
    expect(o.volume).toBe(true)
    expect(o.replayMarkers).toBe(true)
    expect(o.currentDecision).toBe(true)
    expect(o.deltaPane).toBe(false)
    expect(o.equityPane).toBe(false)
  })

  it('单字段修改是 reactive，下次取重新返回', () => {
    const o = useChartOverlays()
    o.deltaPane = true
    expect(o.deltaPane).toBe(true)
  })

  it('字段级合并：旧 storage 缺新字段时回退到默认值', () => {
    if (typeof window === 'undefined') return
    // 写入只含部分字段的旧数据
    window.localStorage.setItem(
      'lab.chartOverlays.v1',
      JSON.stringify({ costBand: false, deltaPane: true })
    )
    const o = useChartOverlays()
    expect(o.costBand).toBe(false)        // 旧值保留
    expect(o.deltaPane).toBe(true)         // 旧值保留
    expect(o.entryLine).toBe(true)         // 缺字段回退默认
    expect(o.volume).toBe(true)            // 缺字段回退默认
  })
})
```

- [ ] **Step 1.3：跑测试确认 FAIL**

```bash
npx vitest run src/composables/__tests__/useChartOverlays.test.js
```

Expected: 失败，`Cannot find module '../useChartOverlays.js'`。

- [ ] **Step 1.4：实现**

`src/composables/useChartOverlays.js`：

```js
import { persistedReactive } from './usePersisted.js'

/**
 * 主图叠加项开关：8 项布尔值，持久化到 localStorage
 *
 * 设计：
 *   - 默认显示常用项（成本带 / 入场 / 波动 / 量 / replay markers / 当前决策点）
 *   - Δ 子图、权益子图默认关，避免主图被压扁
 *   - persistedReactive 已内置字段级合并，旧 storage 缺字段自动回退默认
 */
const DEFAULTS = {
  costBand: true,
  entryLine: true,
  volBand: true,
  volume: true,
  replayMarkers: true,
  currentDecision: true,
  deltaPane: false,
  equityPane: false,
}

export function useChartOverlays() {
  return persistedReactive('lab.chartOverlays.v1', DEFAULTS)
}

export const CHART_OVERLAY_DEFAULTS = DEFAULTS
```

- [ ] **Step 1.5：跑测试确认 PASS**

```bash
npx vitest run src/composables/__tests__/useChartOverlays.test.js
```

Expected: 3 passed。

- [ ] **Step 1.6：全量回归**

```bash
npm test && npm run verify:domain
```

Expected: 测试数 +3（54 → 57），verify PASS。

---

### Task 2：`usePlanning.js` 删除 activeMode / activeCapability*

**Files:**
- Modify: `src/composables/usePlanning.js`

- [ ] **Step 2.1：删除 capability 相关 import 与状态**

将 `src/composables/usePlanning.js` 整体替换为：

```js
import { computed } from 'vue'
import { getFormulaStage } from '../domain/formulas/registry.js'
import { strategyProfileList } from '../domain/planning/orderPlan.js'
import { persistedReactive, persistedRef } from './usePersisted.js'

/**
 * 输入参数 + UI 选中态层
 *
 * v3 重写后：
 *   - 删除 activeMode（mode-tabs 不再存在）
 *   - 删除 activeCapabilityId / activeCapability / activeCapabilityStages / selectCapability
 *     （capability 选择 UI 已废弃；FormulaNav 直接按 formula 分组展示）
 *   - 保留 activeFormulaId（计算抽屉里"当前公式"高亮 + 完整公式列表点击切换）
 *   - 新增 activeDrawer（抽屉单例）
 */
export function usePlanning() {
  const input = persistedReactive('lab.input.v1', {
    entryPrice: 0,
    holdingDays: 30,
    iv: 0,
    targetReturn: 0.3,
    capital: 10000,
    baseNotional: 0,
    autoProfile: true,
    strategyProfile: 'balanced',
    strikePrice: 0,
    riskFreeRate: 0.04,
    optionType: 'put',
    startPrice: 0,
    rangeWidth: 0.1,
    skew: 1,
    liquidity: 1,
    hedgeSize: 0,
    fees: 0,
    perpTwap: 0,
    spotTwap: 0,
    pathUsesScenarioInputs: false,
    replayFeeRate: 0.001,
  })

  // 按 symbol 存 tdpy 覆盖值
  const tdpyOverride = persistedReactive('lab.tdpyOverride.v1', {})

  function setTdpyOverride(symbol, value) {
    if (!symbol) return
    if (value === null || !Number.isFinite(value) || value <= 0) {
      delete tdpyOverride[symbol]
      return
    }
    tdpyOverride[symbol] = value
  }

  function clearTdpyOverride(symbol) {
    if (symbol) delete tdpyOverride[symbol]
  }

  const activeFormulaId = persistedRef('lab.activeFormulaId.v1', 'delta-band')
  const activeFormula = computed(() => getFormulaStage(activeFormulaId.value))

  // 抽屉单例：'decision'|'compute'|'settings'|null
  const activeDrawer = persistedRef('lab.activeDrawer.v1', null)
  function openDrawer(name) { activeDrawer.value = name }
  function closeDrawer() { activeDrawer.value = null }

  return {
    input,
    tdpyOverride,
    setTdpyOverride,
    clearTdpyOverride,
    activeFormulaId,
    activeFormula,
    strategyProfileList,
    activeDrawer,
    openDrawer,
    closeDrawer,
  }
}

export function buildExecutionBrief(graph, profile, autoProfile) {
  const state = graph?.decision?.state ?? '未载入路径'
  const orders = graph?.plan?.primaryOrders ?? []
  const side = graph?.position?.side
  const verb = side === 'buy' ? '低价买入' : side === 'sell' && orders.length ? '底仓减压' : '等待低价'
  const firstOrder = orders[0]
  const bias = side === 'buy'
    ? '主策略：安全低价买入'
    : side === 'sell'
      ? '卖出只做仓位保护'
      : '主策略等待低价，不追高'
  return {
    title: verb === state ? state : `${verb} · ${state}`,
    bias,
    profileLabel: autoProfile ? `自动选择 ${profile?.label ?? '均衡'}` : `手动 ${graph?.profile?.label ?? '均衡'}`,
    price: firstOrder?.price ?? null,
    notional: firstOrder?.notional ?? 0,
    stop: graph?.position?.stopPrice ?? null,
    target: graph?.position?.targetPrice ?? null,
    reason: graph?.decision?.timing?.reason ?? graph?.position?.rule ?? '等待真实 K 线。',
  }
}
```

- [ ] **Step 2.2：跑 planning 单测**

```bash
npx vitest run src/domain/__tests__/planning.test.js
```

Expected: PASS（domain/__tests__/planning.test.js 测的是 orderPlan，不依赖 usePlanning 内部 capability 字段）。

如果 fail：检查 fail 信息。如果是测试假定了 `activeCapabilityId` 等字段，**不要在本任务里改测试**，下个 Task 一起修。

---

### Task 3：`labStore.js` 接入 activeDrawer / chartOverlays + 修测试

**Files:**
- Modify: `src/stores/labStore.js`
- Modify: `src/stores/__tests__/labStore.test.js`

- [ ] **Step 3.1：改 labStore.js**

定位 labStore.js 中 imports 段，追加：

```js
import { useChartOverlays } from '../composables/useChartOverlays.js'
```

定位 store 主体的 effectiveInput 计算（约第 42-48 行）。**effectiveInput 不变**，因为 strategyProfile 仍然有效；但要记得 effectiveInput 现在不依赖 activeMode。无需改动。

定位 return 块（第 89-141 行），整体替换为：

```js
  // chartOverlays 在 store 顶层初始化一次（同一份在所有组件间共享）
  const chartOverlays = useChartOverlays()

  return {
    // 数据层
    rows: data.rows,
    source: data.source,
    loading: data.loading,
    loadingSampleId: data.loadingSampleId,
    error: data.error,
    cursor: data.cursor,
    loadBtcHistory: data.loadBtcHistory,
    loadSample: data.loadSample,
    retryLast: data.retryLast,
    dismissError: data.dismissError,
    importText: data.importText,
    sourceLabel,
    marketSamples,

    // tdpy 层（PR-1）
    tdpyMeta,
    effectiveTdpy,
    setTdpyOverride: planning.setTdpyOverride,
    clearTdpyOverride: planning.clearTdpyOverride,
    tdpyOverride: planning.tdpyOverride,

    // 市场态层
    activeRows: marketState.activeRows,
    market: marketState.market,
    costPath: marketState.costPath,
    formulaPath: marketState.formulaPath,

    // 决策层
    input: planning.input,
    effectiveInput,
    graph,
    executionBrief,
    activeFormula: planning.activeFormula,
    activeFormulaId: planning.activeFormulaId,
    strategyProfileList: planning.strategyProfileList,

    // 抽屉与主图叠加（v3 新增）
    activeDrawer: planning.activeDrawer,
    openDrawer: planning.openDrawer,
    closeDrawer: planning.closeDrawer,
    chartOverlays,

    // 回放层
    profileReplays: replayLayer.profileReplays,
    recommendedProfile: replayLayer.recommendedProfile,
    replay: replayLayer.replay,

    // 杂项
    useCursorCloseAsEntry,
  }
})
```

> 注意：`activeMode` / `activeCapability` / `activeCapabilityId` / `activeCapabilityStages` / `formulaCapabilities` / `selectCapability` 全部已删除。

- [ ] **Step 3.2：修 labStore.test.js**

`src/stores/__tests__/labStore.test.js` 整体替换为：

```js
import { setActivePinia, createPinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useLabStore } from '../labStore.js'

describe('useLabStore（v3 重写后契约）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.clear()
    }
  })

  it('对外 API 字段齐全', () => {
    const lab = useLabStore()
    // 数据层
    expect(lab.rows).toBeDefined()
    expect(lab.cursor).toBeDefined()
    expect(typeof lab.loadSample).toBe('function')
    expect(typeof lab.importText).toBe('function')
    // 市场态
    expect(lab.market).toBeDefined()
    expect(lab.costPath).toBeDefined()
    expect(lab.formulaPath).toBeDefined()
    // 决策
    expect(lab.input).toBeDefined()
    expect(lab.graph).toBeDefined()
    expect(lab.effectiveInput).toBeDefined()
    // 回放
    expect(lab.replay).toBeDefined()
    expect(lab.profileReplays).toBeDefined()
    expect(lab.recommendedProfile).toBeDefined()
    // 抽屉与主图叠加（v3）
    expect(lab.activeDrawer).toBeDefined()
    expect(typeof lab.openDrawer).toBe('function')
    expect(typeof lab.closeDrawer).toBe('function')
    expect(lab.chartOverlays).toBeDefined()
    expect(lab.chartOverlays.costBand).toBe(true)
  })

  it('初始 input 默认值正确', () => {
    const lab = useLabStore()
    expect(lab.input.holdingDays).toBe(30)
    expect(lab.input.targetReturn).toBe(0.3)
    expect(lab.input.autoProfile).toBe(true)
    // tdpy 已从 input 移到 store 层 effectiveTdpy；首次无 source，走 fallback 365
    expect(lab.effectiveTdpy).toBe(365)
    expect(lab.tdpyMeta.basis).toBe('fallback')
  })

  it('importText 解析 CSV 并触发输入回填', async () => {
    const lab = useLabStore()
    const csv = ['date,open,high,low,close,volume',
      ...Array.from({ length: 60 }, (_, i) => {
        const close = 100 + i * 0.5
        return `2024-01-${String(i + 1).padStart(2, '0')},${close},${close + 1},${close - 1},${close},1000`
      })].join('\n')
    lab.importText(csv, '测试集')
    await new Promise(r => setTimeout(r, 50))
    expect(lab.rows.length).toBeGreaterThan(0)
    expect(lab.input.entryPrice).toBeGreaterThan(0)
    expect(lab.input.iv).toBeGreaterThanOrEqual(0)
  })

  it('A3 回归：tdpy 切换不污染缓存', () => {
    const lab = useLabStore()
    const csv = ['date,open,high,low,close,volume',
      ...Array.from({ length: 80 }, (_, i) => {
        const close = 100 + Math.sin(i / 5) * 3
        return `2024-01-${String((i % 28) + 1).padStart(2, '0')},${close},${close + 0.5},${close - 0.5},${close},1000`
      })].join('\n')
    lab.importText(csv, '测试集')
    // 'TEST' 走美股 252，覆盖为 365 触发不同结果
    lab.source = { ...lab.source, symbol: 'TEST' }
    const v1 = lab.market.annualVol
    lab.setTdpyOverride('TEST', 365)
    const v2 = lab.market.annualVol
    expect(v1).not.toBeCloseTo(v2, 4)
  })

  it('effectiveTdpy 默认按 source 自动判断', () => {
    const lab = useLabStore()
    lab.source = { id: 'x', symbol: 'BTCUSDT', label: 'BTC', url: '' }
    expect(lab.tdpyMeta.basis).toBe('crypto')
    expect(lab.effectiveTdpy).toBe(365)

    lab.source = { id: 'y', symbol: 'AAPL', market: '美股', label: 'AAPL', url: '' }
    expect(lab.tdpyMeta.basis).toBe('us')
    expect(lab.effectiveTdpy).toBe(252)
  })

  it('用户覆盖优先于自动判断，且 per-symbol 隔离', () => {
    const lab = useLabStore()
    lab.source = { id: 'a', symbol: 'AAPL', market: '美股', label: 'AAPL', url: '' }
    lab.setTdpyOverride('AAPL', 365)
    expect(lab.effectiveTdpy).toBe(365)

    lab.source = { id: 'b', symbol: 'BTCUSDT', label: 'BTC', url: '' }
    expect(lab.effectiveTdpy).toBe(365)
    lab.setTdpyOverride('BTCUSDT', 252)
    expect(lab.effectiveTdpy).toBe(252)

    lab.source = { id: 'a', symbol: 'AAPL', market: '美股', label: 'AAPL', url: '' }
    expect(lab.effectiveTdpy).toBe(365)

    lab.clearTdpyOverride('AAPL')
    expect(lab.effectiveTdpy).toBe(252)
  })

  it('openDrawer / closeDrawer 切换 activeDrawer', () => {
    const lab = useLabStore()
    expect(lab.activeDrawer).toBe(null)
    lab.openDrawer('decision')
    expect(lab.activeDrawer).toBe('decision')
    lab.openDrawer('compute')
    expect(lab.activeDrawer).toBe('compute')
    lab.closeDrawer()
    expect(lab.activeDrawer).toBe(null)
  })

  it('chartOverlays 单字段切换生效', () => {
    const lab = useLabStore()
    expect(lab.chartOverlays.deltaPane).toBe(false)
    lab.chartOverlays.deltaPane = true
    expect(lab.chartOverlays.deltaPane).toBe(true)
  })
})
```

> 注意：删了"selectCapability 切换 active 公式"用例（API 不再存在）；新增 2 个用例（openDrawer/closeDrawer + chartOverlays）。

- [ ] **Step 3.3：跑 labStore 测试**

```bash
npx vitest run src/stores/__tests__/labStore.test.js
```

Expected: 8 passed。如果 fail，check 是否有别处依赖 `selectCapability`：

```bash
npx grep -r "selectCapability\|activeCapability\|activeMode" src/
```

如有其他文件引用到 capability 字段，**不要在本任务修**，记录给我看。

- [ ] **Step 3.4：全量回归**

```bash
npm test && npm run verify:domain
```

Expected: PASS。整体测试数：3（new useChartOverlays） + 8（new labStore） + 11（narrative） + 6（tdpy） + 9（cost） + 9（formulas） + 4（replay） + 5（planning） = **55 passed**。

> 如有 fail：可能是 `App.vue` / `QuestionNav.vue` 模板引用了 `lab.activeMode` / `lab.activeCapabilityId` / `lab.selectCapability`。这是预期内的——PR-C 会重写 App.vue，PR-D 会处理 QuestionNav。**fail 可暂时忽略**继续 PR-B；最迟 PR-C 完成时修干净。具体来说，先 grep 一下并把结果记下来：
> 
> ```bash
> npx grep -rn "activeMode\|activeCapability\|selectCapability" src/components/ src/App.vue
> ```

---

## PR-B：抽屉壳 + 工具组件 + fragment 化

### Task 4：新建 `ParamPopover.vue` + 单测

**Files:**
- Create: `src/components/ParamPopover.vue`
- Create: `src/components/__tests__/ParamPopover.test.js`

> 项目当前没有 components/__tests__；先创建。

- [ ] **Step 4.1：创建测试目录**

```bash
ls src/components/__tests__ 2>/dev/null || mkdir -p src/components/__tests__
```

- [ ] **Step 4.2：写失败测试**

`src/components/__tests__/ParamPopover.test.js`：

```js
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ParamPopover from '../ParamPopover.vue'

describe('ParamPopover', () => {
  it('合法值 + Enter 触发 confirm', async () => {
    const wrapper = mount(ParamPopover, {
      props: { field: 'entryPrice', value: 100 },
    })
    const input = wrapper.find('input[type="number"]')
    await input.setValue('99.5')
    await input.trigger('keydown.enter')
    expect(wrapper.emitted('confirm')).toBeTruthy()
    expect(wrapper.emitted('confirm')[0][0]).toBe(99.5)
  })

  it('点击应用按钮也触发 confirm', async () => {
    const wrapper = mount(ParamPopover, {
      props: { field: 'iv', value: 0.4 },
    })
    const input = wrapper.find('input[type="number"]')
    // iv 字段 UI 显示 % 单位，输入 50 表示 50%
    await input.setValue('50')
    const apply = wrapper.findAll('button').find(b => b.text() === '应用')
    await apply.trigger('click')
    expect(wrapper.emitted('confirm')).toBeTruthy()
    // 50% → 0.5
    expect(wrapper.emitted('confirm')[0][0]).toBe(0.5)
  })

  it('非法值（≤0）按钮 disabled，不 emit', async () => {
    const wrapper = mount(ParamPopover, {
      props: { field: 'entryPrice', value: 100 },
    })
    const input = wrapper.find('input[type="number"]')
    await input.setValue('-5')
    const apply = wrapper.findAll('button').find(b => b.text() === '应用')
    expect(apply.attributes('disabled')).toBeDefined()
    await input.trigger('keydown.enter')
    expect(wrapper.emitted('confirm')).toBeFalsy()
  })

  it('Esc 触发 cancel', async () => {
    const wrapper = mount(ParamPopover, {
      props: { field: 'holdingDays', value: 30 },
    })
    await wrapper.find('input[type="number"]').trigger('keydown.escape')
    expect(wrapper.emitted('cancel')).toBeTruthy()
  })
})
```

- [ ] **Step 4.3：跑测试确认 FAIL**

```bash
npx vitest run src/components/__tests__/ParamPopover.test.js
```

Expected: 失败。

- [ ] **Step 4.4：实现**

`src/components/ParamPopover.vue`：

```vue
<script setup>
import { computed, onMounted, ref } from 'vue'

/**
 * 单字段编辑 popover
 *
 * field: 'entryPrice' | 'iv' | 'holdingDays' | 'targetReturn'
 *
 * 单位转换：
 *   - iv / targetReturn 内部存 0~5 浮点（0.4 = 40%），UI 显示 0~500 整数
 *   - entryPrice / holdingDays 直传
 *
 * 校验：
 *   - entryPrice > 0
 *   - iv: 1 ≤ ui ≤ 500（即 0.01 ≤ store ≤ 5）
 *   - holdingDays: 1 ≤ ui ≤ 365 整数
 *   - targetReturn: 1 ≤ ui ≤ 500
 */
const props = defineProps({
  field: { type: String, required: true },
  value: { type: Number, required: true },
})

const emit = defineEmits(['confirm', 'cancel'])

const META = {
  entryPrice:   { label: '入场价',  unit: '',  step: 0.01, min: 0.01, max: 1e9, scale: 1 },
  iv:           { label: '波动率',  unit: '%', step: 0.5,  min: 1,    max: 500, scale: 0.01 },
  holdingDays:  { label: '持仓窗口', unit: '天', step: 1,    min: 1,    max: 365, scale: 1, integer: true },
  targetReturn: { label: '目标收益', unit: '%', step: 0.5,  min: 1,    max: 500, scale: 0.01 },
}

const meta = computed(() => META[props.field] ?? META.entryPrice)

const inputValue = ref('')
const inputEl = ref(null)

onMounted(() => {
  inputValue.value = String(props.value / meta.value.scale)
  // 自动聚焦 + 全选
  inputEl.value?.focus()
  inputEl.value?.select()
})

const numericInput = computed(() => Number(inputValue.value))
const isValid = computed(() => {
  const n = numericInput.value
  if (!Number.isFinite(n)) return false
  if (n < meta.value.min || n > meta.value.max) return false
  if (meta.value.integer && !Number.isInteger(n)) return false
  return true
})

function confirm() {
  if (!isValid.value) return
  const final = numericInput.value * meta.value.scale
  emit('confirm', final)
}

function cancel() {
  emit('cancel')
}

function onKeydown(e) {
  if (e.key === 'Enter') {
    e.preventDefault()
    confirm()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    cancel()
  }
}
</script>

<template>
  <div class="param-popover">
    <header>{{ meta.label }}</header>
    <label>
      <input
        ref="inputEl"
        v-model="inputValue"
        type="number"
        :min="meta.min"
        :max="meta.max"
        :step="meta.step"
        :class="{ invalid: !isValid }"
        @keydown="onKeydown"
      />
      <span v-if="meta.unit">{{ meta.unit }}</span>
    </label>
    <div class="pp-actions">
      <button type="button" :disabled="!isValid" @click="confirm">应用</button>
      <button type="button" class="pp-cancel" @click="cancel">取消</button>
    </div>
  </div>
</template>

<style>
.param-popover { width: 220px; padding: 10px 12px; background: var(--panel); border: 1px solid var(--line); border-radius: 6px; box-shadow: 0 6px 18px rgba(0,0,0,0.12); display: grid; gap: 8px; }
.param-popover header { color: var(--green); font-size: 0.62rem; font-weight: 900; letter-spacing: 0.06em; text-transform: uppercase; }
.param-popover label { display: flex; gap: 4px; align-items: baseline; }
.param-popover input { flex: 1; min-height: 30px; padding: 4px 7px; border: 1px solid var(--line); border-radius: 5px; background: var(--bg); color: var(--ink); font-variant-numeric: tabular-nums; font-size: 0.86rem; }
.param-popover input.invalid { border-color: #b8860b; }
.param-popover label span { color: var(--muted); font-size: 0.7rem; }
.pp-actions { display: flex; gap: 6px; justify-content: flex-end; }
.pp-actions button { min-height: 26px; padding: 1px 10px; border: 1px solid var(--line); border-radius: 4px; background: var(--bg); color: var(--ink); font-size: 0.74rem; font-weight: 800; cursor: pointer; }
.pp-actions button:disabled { opacity: 0.4; cursor: not-allowed; }
.pp-actions button:not(:disabled):not(.pp-cancel):hover { border-color: var(--green); }
.pp-cancel { color: var(--muted); }
</style>
```

- [ ] **Step 4.5：跑测试确认 PASS**

```bash
npx vitest run src/components/__tests__/ParamPopover.test.js
```

Expected: 4 passed。

> **如有 fail**：常见原因是测试中 `setValue('-5')` 后 isValid 变 false，但 `disabled` 在 attribute 上是 `""` 而非 `disabled`。Vitest dom 中可用 `expect(apply.attributes('disabled')).toBeDefined()` 已经处理。如有其他差异，按 fail 信息调整测试。

---

### Task 5：把 `AdvancedSettings.vue` 拆成 fragment

**Files:**
- Create: `src/components/AdvancedSettingsContent.vue`
- Modify: `src/components/AdvancedSettings.vue`（保留兼容 wrapper）

设计：把 AdvancedSettings 的"内容部分"提取到 `AdvancedSettingsContent.vue`，原 AdvancedSettings 改成薄 wrapper 用 `<details>` 包一层（保留向后兼容，App.vue 还在用）。

- [ ] **Step 5.1：创建 AdvancedSettingsContent.vue**

`src/components/AdvancedSettingsContent.vue`：

```vue
<script setup>
import { computed, ref } from 'vue'

const props = defineProps({
  tdpyMeta: { type: Object, required: true },
  effectiveTdpy: { type: Number, required: true },
  symbol: { type: String, default: '' },
})

const emit = defineEmits(['override', 'reset'])

const PRESETS = [
  { value: 365, label: '365' },
  { value: 252, label: '252' },
  { value: 242, label: '242' },
  { value: 179, label: '179' },
]

const customInput = ref('')

const isOverridden = computed(() => props.effectiveTdpy !== props.tdpyMeta.value)

function applyPreset(value) {
  if (!props.symbol) return
  emit('override', props.symbol, value)
}

function applyCustom() {
  const num = Number(customInput.value)
  if (!Number.isFinite(num) || num <= 0) {
    customInput.value = ''
    return
  }
  const clamped = Math.max(60, Math.min(400, Math.round(num)))
  emit('override', props.symbol, clamped)
  customInput.value = String(clamped)
}

function resetToAuto() {
  emit('reset', props.symbol)
}
</script>

<template>
  <div class="adv-content">
    <div class="adv-current-line">
      年时间基 <strong>{{ effectiveTdpy }}</strong>
      <em :class="['adv-source', { overridden: isOverridden }]">
        {{ isOverridden ? '已手动覆盖' : `按品种自动 · ${tdpyMeta.label}` }}
      </em>
    </div>
    <div class="adv-presets">
      <button
        v-for="p in PRESETS"
        :key="p.value"
        type="button"
        :class="['adv-preset', { active: effectiveTdpy === p.value }]"
        :disabled="!symbol"
        @click="applyPreset(p.value)"
      >{{ p.label }}</button>
      <label class="adv-custom">
        <span>自定义</span>
        <input v-model="customInput" type="number" min="60" max="400" placeholder="60-400" @keydown.enter="applyCustom" />
        <button type="button" :disabled="!symbol || !customInput" @click="applyCustom">应用</button>
      </label>
    </div>
    <button type="button" class="adv-reset" :disabled="!isOverridden" @click="resetToAuto">恢复自动</button>
    <p class="adv-hint">
      年时间基用于把日波动年化（IV、Δ 带、BS、回放共用）。日常无需调整；当数据集与默认市场口径不符时再手动覆盖。
    </p>
  </div>
</template>

<style>
.adv-content { display: grid; gap: 8px; }
.adv-current-line { font-size: 0.78rem; color: var(--ink); display: flex; gap: 6px; align-items: baseline; flex-wrap: wrap; }
.adv-current-line strong { font-variant-numeric: tabular-nums; }
.adv-source { font-style: normal; padding: 1px 6px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); font-size: 0.62rem; }
.adv-source.overridden { border-color: #b8860b; color: #b8860b; }
.adv-presets { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; }
.adv-preset { min-height: 26px; padding: 2px 9px; border: 1px solid var(--line); border-radius: 4px; background: var(--bg); color: var(--ink); font-size: 0.74rem; font-weight: 700; cursor: pointer; }
.adv-preset.active { border-color: var(--green); background: var(--surface-active); }
.adv-preset:disabled { opacity: 0.4; cursor: not-allowed; }
.adv-custom { display: inline-flex; gap: 3px; align-items: center; font-size: 0.66rem; color: var(--muted); }
.adv-custom input { width: 70px; min-height: 26px; border: 1px solid var(--line); border-radius: 4px; padding: 2px 5px; background: var(--bg); color: var(--ink); font-variant-numeric: tabular-nums; }
.adv-custom button { min-height: 26px; padding: 1px 7px; border: 1px solid var(--line); border-radius: 4px; background: var(--bg); color: var(--ink); font-size: 0.7rem; cursor: pointer; }
.adv-reset { width: fit-content; min-height: 26px; padding: 1px 9px; border: 1px solid var(--line); border-radius: 4px; background: var(--bg); color: var(--ink); font-size: 0.7rem; cursor: pointer; }
.adv-reset:disabled { opacity: 0.4; cursor: not-allowed; }
.adv-hint { margin: 0; padding: 4px 0 0; color: var(--muted); font-size: 0.62rem; line-height: 1.4; border-top: 1px dashed var(--line); }
</style>
```

- [ ] **Step 5.2：精简 AdvancedSettings.vue 为 wrapper**

> 这个 wrapper 在 PR-C 重写 App.vue 时会被废弃删除，但本任务保持向后兼容（避免 App.vue 立刻坏掉）。

`src/components/AdvancedSettings.vue` 整体替换为：

```vue
<script setup>
import AdvancedSettingsContent from './AdvancedSettingsContent.vue'

const props = defineProps({
  tdpyMeta: { type: Object, required: true },
  effectiveTdpy: { type: Number, required: true },
  symbol: { type: String, default: '' },
  open: { type: Boolean, default: false },
})

const emit = defineEmits(['override', 'reset', 'toggle'])

function onSummaryClick(e) {
  e.preventDefault()
  emit('toggle', !props.open)
}
</script>

<template>
  <details class="adv-card" :open="open">
    <summary @click="onSummaryClick">
      <span class="adv-title">高级 · 计算口径</span>
      <span class="adv-current">
        年时间基 <strong>{{ effectiveTdpy }}</strong>
        <em :class="['adv-source', { overridden: effectiveTdpy !== tdpyMeta.value }]">
          {{ effectiveTdpy !== tdpyMeta.value ? '已手动覆盖' : `按品种自动 · ${tdpyMeta.label}` }}
        </em>
      </span>
    </summary>
    <AdvancedSettingsContent
      :tdpy-meta="tdpyMeta"
      :effective-tdpy="effectiveTdpy"
      :symbol="symbol"
      @override="(s, v) => emit('override', s, v)"
      @reset="(s) => emit('reset', s)"
    />
  </details>
</template>

<style>
.adv-card { border: 1px dashed var(--line); border-radius: 7px; background: var(--panel); padding: 6px 8px; }
.adv-card[open] { border-style: solid; }
.adv-card summary { display: flex; justify-content: space-between; align-items: center; gap: 8px; cursor: pointer; list-style: none; }
.adv-card summary::-webkit-details-marker { display: none; }
.adv-title { color: var(--green); font-size: 0.62rem; font-weight: 900; letter-spacing: 0.05em; text-transform: uppercase; }
.adv-current { font-size: 0.74rem; color: var(--ink); display: flex; gap: 6px; align-items: baseline; }
.adv-current strong { font-variant-numeric: tabular-nums; }
.adv-source { font-style: normal; padding: 1px 6px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); font-size: 0.62rem; }
.adv-source.overridden { border-color: #b8860b; color: #b8860b; }
</style>
```

- [ ] **Step 5.3：跑测试**

```bash
npm test
```

Expected: 仍 PASS（这个改动不影响测试）。

---

### Task 6：把 `FormulaDrawer.vue` 内容提取为 fragment

**Files:**
- Create: `src/components/FormulaDrawerContent.vue`
- Modify: `src/components/FormulaDrawer.vue`（保留 wrapper 兼容）

- [ ] **Step 6.1：创建 FormulaDrawerContent.vue**

`src/components/FormulaDrawerContent.vue`：

```vue
<script setup>
import { computed } from 'vue'
import { formulaStages } from '../domain/formulas/registry.js'

const props = defineProps({
  formulaId: { type: String, default: '' },
  graph: { type: Object, default: () => ({}) },
  market: { type: Object, default: null },
})

const stage = computed(() => formulaStages.find(s => s.id === props.formulaId))
const feedsFromHere = computed(() => stage.value?.feeds ?? [])
const fedFromUpstream = computed(() => formulaStages.filter(s => s.feeds?.includes(props.formulaId)).map(s => s.id))

const currentValues = computed(() => {
  const id = props.formulaId
  const g = props.graph
  const m = props.market
  if (!id) return []
  const v = []
  switch (id) {
    case 'path':
      v.push(['行数', m?.rows ?? '—'])
      v.push(['日期范围', m?.range ?? '—'])
      break
    case 'cost':
      v.push(['成本锚', fmt(m?.costAnchor)])
      v.push(['偏离', pct(m?.costDistance)])
      v.push(['上沿 / 下沿', `${fmt(m?.costHigh)} / ${fmt(m?.costLow)}`])
      v.push(['5日斜率', pct(m?.costSlope5)])
      break
    case 'volatility':
      v.push(['年化波动', pct(m?.annualVol)])
      v.push(['ATR%', pct(m?.atrPercent)])
      v.push(['5日动量', pct(m?.momentum5)])
      break
    case 'delta-band':
      v.push(['多头低', fmt(g.deltaBands?.long?.low)])
      v.push(['多头成本', fmt(g.deltaBands?.long?.cost)])
      v.push(['多头高', fmt(g.deltaBands?.long?.high)])
      v.push(['e_T', f4(g.deltaBands?.wave)])
      break
    case 'option-greeks':
      v.push(['价格', fmt(g.option?.price)])
      v.push(['Delta', f4(g.option?.delta)])
      v.push(['Gamma', f4(g.option?.gamma)])
      v.push(['Theta', f4(g.option?.theta)])
      v.push(['Vega', f4(g.option?.vega)])
      break
    case 'lp-inventory':
      v.push(['LP 价值', fmt(g.lpV3?.value)])
      v.push(['库存 Delta', f4(g.lpV3?.inventoryDelta)])
      v.push(['IL', pct(g.impermanentLoss?.impermanentLoss)])
      break
    case 'capital-efficiency':
      v.push(['效率倍数', `${(g.efficiency?.efficiency ?? 0).toFixed(2)}×`])
      v.push(['区间下沿', f4(g.efficiency?.lower)])
      v.push(['区间上沿', f4(g.efficiency?.upper)])
      break
    case 'funding':
      v.push(['资金费率', pct(g.funding?.ratio)])
      v.push(['累计资金成本', f4(g.funding?.funding)])
      break
    case 'portfolio':
      v.push(['组合价值', fmt(g.portfolio)])
      break
    case 'order-plan':
      v.push(['挂单档数', g.plan?.primaryOrders?.length ?? 0])
      v.push(['失效下沿', fmt(g.plan?.invalidation?.lower)])
      v.push(['失效上沿', fmt(g.plan?.invalidation?.upper)])
      v.push(['决策状态', g.decision?.state ?? '—'])
      break
    default:
      v.push(['详见公式图', '点击中央公式面板查看可视化'])
  }
  return v
})

const decisionImpact = computed(() => {
  const id = props.formulaId
  const map = {
    path: '所有下游计算的输入口径',
    cost: '决定挂单的成本锚、上下沿、回归目标',
    volatility: '决定挂单间距与失效阈值',
    'delta-band': '直接生成挂单价格梯队（试仓/加仓/极值）',
    'option-greeks': '提供方向风险（Delta）与曲率（Gamma）参考',
    'lp-inventory': 'LP 库存暴露 → 组合 Delta 一部分',
    'capital-efficiency': '决定 LP 区间是否值得收窄',
    funding: '永续持仓的累计成本，影响 net carry',
    portfolio: '统一检查 LP/期权/对冲/费用是否相加正',
    'order-plan': '最终输出：挂买/挂卖/失效线/目标价',
    'deviation-score': '判断当前偏离是否够强，是否触发交易',
    'risk-surface': '展示不同价格上的 Greeks 曲线，挂单前看曲率',
    'net-lp-efficiency': 'IL × CE 净效率 → LP 是否可行',
    'net-carry': '判断回归收益能否覆盖资金费',
    'mean-reversion': '估计回归速度，决定持仓时长',
    'gamma-pnl': '凸性头寸的实际波动收益估计',
    'vol-confidence': '当前 IV 估计的置信区间',
  }
  return map[id] ?? '该公式参与研究层，不直接进入挂单结论'
})

function fmt(v) { return Number.isFinite(v) ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(v) : '—' }
function f4(v) { return Number.isFinite(v) ? v.toFixed(4) : '—' }
function pct(v) { return Number.isFinite(v) ? `${(v * 100).toFixed(2)}%` : '—' }
</script>

<template>
  <div v-if="stage" class="fdc">
    <header class="fdc-head">
      <span>{{ stage.layer }} · {{ stage.label }}</span>
      <strong>{{ stage.role }}</strong>
    </header>

    <section class="fdc-block">
      <h4>当前值</h4>
      <dl>
        <template v-for="[k, v] in currentValues" :key="k">
          <dt>{{ k }}</dt>
          <dd>{{ v }}</dd>
        </template>
      </dl>
    </section>

    <section class="fdc-block">
      <h4>决策落点</h4>
      <p>{{ decisionImpact }}</p>
    </section>

    <section class="fdc-block">
      <h4>输入 / 输出</h4>
      <dl>
        <dt>输入</dt>
        <dd>{{ stage.inputs.join(' · ') }}</dd>
        <dt>输出</dt>
        <dd>{{ stage.outputs.join(' · ') }}</dd>
      </dl>
    </section>

    <section v-if="stage.formulas.length" class="fdc-block">
      <h4>公式</h4>
      <pre v-for="f in stage.formulas" :key="f">{{ f }}</pre>
    </section>

    <section v-if="feedsFromHere.length || fedFromUpstream.length" class="fdc-block">
      <h4>依赖关系</h4>
      <p v-if="fedFromUpstream.length"><b>上游</b>{{ fedFromUpstream.join(' / ') }}</p>
      <p v-if="feedsFromHere.length"><b>下游</b>{{ feedsFromHere.join(' / ') }}</p>
    </section>

    <section class="fdc-block fdc-status">
      <span :class="stage.status === 'implemented' ? 'live' : 'mapped'">
        {{ stage.status === 'implemented' ? '已计算' : '研究层（不参与默认挂单）' }}
      </span>
    </section>
  </div>
  <div v-else class="fdc-empty">未选中公式</div>
</template>

<style>
.fdc { display: grid; gap: 14px; align-content: start; }
.fdc-head { display: grid; gap: 4px; padding-bottom: 10px; border-bottom: 1px solid var(--line); }
.fdc-head span { color: var(--green); font-size: 0.62rem; font-weight: 900; letter-spacing: 0.07em; text-transform: uppercase; }
.fdc-head strong { font-size: 0.95rem; line-height: 1.35; color: var(--ink); }
.fdc-block { display: grid; gap: 6px; }
.fdc-block h4 { margin: 0; color: var(--green); font-size: 0.66rem; font-weight: 900; letter-spacing: 0.06em; text-transform: uppercase; }
.fdc-block p { margin: 0; color: var(--ink); font-size: 0.82rem; line-height: 1.5; }
.fdc-block p b { color: var(--muted); margin-right: 6px; font-size: 0.7rem; font-weight: 800; text-transform: uppercase; }
.fdc-block dl { display: grid; grid-template-columns: 90px 1fr; gap: 4px 10px; margin: 0; }
.fdc-block dt { color: var(--muted); font-size: 0.74rem; font-weight: 700; }
.fdc-block dd { margin: 0; color: var(--ink); font-size: 0.82rem; font-variant-numeric: tabular-nums; }
.fdc-block pre { margin: 0; padding: 6px 8px; background: var(--bg); border: 1px solid var(--line); border-radius: 5px; color: var(--blue); font-size: 0.72rem; overflow-x: auto; white-space: pre-wrap; word-break: break-word; }
.fdc-status { padding-top: 10px; border-top: 1px solid var(--line); }
.fdc-status span { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 0.7rem; font-weight: 800; }
.fdc-status .live { background: var(--surface-active); color: var(--green); border: 1px solid var(--green); }
.fdc-status .mapped { background: var(--surface-alt); color: var(--muted); border: 1px solid var(--line); }
.fdc-empty { color: var(--muted); font-size: 0.78rem; padding: 8px; text-align: center; }
</style>
```

- [ ] **Step 6.2：精简 FormulaDrawer.vue 复用 content**

`src/components/FormulaDrawer.vue` 整体替换为：

```vue
<script setup>
import { X } from 'lucide-vue-next'
import FormulaDrawerContent from './FormulaDrawerContent.vue'

defineProps({
  open: { type: Boolean, default: false },
  formulaId: { type: String, default: '' },
  graph: { type: Object, default: () => ({}) },
  market: { type: Object, default: null },
})

const emit = defineEmits(['close'])

function close() { emit('close') }

function onKeydown(e) {
  if (e.key === 'Escape') close()
}
</script>

<template>
  <Transition name="drawer">
    <div v-if="open" class="fd-overlay" @click.self="close" @keydown="onKeydown" tabindex="-1">
      <aside class="fd-drawer">
        <header class="fd-head">
          <div></div>
          <button class="fd-close" @click="close" aria-label="关闭">
            <X :size="18" />
          </button>
        </header>
        <FormulaDrawerContent :formula-id="formulaId" :graph="graph" :market="market" />
      </aside>
    </div>
  </Transition>
</template>

<style>
.fd-overlay { position: fixed; inset: 0; z-index: 100; background: rgba(0,0,0,0.32); display: flex; justify-content: flex-end; }
.fd-drawer { width: min(420px, 92vw); height: 100%; overflow-y: auto; background: var(--panel); border-left: 1px solid var(--line); padding: 16px 18px; display: grid; gap: 12px; align-content: start; }
.fd-head { display: flex; justify-content: space-between; align-items: flex-start; }
.fd-close { width: 28px; height: 28px; display: grid; place-items: center; border: 1px solid var(--line); border-radius: 999px; background: var(--bg); color: var(--ink); cursor: pointer; }
.fd-close:hover { border-color: var(--green); color: var(--green); }
.drawer-enter-active, .drawer-leave-active { transition: opacity 0.18s; }
.drawer-enter-active .fd-drawer, .drawer-leave-active .fd-drawer { transition: transform 0.22s ease; }
.drawer-enter-from, .drawer-leave-to { opacity: 0; }
.drawer-enter-from .fd-drawer, .drawer-leave-to .fd-drawer { transform: translateX(100%); }
</style>
```

- [ ] **Step 6.3：跑测试**

```bash
npm test
```

Expected: 仍 PASS。

---

### Task 7：新建 `ChartFabs.vue`

**Files:**
- Create: `src/components/ChartFabs.vue`

- [ ] **Step 7.1：实现**

`src/components/ChartFabs.vue`：

```vue
<script setup>
defineProps({
  activeDrawer: { type: String, default: null },
})

defineEmits(['open'])

const FABS = [
  { id: 'decision', icon: '💡', label: '决策' },
  { id: 'compute',  icon: '📊', label: '计算' },
  { id: 'settings', icon: '⚙️', label: '设置' },
]
</script>

<template>
  <div class="chart-fabs">
    <button
      v-for="f in FABS"
      :key="f.id"
      type="button"
      :class="{ active: activeDrawer === f.id }"
      :title="f.label"
      @click="$emit('open', f.id)"
    >
      <span class="fab-icon">{{ f.icon }}</span>
      <span class="fab-label">{{ f.label }}</span>
    </button>
  </div>
</template>

<style>
.chart-fabs { position: absolute; left: 12px; bottom: 56px; display: grid; gap: 8px; z-index: 20; }
.chart-fabs button { display: grid; grid-template-columns: 22px 1fr; gap: 6px; align-items: center; min-height: 32px; padding: 4px 10px 4px 8px; border: 1px solid var(--line); border-radius: 999px; background: var(--panel); color: var(--ink); font-size: 0.74rem; font-weight: 700; cursor: pointer; box-shadow: 0 2px 6px rgba(0,0,0,0.08); transition: transform 0.1s, border-color 0.1s; }
.chart-fabs button:hover { border-color: var(--green); transform: scale(1.03); }
.chart-fabs button.active { background: var(--surface-active); border-color: var(--green); color: var(--green); }
.fab-icon { font-size: 1rem; line-height: 1; }
.fab-label { line-height: 1; }
</style>
```

> 注：FAB 用文字+图标模式，`bottom: 56px` 给状态栏 chip 留位（chip 浮在 `bottom: 12px`）。

---

### Task 8：新建 `ChartStatusBar.vue` + ChipButton 内联

**Files:**
- Create: `src/components/ChartStatusBar.vue`

- [ ] **Step 8.1：实现**

`src/components/ChartStatusBar.vue`：

```vue
<script setup>
import { computed, nextTick, ref } from 'vue'
import ParamPopover from './ParamPopover.vue'

const props = defineProps({
  input: { type: Object, required: true },
})

const emit = defineEmits(['change'])

const openField = ref(null) // 'entryPrice' | 'iv' | 'holdingDays' | 'targetReturn' | null
const popoverWrapper = ref(null)

const FIELDS = [
  { id: 'entryPrice',   label: '入场价', format: (v) => Number.isFinite(v) ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(v) : '—' },
  { id: 'iv',           label: 'IV',     format: (v) => Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '—' },
  { id: 'holdingDays',  label: '窗口',   format: (v) => Number.isFinite(v) ? `${v} 天` : '—' },
  { id: 'targetReturn', label: '目标',   format: (v) => Number.isFinite(v) ? `${(v * 100).toFixed(0)}%` : '—' },
]

function open(field) {
  openField.value = field
  // 下次微任务再绑外点击监听，避免捕获本次 click
  nextTick(() => {
    document.addEventListener('mousedown', onOutside)
  })
}

function close() {
  openField.value = null
  document.removeEventListener('mousedown', onOutside)
}

function onOutside(e) {
  if (popoverWrapper.value && !popoverWrapper.value.contains(e.target)) {
    close()
  }
}

function onConfirm(value) {
  emit('change', openField.value, value)
  close()
}

const currentValue = computed(() => openField.value ? props.input[openField.value] : 0)
</script>

<template>
  <div class="chart-status-bar">
    <button
      v-for="f in FIELDS"
      :key="f.id"
      type="button"
      :class="['csb-chip', { open: openField === f.id }]"
      @click="open(f.id)"
    >
      <span class="csb-label">{{ f.label }}</span>
      <strong>{{ f.format(input[f.id]) }}</strong>
      <span class="csb-arrow">▾</span>
    </button>

    <div v-if="openField" ref="popoverWrapper" class="csb-popover-wrap">
      <ParamPopover
        :field="openField"
        :value="currentValue"
        @confirm="onConfirm"
        @cancel="close"
      />
    </div>
  </div>
</template>

<style>
.chart-status-bar { position: absolute; left: 12px; bottom: 12px; display: flex; gap: 6px; z-index: 18; flex-wrap: wrap; }
.csb-chip { display: inline-flex; gap: 4px; align-items: baseline; min-height: 28px; padding: 3px 9px; border: 1px solid var(--line); border-radius: 999px; background: rgba(255,255,255,0.84); backdrop-filter: blur(4px); color: var(--ink); cursor: pointer; font-size: 0.74rem; }
.dark .csb-chip { background: rgba(34,36,31,0.84); }
.csb-chip:hover { border-color: var(--green); }
.csb-chip.open { border-color: var(--green); background: var(--surface-active); }
.csb-label { color: var(--muted); font-size: 0.62rem; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase; }
.csb-chip strong { font-variant-numeric: tabular-nums; font-weight: 700; }
.csb-arrow { color: var(--muted); font-size: 0.62rem; }
.csb-popover-wrap { position: absolute; bottom: 38px; left: 0; }
</style>
```

> 注：popover 简化定位为 chip-bar 上方，不做精准 anchor 跟踪。

---

### Task 9：新建 `DrawerHost.vue`（壳）

**Files:**
- Create: `src/components/DrawerHost.vue`

> 此任务只做壳 + 关闭交互，3 个抽屉子组件在 PR-D 实现，先用 v-if 占位 `<div>todo</div>`，PR-D 替换为真正的子组件。

- [ ] **Step 9.1：实现**

`src/components/DrawerHost.vue`：

```vue
<script setup>
import { onBeforeUnmount, watch } from 'vue'
import { X } from 'lucide-vue-next'

const props = defineProps({
  activeDrawer: { type: String, default: null },
})

const emit = defineEmits(['close'])

const TITLES = {
  decision: '今日决策',
  compute:  '计算过程',
  settings: '设置',
}

function onKeydown(e) {
  if (e.key === 'Escape' && props.activeDrawer) {
    emit('close')
  }
}

watch(() => props.activeDrawer, (next) => {
  if (next) {
    document.addEventListener('keydown', onKeydown)
  } else {
    document.removeEventListener('keydown', onKeydown)
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="dh-slide">
      <div v-if="activeDrawer" class="dh-overlay" @click.self="$emit('close')">
        <aside class="dh-panel" :data-name="activeDrawer">
          <header class="dh-head">
            <h2>{{ TITLES[activeDrawer] || activeDrawer }}</h2>
            <button class="dh-close" @click="$emit('close')" aria-label="关闭">
              <X :size="18" />
            </button>
          </header>
          <div class="dh-body">
            <!-- v3 第二阶段：实际内容由父组件通过具名 slot 传入 -->
            <slot :name="activeDrawer">
              <div class="dh-placeholder">{{ activeDrawer }} 抽屉内容待接线</div>
            </slot>
          </div>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<style>
.dh-overlay { position: fixed; inset: 0; z-index: 30; background: rgba(0,0,0,0.18); display: flex; justify-content: flex-end; }
.dh-panel { width: min(480px, 90vw); height: 100%; overflow: hidden; background: var(--panel); border-left: 1px solid var(--line); display: flex; flex-direction: column; }
.dh-head { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid var(--line); flex-shrink: 0; }
.dh-head h2 { margin: 0; font-size: 1rem; font-weight: 800; }
.dh-close { width: 30px; height: 30px; display: grid; place-items: center; border: 1px solid var(--line); border-radius: 999px; background: var(--bg); color: var(--ink); cursor: pointer; }
.dh-close:hover { border-color: var(--green); color: var(--green); }
.dh-body { flex: 1; overflow-y: auto; padding: 14px 16px; }
.dh-placeholder { color: var(--muted); font-size: 0.85rem; padding: 20px; text-align: center; border: 1px dashed var(--line); border-radius: 6px; }

.dh-slide-enter-active, .dh-slide-leave-active { transition: opacity 0.18s; }
.dh-slide-enter-active .dh-panel, .dh-slide-leave-active .dh-panel { transition: transform 0.22s ease; }
.dh-slide-enter-from, .dh-slide-leave-to { opacity: 0; }
.dh-slide-enter-from .dh-panel, .dh-slide-leave-to .dh-panel { transform: translateX(100%); }
</style>
```

- [ ] **Step 9.2：跑测试 + verify**

```bash
npm test && npm run verify:domain
```

Expected: 仍 PASS。PR-B 收尾。

> **预期已知问题**：App.vue 还在引用 `lab.activeMode` / `lab.activeCapability` / `lab.selectCapability`，运行时会 console warn，但 store 已不再返回这些字段。`npm run dev` 现在跑会有运行时 warn（template 引用 undefined）。**不要在 PR-B 修 App.vue**——PR-C 整体重写。

---

## PR-C：App.vue 重写 + TopBar + MainChart + ProfileChip

### Task 10：新建 `ProfileChip.vue`

**Files:**
- Create: `src/components/ProfileChip.vue`

- [ ] **Step 10.1：实现**

`src/components/ProfileChip.vue`：

```vue
<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'

const props = defineProps({
  profileId: { type: String, required: true },
  autoProfile: { type: Boolean, required: true },
  profileList: { type: Array, required: true },
  recommendedId: { type: String, default: 'balanced' },
})

const emit = defineEmits(['set', 'set-auto'])

const open = ref(false)
const wrapper = ref(null)

const TONES = {
  conservative: 'tone-blue',
  balanced:     'tone-green',
  aggressive:   'tone-orange',
}

const activeLabel = computed(() => {
  const id = props.autoProfile ? props.recommendedId : props.profileId
  return props.profileList.find(p => p.id === id)?.label ?? '均衡'
})

const tone = computed(() => {
  if (props.autoProfile) return 'tone-neutral'
  return TONES[props.profileId] ?? 'tone-neutral'
})

function toggle() {
  open.value = !open.value
  if (open.value) {
    setTimeout(() => document.addEventListener('mousedown', onOutside), 0)
  }
}

function close() {
  open.value = false
  document.removeEventListener('mousedown', onOutside)
}

function onOutside(e) {
  if (wrapper.value && !wrapper.value.contains(e.target)) close()
}

function setAuto() { emit('set-auto', true); close() }
function set(id) { emit('set', id); close() }

onBeforeUnmount(() => document.removeEventListener('mousedown', onOutside))
</script>

<template>
  <div ref="wrapper" :class="['profile-chip', tone]">
    <button type="button" class="pc-trigger" @click="toggle">
      <span class="pc-dot" />
      {{ autoProfile ? `自动 · ${activeLabel}` : activeLabel }}
      <span class="pc-arrow">▾</span>
    </button>
    <ul v-if="open" class="pc-menu">
      <li :class="{ active: autoProfile }" @click="setAuto">
        <span class="pc-dot tone-neutral" />
        自动（按回测推荐）
      </li>
      <li
        v-for="p in profileList"
        :key="p.id"
        :class="['pc-item', `tone-${p.id === 'conservative' ? 'blue' : p.id === 'balanced' ? 'green' : 'orange'}`, { active: !autoProfile && profileId === p.id }]"
        @click="set(p.id)"
      >
        <span class="pc-dot" />
        {{ p.label }}
      </li>
    </ul>
  </div>
</template>

<style>
.profile-chip { position: relative; }
.pc-trigger { display: inline-flex; gap: 5px; align-items: center; min-height: 28px; padding: 3px 10px; border: 1px solid var(--line); border-radius: 999px; background: var(--bg); color: var(--ink); cursor: pointer; font-size: 0.74rem; font-weight: 700; }
.pc-trigger:hover { border-color: var(--green); }
.pc-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); display: inline-block; }
.tone-blue .pc-dot, .pc-item.tone-blue .pc-dot { background: #1f5fbf; }
.tone-green .pc-dot, .pc-item.tone-green .pc-dot { background: #0e7558; }
.tone-orange .pc-dot, .pc-item.tone-orange .pc-dot { background: #b8860b; }
.tone-neutral .pc-dot { background: var(--muted); }
.tone-blue .pc-trigger { border-color: #1f5fbf; }
.tone-green .pc-trigger { border-color: #0e7558; }
.tone-orange .pc-trigger { border-color: #b8860b; }
.pc-arrow { color: var(--muted); font-size: 0.62rem; }
.pc-menu { position: absolute; top: 32px; right: 0; min-width: 160px; padding: 4px; margin: 0; list-style: none; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; box-shadow: 0 6px 18px rgba(0,0,0,0.12); z-index: 25; }
.pc-menu li { display: flex; gap: 6px; align-items: center; padding: 5px 9px; border-radius: 5px; cursor: pointer; font-size: 0.78rem; }
.pc-menu li:hover { background: var(--surface-alt); }
.pc-menu li.active { background: var(--surface-active); font-weight: 700; }
</style>
```

---

### Task 11：新建 `TopBar.vue`

**Files:**
- Create: `src/components/TopBar.vue`

- [ ] **Step 11.1：实现**

`src/components/TopBar.vue`：

```vue
<script setup>
import { computed, ref } from 'vue'
import { Database, Moon, Sun } from 'lucide-vue-next'
import { summarizeRegime } from '../domain/decision/narrative.js'
import { deriveWindows } from '../domain/market/cost.js'
import ProfileChip from './ProfileChip.vue'

const props = defineProps({
  source: { type: Object, default: null },
  market: { type: Object, default: null },
  rows: { type: Array, default: () => [] },
  decision: { type: Object, default: null },
  confidence: { type: Number, default: 0 },
  profileId: { type: String, required: true },
  autoProfile: { type: Boolean, required: true },
  profileList: { type: Array, required: true },
  recommendedId: { type: String, default: 'balanced' },
  theme: { type: String, default: 'light' },
  samples: { type: Array, required: true },
  loadingSampleId: { type: String, default: '' },
})

const emit = defineEmits([
  'select-sample',
  'set-profile',
  'set-auto-profile',
  'toggle-theme',
  'reset',
])

const tickerSearch = ref('')
const searchInput = ref(null)

const filteredSamples = computed(() => {
  const q = tickerSearch.value.trim().toLowerCase()
  if (!q) return props.samples
  return props.samples.filter(s =>
    s.symbol.toLowerCase().includes(q) || s.label.toLowerCase().includes(q)
  )
})

function onSearchEnter() {
  if (filteredSamples.value.length) emit('select-sample', filteredSamples.value[0])
}

const dailyChange = computed(() => {
  const r = props.rows
  if (r.length < 2) return null
  const last = r.at(-1).close
  const prev = r.at(-2).close
  if (!Number.isFinite(last) || !Number.isFinite(prev) || prev <= 0) return null
  return (last - prev) / prev
})

const narrativeText = computed(() => {
  const m = props.market
  if (!m) return '载入 K 线后判断'
  const window = props.rows.length ? deriveWindows(props.rows.length).cost : 60
  return summarizeRegime({
    markPrice: m.markPrice,
    costAnchor: m.costAnchor,
    costDistance: m.costDistance,
    costWindow: window,
  })
})

const recommendation = computed(() => {
  const d = props.decision
  if (!d) return null
  return d.state || null
})

function money(v) { return Number.isFinite(v) ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(v) : '—' }
function pctSign(v) {
  if (!Number.isFinite(v)) return '—'
  const sign = v >= 0 ? '+' : ''
  return `${sign}${(v * 100).toFixed(2)}%`
}
</script>

<template>
  <header class="topbar">
    <div class="tb-brand">
      <span>Market Lab</span>
      <h1>公式工作台</h1>
    </div>

    <div class="tb-search">
      <input
        ref="searchInput"
        v-model="tickerSearch"
        type="search"
        placeholder="搜代码/名称…"
        list="ticker-list"
        @keydown.enter="onSearchEnter"
      />
      <datalist id="ticker-list">
        <option v-for="s in samples" :key="s.id" :value="s.symbol" />
      </datalist>
    </div>

    <div v-if="market" class="tb-summary">
      <div class="tb-segment tb-price">
        <strong>{{ money(market.markPrice) }}</strong>
        <em :class="{ up: (dailyChange ?? 0) >= 0, down: (dailyChange ?? 0) < 0 }">{{ pctSign(dailyChange) }}</em>
      </div>
      <div class="tb-segment tb-narrative" :title="narrativeText">{{ narrativeText }}</div>
      <div v-if="recommendation" class="tb-segment tb-action">
        <span>推荐</span>
        <strong>{{ recommendation }}</strong>
        <em>{{ Math.round(confidence * 100) }}%</em>
      </div>
    </div>

    <div class="tb-actions">
      <ProfileChip
        :profile-id="profileId"
        :auto-profile="autoProfile"
        :profile-list="profileList"
        :recommended-id="recommendedId"
        @set="(id) => emit('set-profile', id)"
        @set-auto="(v) => emit('set-auto-profile', v)"
      />
      <button class="tb-theme" type="button" @click="$emit('toggle-theme')" title="切换主题">
        <Moon v-if="theme === 'light'" :size="14" />
        <Sun v-else :size="14" />
      </button>
      <button class="tb-reset" type="button" @click="$emit('reset')" title="清空持久化参数">重置</button>
    </div>
  </header>
</template>

<style>
.topbar { display: grid; grid-template-columns: auto auto 1fr auto; gap: 14px; align-items: center; padding: 7px 14px; background: var(--panel); border-bottom: 1px solid var(--line); flex-shrink: 0; }
.tb-brand { display: flex; flex-direction: column; gap: 1px; }
.tb-brand span { color: var(--green); font-size: 0.6rem; font-weight: 900; letter-spacing: 0.07em; text-transform: uppercase; }
.tb-brand h1 { margin: 0; font-size: 0.96rem; line-height: 1; }
.tb-search input { width: 200px; min-height: 28px; padding: 3px 8px; border: 1px solid var(--line); border-radius: 5px; background: var(--bg); color: var(--ink); font-size: 0.74rem; }
.tb-summary { display: flex; gap: 14px; align-items: center; min-width: 0; }
.tb-segment { display: inline-flex; gap: 5px; align-items: baseline; padding: 0 10px; border-left: 1px solid var(--line); white-space: nowrap; }
.tb-segment:first-child { border-left: none; padding-left: 0; }
.tb-price strong { font-size: 1rem; font-variant-numeric: tabular-nums; font-weight: 800; }
.tb-price em { font-style: normal; font-size: 0.78rem; font-weight: 700; }
.tb-price em.up { color: var(--green); }
.tb-price em.down { color: var(--red); }
.tb-narrative { color: var(--ink); font-size: 0.85rem; line-height: 1.3; max-width: 360px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tb-action span { color: var(--muted); font-size: 0.6rem; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase; }
.tb-action strong { font-size: 0.86rem; font-weight: 800; }
.tb-action em { font-style: normal; color: var(--muted); font-size: 0.7rem; font-variant-numeric: tabular-nums; }
.tb-actions { display: flex; gap: 6px; align-items: center; }
.tb-theme { min-width: 28px; min-height: 28px; display: grid; place-items: center; border: 1px solid var(--line); border-radius: 999px; background: var(--bg); color: var(--ink); cursor: pointer; }
.tb-theme:hover { border-color: var(--green); }
.tb-reset { min-height: 26px; padding: 1px 9px; border: 1px solid var(--line); border-radius: 4px; background: var(--bg); color: var(--ink); font-size: 0.66rem; cursor: pointer; opacity: 0.7; }
.tb-reset:hover { opacity: 1; border-color: var(--green); }

@media (max-width: 1100px) {
  .tb-summary .tb-action { display: none; }
}
@media (max-width: 800px) {
  .tb-summary .tb-narrative { display: none; }
  .tb-search input { width: 140px; }
}
</style>
```

---

### Task 12：把 `MarketChart.vue` 重命名 + 扩 overlays / FAB / 状态栏

**Files:**
- Create: `src/components/MainChart.vue`（来自 MarketChart.vue 复制 + 扩）
- 保留：`src/components/MarketChart.vue`（暂时不删，PR-D 删）

设计：先把现 MarketChart.vue **复制**为 MainChart.vue 然后扩展，让 PR-C 期间两者并存（App.vue 可以单点切换）。原文件在 PR-D 任务 17 删除。

- [ ] **Step 12.1：复制 MarketChart.vue 到 MainChart.vue**

```bash
cp src/components/MarketChart.vue src/components/MainChart.vue
```

- [ ] **Step 12.2：改 MainChart.vue**

替换 `src/components/MainChart.vue` 整个文件为：

```vue
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
import ChartFabs from './ChartFabs.vue'
import ChartStatusBar from './ChartStatusBar.vue'

const props = defineProps({
  rows: { type: Array, required: true },
  costPath: { type: Array, required: true },
  formulaPath: { type: Array, required: true },
  entryPrice: { type: Number, required: true },
  replay: { type: Object, required: true },
  market: { type: Object, default: null },
  decision: { type: Object, default: null },
  overlays: { type: Object, required: true },
  input: { type: Object, required: true },
  activeDrawer: { type: String, default: null },
})

const emit = defineEmits(['cursor-change', 'param-change', 'open-drawer'])

const el = ref(null)
const hoverIndex = ref(null)
let chart = null
let markersApi = null
let themeObserver = null
const series = {}        // 当前已挂载的 series 实例
let resizeObserver = null

onMounted(() => {
  chart = createChart(el.value, chartOptions())
  applyOverlays()
  syncChart()
  chart.subscribeCrosshairMove(handleCrosshair)
  resizeObserver = new ResizeObserver(() => resize())
  resizeObserver.observe(el.value)
  themeObserver = new MutationObserver(() => syncChart())
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  themeObserver?.disconnect()
  chart?.unsubscribeCrosshairMove(handleCrosshair)
  chart?.remove()
})

watch(() => [props.rows, props.costPath, props.formulaPath, props.entryPrice, props.replay, props.decision], syncChart, { deep: true })
watch(() => ({ ...props.overlays }), () => {
  applyOverlays()
  syncChart()
}, { deep: true })

function applyOverlays() {
  if (!chart) return
  const o = props.overlays
  // 蜡烛 + 量始终存在；用 visibility 控制其它项
  ensure('candle', () => chart.addSeries(CandlestickSeries, {
    upColor: '#0e7558', downColor: '#a93226',
    borderVisible: false,
    wickUpColor: '#0e7558', wickDownColor: '#a93226',
    priceLineVisible: false,
  }))
  toggle('cost', o.costBand, () => addLine('成本锚', '#0e7558', 2))
  toggle('costUpper', o.costBand, () => addLine('成本上沿', '#8b5a16', 1, LineStyle.Dashed))
  toggle('costLower', o.costBand, () => addLine('成本下沿', '#274f9f', 1, LineStyle.Dashed))
  toggle('deltaUpper', o.volBand, () => addLine('波动带上沿', '#9a4f00', 1, LineStyle.Dotted))
  toggle('deltaLower', o.volBand, () => addLine('波动带下沿', '#1f5fbf', 1, LineStyle.Dotted))
  toggle('entry', o.entryLine, () => addLine('入场', '#b3261e', 1, LineStyle.Dotted))
  toggle('volume', o.volume, () => chart.addSeries(HistogramSeries, {
    priceFormat: { type: 'volume' }, priceScaleId: '', color: '#b7c1d8',
  }, 1))
  toggle('regime', o.volume, () => chart.addSeries(HistogramSeries, {
    priceFormat: { type: 'volume' }, priceScaleId: '',
  }, 1))
  toggle('bsDelta', o.deltaPane, () => chart.addSeries(LineSeries, deltaLine('期权 Δ', '#a93226'), 2))
  toggle('lpDelta', o.deltaPane, () => chart.addSeries(LineSeries, deltaLine('LP Δ', '#0e7558'), 2))
  toggle('zero', o.deltaPane, () => chart.addSeries(LineSeries, deltaLine('Δ=0', '#888', LineStyle.Dashed), 2))
  toggle('equity', o.equityPane, () => chart.addSeries(LineSeries, {
    title: '回放权益', color: '#1f5fbf', lineWidth: 2,
    priceLineVisible: false, lastValueVisible: true,
    priceFormat: { type: 'price', precision: 0, minMove: 1 },
  }, 3))
  toggle('equityZero', o.equityPane, () => chart.addSeries(LineSeries, {
    title: '盈亏=0', color: '#888', lineWidth: 1, lineStyle: LineStyle.Dashed,
    priceLineVisible: false, lastValueVisible: false,
  }, 3))
  if (!markersApi) markersApi = createSeriesMarkers(series.candle, [])
  rebalancePanes()
}

function ensure(key, factory) {
  if (!series[key]) series[key] = factory()
}
function toggle(key, on, factory) {
  if (on && !series[key]) {
    series[key] = factory()
  } else if (!on && series[key]) {
    chart.removeSeries(series[key])
    delete series[key]
  }
}

function rebalancePanes() {
  // pane 0: 主图 / pane 1: 成交量 / pane 2: Δ / pane 3: 权益
  const panes = chart.panes()
  if (!panes.length) return
  // 简化策略：开启 Δ/权益时给它们空间；都关时主图最大化
  const o = props.overlays
  panes[0]?.setStretchFactor(0.62)
  if (panes[1]) panes[1].setStretchFactor(o.volume ? 0.10 : 0)
  if (panes[2]) panes[2].setStretchFactor(o.deltaPane ? 0.16 : 0)
  if (panes[3]) panes[3].setStretchFactor(o.equityPane ? 0.12 : 0)
}

function syncChart() {
  if (!chart || !series.candle) return
  const dark = document.documentElement.classList.contains('dark')
  chart.applyOptions({
    layout: {
      background: { type: ColorType.Solid, color: dark ? '#22241f' : '#fbfaf4' },
      textColor: dark ? '#96958b' : '#57554d',
    },
    grid: {
      vertLines: { color: dark ? 'rgba(61,60,52,0.45)' : 'rgba(215,209,194,0.45)' },
      horzLines: { color: dark ? 'rgba(61,60,52,0.72)' : 'rgba(215,209,194,0.72)' },
    },
    rightPriceScale: { borderColor: dark ? '#3d3c34' : '#d7d1c2' },
    timeScale: { borderColor: dark ? '#3d3c34' : '#d7d1c2' },
  })
  series.candle.setData(props.rows.map((row) => ({
    time: row.date, open: row.open, high: row.high, low: row.low, close: row.close,
  })))
  if (series.cost)       setLine(series.cost,       props.costPath.map((r) => r.anchor))
  if (series.costUpper)  setLine(series.costUpper,  props.costPath.map((r) => r.upper))
  if (series.costLower)  setLine(series.costLower,  props.costPath.map((r) => r.lower))
  if (series.deltaUpper) setLine(series.deltaUpper, props.formulaPath.map((r) => r.deltaUpper))
  if (series.deltaLower) setLine(series.deltaLower, props.formulaPath.map((r) => r.deltaLower))
  if (series.entry)      setLine(series.entry,      props.rows.map(() => props.entryPrice))
  if (series.volume) {
    series.volume.setData(props.rows.map((row) => ({
      time: row.date, value: row.volume,
      color: row.close >= row.open ? 'rgba(14,117,88,0.38)' : 'rgba(169,50,38,0.38)',
    })))
  }
  if (series.regime) {
    series.regime.setData(props.rows.map((row, i) => {
      const cost = props.costPath[i]
      const zone = cost ? regimeColor(row.close, cost) : null
      return zone ? { time: row.date, value: 1, color: zone } : { time: row.date, value: 0 }
    }))
  }
  if (series.bsDelta) setLine(series.bsDelta, props.formulaPath.map((r) => r.optionDelta))
  if (series.lpDelta) setLine(series.lpDelta, props.formulaPath.map((r) => r.lpInventoryDelta))
  if (series.zero)    setLine(series.zero,    props.rows.map(() => 0))
  if (series.equity) {
    const equityByDate = new Map((props.replay?.equityCurve ?? []).map((p) => [p.date, p.equity]))
    series.equity.setData(props.rows
      .map((row) => ({ time: row.date, value: equityByDate.has(row.date) ? equityByDate.get(row.date) : null }))
      .filter((p) => p.value !== null))
  }
  if (series.equityZero) {
    series.equityZero.setData(props.rows.map((row) => ({ time: row.date, value: 0 })))
  }
  // markers：replay trades + 当前决策点
  if (markersApi) markersApi.setMarkers(buildMarkers())
  chart.timeScale().fitContent()
}

function buildMarkers() {
  const out = []
  if (props.overlays.replayMarkers) {
    out.push(...buildReplayMarkers(props.replay?.trades ?? []))
  }
  if (props.overlays.currentDecision && props.rows.length && props.decision) {
    const last = props.rows.at(-1)
    const side = props.decision.timing?.side
    out.push({
      time: last.date,
      position: side === 'sell' ? 'aboveBar' : 'belowBar',
      shape: side === 'buy' ? 'arrowUp' : side === 'sell' ? 'arrowDown' : 'circle',
      color: side === 'buy' ? '#0e7558' : side === 'sell' ? '#a93226' : '#888',
      text: props.decision.state || '',
      id: 'current-decision',
    })
  }
  return out.sort((a, b) => a.time < b.time ? -1 : a.time > b.time ? 1 : 0)
}

function buildReplayMarkers(trades) {
  return trades.flatMap((trade, i) => {
    const isBuy = trade.side === 'buy'
    if (trade.fillDate === trade.exitDate) {
      return [{
        time: trade.fillDate,
        position: isBuy ? 'belowBar' : 'aboveBar',
        shape: isBuy ? 'arrowUp' : 'arrowDown',
        color: isBuy ? '#0e7558' : '#a93226',
        text: `${trade.reason} ${isBuy ? '@' + money(trade.fillPrice) : signedMoney(trade.pnl)}`,
        id: `event-${i}`,
      }]
    }
    return [
      { time: trade.fillDate, position: isBuy ? 'belowBar' : 'aboveBar', shape: isBuy ? 'arrowUp' : 'arrowDown', color: isBuy ? '#0e7558' : '#a93226', text: `${isBuy ? '+' : '-'} ${money(trade.fillPrice)}`, id: `fill-${i}` },
      { time: trade.exitDate, position: trade.pnl >= 0 ? 'aboveBar' : 'belowBar', shape: 'circle', color: trade.pnl >= 0 ? '#0e7558' : '#a93226', text: `${trade.reason} ${signedMoney(trade.pnl)}`, id: `exit-${i}` },
    ]
  })
}

function addLine(title, color, width, style = LineStyle.Solid) {
  return chart.addSeries(LineSeries, {
    title, color, lineWidth: width, lineStyle: style,
    priceLineVisible: false, lastValueVisible: true,
  })
}

function deltaLine(title, color, style = LineStyle.Solid) {
  return {
    title, color, lineWidth: 1, lineStyle: style,
    priceLineVisible: false, lastValueVisible: false,
    priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
  }
}

function setLine(lineSeries, values) {
  lineSeries.setData(props.rows.map((row, i) => ({
    time: row.date, value: finiteOrNull(values[i]),
  })).filter((p) => p.value !== null))
}

function handleCrosshair(param) {
  if (!param?.time) {
    hoverIndex.value = null
    return
  }
  const idx = props.rows.findIndex((r) => r.date === param.time)
  hoverIndex.value = idx >= 0 ? idx : null
  emit('cursor-change', hoverIndex.value)
}

function resize() {
  if (!chart || !el.value) return
  chart.resize(el.value.clientWidth, el.value.clientHeight)
}

function chartOptions() {
  const dark = document.documentElement.classList.contains('dark')
  return {
    autoSize: false,
    layout: {
      background: { type: ColorType.Solid, color: dark ? '#22241f' : '#fbfaf4' },
      textColor: dark ? '#96958b' : '#57554d',
      fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    },
    grid: {
      vertLines: { color: dark ? 'rgba(61,60,52,0.45)' : 'rgba(215,209,194,0.45)' },
      horzLines: { color: dark ? 'rgba(61,60,52,0.72)' : 'rgba(215,209,194,0.72)' },
    },
    crosshair: { mode: CrosshairMode.Normal },
    width: el.value?.clientWidth ?? 800,
    height: el.value?.clientHeight ?? 620,
    rightPriceScale: { borderColor: dark ? '#3d3c34' : '#d7d1c2', scaleMargins: { top: 0.08, bottom: 0.12 } },
    timeScale: { borderColor: dark ? '#3d3c34' : '#d7d1c2', rightOffset: 8, barSpacing: 7 },
  }
}

function regimeColor(close, cost) {
  if (!Number.isFinite(close) || !Number.isFinite(cost?.upper) || !Number.isFinite(cost?.lower)) return null
  if (close > cost.upper) return 'rgba(169,50,38,0.45)'
  if (close < cost.lower) return 'rgba(39,79,159,0.45)'
  return 'rgba(14,117,88,0.35)'
}

function finiteOrNull(value) { return Number.isFinite(value) ? value : null }
function money(v) { return Number.isFinite(v) ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(v) : '无' }
function signedMoney(v) { return Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${money(v)}` : '无' }
</script>

<template>
  <div class="main-chart-shell">
    <div ref="el" class="main-chart-canvas" />
    <ChartStatusBar :input="input" @change="(field, v) => emit('param-change', field, v)" />
    <ChartFabs :active-drawer="activeDrawer" @open="(name) => emit('open-drawer', name)" />
  </div>
</template>

<style>
.main-chart-shell { position: relative; width: 100%; height: 100%; min-height: 0; overflow: hidden; }
.main-chart-canvas { width: 100%; height: 100%; }
</style>
```

> 注：syncChart 中所有原 series 操作都加了 `if (series.X)` 守卫，因为 overlays 关掉时 series 已被销毁。

- [ ] **Step 12.3：跑测试**

```bash
npm test
```

Expected: 仍 PASS。MainChart.vue 自身没有 vitest 单测（DOM 渲染依赖 lightweight-charts，单测意义不大），手动 dev 时验证。

---

### Task 13：重写 `App.vue`

**Files:**
- Modify: `src/App.vue`（完全重写）

- [ ] **Step 13.1：写新 App.vue**

`src/App.vue` 整体替换为：

```vue
<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { Activity } from 'lucide-vue-next'
import TopBar from './components/TopBar.vue'
import MainChart from './components/MainChart.vue'
import DrawerHost from './components/DrawerHost.vue'
import { useLabStore } from './stores/labStore.js'
import { clearPersistedLab, persistedRef } from './composables/usePersisted.js'
import stockIndex from './data/stock-index.json'

const lab = useLabStore()

// 主题持久化
const theme = persistedRef('lab.theme.v1', 'light')
function applyTheme(t) {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('dark', t === 'dark')
}
applyTheme(theme.value)
watch(theme, applyTheme)
function toggleTheme() { theme.value = theme.value === 'dark' ? 'light' : 'dark' }

function resetWorkbench() {
  if (!confirm('清空所有持久化参数（输入、UI 状态、主题）并刷新？')) return
  clearPersistedLab()
  window.location.reload()
}

// 合并 marketSamples + stockIndex 给搜索
const allSamples = computed(() => {
  const curated = new Map(lab.marketSamples.map(s => [s.symbol, s]))
  for (const s of stockIndex) {
    if (!curated.has(s.symbol)) curated.set(s.symbol, s)
  }
  return [...curated.values()]
})

// 决策摘要派生
const briefConfidence = computed(() => lab.graph?.decision?.confidence ?? 0)

function onParamChange(field, value) {
  if (lab.input && field in lab.input) {
    lab.input[field] = value
  }
}

function onSetProfile(id) {
  lab.input.autoProfile = false
  lab.input.strategyProfile = id
}
function onSetAutoProfile(v) {
  lab.input.autoProfile = v
}
</script>

<template>
  <div class="app-root">
    <TopBar
      :source="lab.source"
      :market="lab.market"
      :rows="lab.rows"
      :decision="lab.graph?.decision"
      :confidence="briefConfidence"
      :profile-id="lab.input.strategyProfile"
      :auto-profile="lab.input.autoProfile"
      :profile-list="lab.strategyProfileList"
      :recommended-id="lab.recommendedProfile?.id ?? 'balanced'"
      :theme="theme"
      :samples="allSamples"
      :loading-sample-id="lab.loadingSampleId"
      @select-sample="lab.loadSample"
      @set-profile="onSetProfile"
      @set-auto-profile="onSetAutoProfile"
      @toggle-theme="toggleTheme"
      @reset="resetWorkbench"
    />

    <p v-if="lab.error" class="err-bar" :class="`kind-${lab.error.kind}`">
      <span class="err-msg">{{ lab.error.message }}</span>
      <button v-if="lab.error.sample" class="err-btn" @click="lab.retryLast()" :disabled="lab.loading">
        {{ lab.loading ? '重试中…' : '重试' }}
      </button>
      <button class="err-btn err-dismiss" @click="lab.dismissError()">关闭</button>
    </p>

    <main class="app-main">
      <MainChart
        v-if="lab.rows.length"
        :rows="lab.rows"
        :cost-path="lab.costPath"
        :formula-path="lab.formulaPath"
        :entry-price="lab.input.entryPrice"
        :replay="lab.replay"
        :market="lab.market"
        :decision="lab.graph?.decision"
        :overlays="lab.chartOverlays"
        :input="lab.input"
        :active-drawer="lab.activeDrawer"
        @cursor-change="(idx) => { if (idx !== null) lab.cursor = idx }"
        @param-change="onParamChange"
        @open-drawer="(name) => lab.openDrawer(lab.activeDrawer === name ? null : name)"
      />
      <div v-else class="empty-state">
        <Activity :size="36" />
        <strong>Market Lab</strong>
        <small v-if="lab.loading">加载中…{{ lab.loadingSampleId ? ' ' + lab.loadingSampleId : '' }}</small>
        <small v-else>顶栏搜索框选品种加载（首次约 1~2 秒）</small>
      </div>
    </main>

    <DrawerHost :active-drawer="lab.activeDrawer" @close="lab.closeDrawer">
      <template #decision>
        <div class="dh-todo">决策抽屉内容（PR-D Task 14 接线）</div>
      </template>
      <template #compute>
        <div class="dh-todo">计算抽屉内容（PR-D Task 15 接线）</div>
      </template>
      <template #settings>
        <div class="dh-todo">设置抽屉内容（PR-D Task 16 接线）</div>
      </template>
    </DrawerHost>
  </div>
</template>

<style>
.app-root { width: 100vw; height: 100vh; display: flex; flex-direction: column; overflow: hidden; background: var(--bg); color: var(--ink); }
.app-main { flex: 1; min-height: 0; position: relative; overflow: hidden; }

.err-bar { flex-shrink: 0; display: flex; gap: 10px; align-items: center; margin: 0; padding: 5px 12px; background: var(--red); color: #fff; font-size: 0.76rem; }
.err-bar.kind-empty { background: #b8860b; }
.err-bar.kind-parse { background: #884d22; }
.err-bar.kind-network { background: var(--red); }
.err-msg { flex: 1; }
.err-btn { min-height: 22px; padding: 1px 9px; border: 1px solid rgba(255,255,255,0.5); border-radius: 4px; background: transparent; color: #fff; font-size: 0.7rem; font-weight: 800; cursor: pointer; }
.err-btn:hover:not(:disabled) { background: rgba(255,255,255,0.15); }
.err-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.err-dismiss { opacity: 0.8; }

.empty-state { width: 100%; height: 100%; display: grid; place-items: center; align-content: center; gap: 10px; color: var(--muted); }
.empty-state strong { font-size: 1.3rem; color: var(--ink); }

.dh-todo { padding: 14px; color: var(--muted); border: 1px dashed var(--line); border-radius: 6px; font-size: 0.82rem; text-align: center; }
</style>
```

> 注：删除了所有旧 .top-bar / .workbench / .wb-* / .exec-strip / .mode-tabs / .prof-tabs / .wf-* / .cursor-bar / .risk-box / .metric-strip 样式。这些样式仅在旧 App.vue 用过，删了不影响其他组件（每个新组件自己带样式）。

- [ ] **Step 13.2：跑 dev 看效果**

```bash
npm run dev
```

打开 http://localhost:5173/ 验证：

1. TopBar 完整：Logo / 搜索 / 决策摘要（加载数据后）/ ProfileChip / 主题 / 重置 ✓
2. 加载 BTC：MainChart 渲染，K + 成本带 + 入场 + 成交量 + replay markers + 当前决策点 ✓
3. 主图左下三 FAB（💡 决策 / 📊 计算 / ⚙️ 设置）可见
4. 主图底部状态栏 4 chip（入场价 / IV / 窗口 / 目标）
5. 点 chip 弹 popover，改值 + Enter，主图入场价线移动 ✓
6. 点 FAB 抽屉滑入，显示 "PR-D Task XX 接线" 占位
7. ESC / 点遮罩 关闭抽屉 ✓
8. ProfileChip 点击下拉切换 profile 颜色变化 ✓

如有 break 停下报告。

- [ ] **Step 13.3：跑测试 + verify**

```bash
npm test && npm run verify:domain
```

Expected: 现有 55 个测试全过，verify PASS。

PR-C 收尾。**注意**：现在 App.vue 里旧的 QuestionNav / ChainFlow / MetricStrip / DecisionPanel / OrderTable / ReplayPanel / FormulaNav / FormulaChart / FormulaDrawer / AdvancedSettings 都不再被引用，但**文件保留**（PR-D 抽屉接线时用）。

---

## PR-D：抽屉接线 + 验收

### Task 14：新建 `DecisionDrawer.vue`

**Files:**
- Create: `src/components/DecisionDrawer.vue`

- [ ] **Step 14.1：实现**

`src/components/DecisionDrawer.vue`：

```vue
<script setup>
import { computed } from 'vue'
import { summarizeReason } from '../domain/decision/narrative.js'
import OrderTable from './OrderTable.vue'
import ReplayPanel from './ReplayPanel.vue'

const props = defineProps({
  graph: { type: Object, required: true },
  market: { type: Object, default: null },
  replay: { type: Object, required: true },
  profileReplays: { type: Array, default: () => [] },
  activeProfileId: { type: String, default: 'balanced' },
  autoProfile: { type: Boolean, default: false },
  profileList: { type: Array, required: true },
})

const emit = defineEmits(['set-profile', 'set-auto-profile'])

const reasonText = computed(() => {
  const decision = props.graph?.decision
  const market = props.market
  if (!decision || !market) return decision?.path || '载入 K 线后自动分析'
  return summarizeReason({
    state: decision.state,
    costDistance: market.costDistance,
    atrPercent: market.atrPercent,
    side: decision.timing?.side,
  })
})

const ordersTitle = computed(() =>
  props.graph?.decision?.timing?.side === 'sell' ? '底仓减压' : '分批低价买入'
)

function money(v) { return Number.isFinite(v) ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(v) : '—' }
function pct(v) { return Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '—' }
</script>

<template>
  <div class="dd-drawer">
    <section class="dd-section dd-reason">
      <h3 class="dd-h">解读</h3>
      <p class="dd-reason-text">{{ reasonText }}</p>
    </section>

    <section class="dd-section dd-action">
      <h3 class="dd-h">推荐动作</h3>
      <article class="dd-action-card">
        <header>
          <strong>{{ graph?.decision?.state || '等待数据' }}</strong>
          <em>{{ Math.round((graph?.decision?.confidence ?? 0) * 100) }}% 置信</em>
        </header>
        <div class="dd-action-grid">
          <div><span>第一笔</span><strong>{{ money(graph?.position?.firstNotional) }}</strong></div>
          <div><span>挂单价</span><strong>{{ money(graph?.plan?.primaryOrders?.[0]?.price) }}</strong></div>
          <div><span>失效</span><strong>{{ money(graph?.position?.stopPrice) }}</strong></div>
          <div><span>目标</span><strong>{{ money(graph?.position?.targetPrice) }}</strong></div>
          <div><span>风险预算</span><strong>{{ money(graph?.position?.riskBudget) }}</strong></div>
          <div><span>失效距离</span><strong>{{ pct(graph?.position?.stopDistance) }}</strong></div>
        </div>
      </article>
    </section>

    <section class="dd-section">
      <h3 class="dd-h">计划单</h3>
      <OrderTable :title="ordersTitle" :orders="graph?.plan?.primaryOrders ?? []" />
    </section>

    <section class="dd-section">
      <h3 class="dd-h">风险</h3>
      <div class="dd-risk-row">
        <span>失效线</span>
        <strong>{{ money(graph?.plan?.invalidation?.lower) }} / {{ money(graph?.plan?.invalidation?.upper) }}</strong>
      </div>
      <div class="dd-risk-row">
        <span>组合价值</span>
        <strong :class="(graph?.portfolio ?? 0) >= 0 ? 'green' : 'red'">{{ money(graph?.portfolio) }}</strong>
      </div>
    </section>

    <section class="dd-section">
      <h3 class="dd-h">Profile 调优</h3>
      <div class="dd-profile-tabs">
        <button :class="{ active: autoProfile }" @click="emit('set-auto-profile', true)">自动</button>
        <button
          v-for="p in profileList"
          :key="p.id"
          :class="{ active: !autoProfile && activeProfileId === p.id }"
          @click="emit('set-profile', p.id)"
        >{{ p.label }}</button>
      </div>
      <ul class="dd-profile-grid">
        <li v-for="item in profileReplays" :key="item.profile.id" :class="{ active: item.profile.id === activeProfileId }">
          <span>{{ item.profile.label }}</span>
          <strong>{{ pct(item.replay.returnOnUsedNotional) }}</strong>
          <em>回撤 {{ money(item.replay.maxDrawdown) }} · {{ item.replay.tradeCount }} 次</em>
        </li>
      </ul>
    </section>

    <section class="dd-section">
      <h3 class="dd-h">回放历史</h3>
      <ReplayPanel :replay="replay" :profile-replays="profileReplays" :active-profile-id="activeProfileId" />
    </section>
  </div>
</template>

<style>
.dd-drawer { display: grid; gap: 16px; }
.dd-section { display: grid; gap: 8px; padding-bottom: 12px; border-bottom: 1px solid var(--line); }
.dd-section:last-child { border-bottom: none; }
.dd-h { margin: 0; color: var(--green); font-size: 0.66rem; font-weight: 900; letter-spacing: 0.06em; text-transform: uppercase; }
.dd-reason-text { margin: 0; font-size: 0.95rem; line-height: 1.5; color: var(--ink); }
.dd-action-card { padding: 10px 12px; border: 1px solid var(--line); border-radius: 7px; background: var(--surface-alt); }
.dd-action-card header { display: flex; gap: 8px; align-items: baseline; margin-bottom: 8px; }
.dd-action-card header strong { font-size: 1rem; }
.dd-action-card header em { font-style: normal; color: var(--muted); font-size: 0.72rem; padding: 1px 7px; border: 1px solid var(--line); border-radius: 999px; }
.dd-action-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.dd-action-grid div { display: grid; gap: 1px; }
.dd-action-grid span { color: var(--muted); font-size: 0.6rem; font-weight: 800; text-transform: uppercase; }
.dd-action-grid strong { font-size: 0.84rem; font-variant-numeric: tabular-nums; }
.dd-risk-row { display: flex; justify-content: space-between; align-items: baseline; padding: 6px 9px; border: 1px solid var(--line); border-radius: 5px; background: var(--panel); }
.dd-risk-row span { color: var(--muted); font-size: 0.66rem; font-weight: 800; text-transform: uppercase; }
.dd-risk-row strong { font-size: 0.86rem; font-variant-numeric: tabular-nums; }
.dd-risk-row strong.green { color: var(--green); }
.dd-risk-row strong.red { color: var(--red); }
.dd-profile-tabs { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3px; }
.dd-profile-tabs button { min-height: 28px; padding: 3px 8px; border: 1px solid var(--line); border-radius: 5px; background: var(--bg); color: var(--ink); font-size: 0.74rem; font-weight: 700; cursor: pointer; }
.dd-profile-tabs button.active { border-color: var(--green); background: var(--surface-active); }
.dd-profile-grid { display: grid; gap: 4px; padding: 0; margin: 0; list-style: none; }
.dd-profile-grid li { display: grid; grid-template-columns: 60px 1fr 1.2fr; gap: 8px; padding: 5px 8px; border: 1px solid var(--line); border-radius: 5px; background: var(--bg); font-size: 0.74rem; align-items: baseline; }
.dd-profile-grid li.active { border-color: var(--green); background: var(--surface-active); }
.dd-profile-grid span { color: var(--muted); font-weight: 800; }
.dd-profile-grid strong { font-variant-numeric: tabular-nums; }
.dd-profile-grid em { font-style: normal; color: var(--muted); font-size: 0.66rem; }
</style>
```

---

### Task 15：新建 `ComputeDrawer.vue`

**Files:**
- Create: `src/components/ComputeDrawer.vue`

- [ ] **Step 15.1：实现**

`src/components/ComputeDrawer.vue`：

```vue
<script setup>
import { computed } from 'vue'
import MetricStrip from './MetricStrip.vue'
import ChainFlow from './ChainFlow.vue'
import FormulaDrawerContent from './FormulaDrawerContent.vue'
import FormulaChart from './FormulaChart.vue'
import FormulaNav from './FormulaNav.vue'

const props = defineProps({
  graph: { type: Object, required: true },
  market: { type: Object, default: null },
  rows: { type: Array, default: () => [] },
  costPath: { type: Array, default: () => [] },
  sourceLabel: { type: String, default: '未载入' },
  activeFormulaId: { type: String, required: true },
  activeFormula: { type: Object, default: null },
})

const emit = defineEmits(['select-formula'])

const metrics = computed(() => {
  const m = props.market; const g = props.graph
  return [
    { label: '现价', value: money(m?.markPrice), unit: props.sourceLabel },
    { label: '成本锚', value: money(m?.costAnchor), unit: pct(m?.costDistance) },
    { label: 'IV', value: pct(g.inputs?.iv), unit: `ATR ${pct(m?.atrPercent)}` },
    { label: '波动带', value: money(g.deltaBands?.long?.low), unit: money(g.deltaBands?.long?.high) },
    { label: '组合价值', value: money(g.portfolio), unit: g?.decision?.state ?? '等待' },
  ]
})

function money(v) { return Number.isFinite(v) ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(v) : '—' }
function pct(v) { return Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '—' }
</script>

<template>
  <div class="cd-drawer">
    <section class="cd-section">
      <h3 class="cd-h">五个市场指标</h3>
      <MetricStrip :items="metrics" />
    </section>

    <section class="cd-section">
      <h3 class="cd-h">计算管线</h3>
      <ChainFlow :graph="graph" :market="market" :active-id="activeFormulaId" @select="emit('select-formula', $event)" />
    </section>

    <section class="cd-section">
      <h3 class="cd-h">当前公式 · {{ activeFormula?.label || '—' }}</h3>
      <FormulaChart
        v-if="activeFormulaId"
        :formula-id="activeFormulaId"
        :graph="graph"
        :market="market"
        :rows="rows"
        :cost-path="costPath"
      />
      <FormulaDrawerContent
        v-if="activeFormulaId"
        :formula-id="activeFormulaId"
        :graph="graph"
        :market="market"
      />
    </section>

    <section class="cd-section">
      <h3 class="cd-h">完整公式列表</h3>
      <FormulaNav :active-id="activeFormulaId" @select="emit('select-formula', $event)" />
    </section>
  </div>
</template>

<style>
.cd-drawer { display: grid; gap: 16px; }
.cd-section { display: grid; gap: 8px; padding-bottom: 12px; border-bottom: 1px solid var(--line); }
.cd-section:last-child { border-bottom: none; }
.cd-h { margin: 0; color: var(--green); font-size: 0.66rem; font-weight: 900; letter-spacing: 0.06em; text-transform: uppercase; }
.cd-drawer .metric-strip { grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 4px; padding: 0; }
.cd-drawer .metric-strip article { padding: 6px 7px; }
</style>
```

> 注：spec 里说 ComputeDrawer 5 分区含 QuestionNav；但 §4.6 在重构时建议**删 QuestionNav**（"在计算抽屉里问题导航意义当不大"）—— 实际本任务只接 4 分区（指标 / 管线 / 当前公式 / 完整列表），简洁。如果用户后期反馈需要 QuestionNav，再加分区。

---

### Task 16：新建 `SimulationInputs.vue` + `ChartOverlayToggles.vue` + `SettingsDrawer.vue`

**Files:**
- Create: `src/components/SimulationInputs.vue`
- Create: `src/components/ChartOverlayToggles.vue`
- Create: `src/components/SettingsDrawer.vue`

- [ ] **Step 16.1：SimulationInputs.vue**

`src/components/SimulationInputs.vue`：

```vue
<script setup>
import { computed } from 'vue'

const props = defineProps({
  input: { type: Object, required: true },
})

function pctIn(v) { const n = Number(v); return Number.isFinite(n) ? n / 100 : 0 }
function pctOut(v) { return Number.isFinite(v) ? Number((v * 100).toFixed(2)) : 0 }

const ivP = computed({ get: () => pctOut(props.input.iv), set: (v) => { props.input.iv = pctIn(v) } })
const trP = computed({ get: () => pctOut(props.input.targetReturn), set: (v) => { props.input.targetReturn = pctIn(v) } })
const rfrP = computed({ get: () => pctOut(props.input.riskFreeRate), set: (v) => { props.input.riskFreeRate = pctIn(v) } })
</script>

<template>
  <div class="si-form">
    <label><span>入场价</span><input v-model.number="input.entryPrice" type="number" step="0.01" /></label>
    <label><span>窗口（天）</span><input v-model.number="input.holdingDays" type="number" min="1" step="1" /></label>
    <label><span>波动率%</span><input v-model.number="ivP" type="number" step="0.5" /></label>
    <label><span>目标%</span><input v-model.number="trP" type="number" step="0.5" /></label>
    <label><span>本金</span><input v-model.number="input.capital" type="number" step="100" /></label>
    <label><span>底仓名义</span><input v-model.number="input.baseNotional" type="number" step="100" /></label>
    <label><span>行权价</span><input v-model.number="input.strikePrice" type="number" step="0.01" /></label>
    <label><span>无风险利率%</span><input v-model.number="rfrP" type="number" step="0.1" /></label>
    <label><span>期权类型</span>
      <select v-model="input.optionType">
        <option value="put">认沽 put</option>
        <option value="call">认购 call</option>
      </select>
    </label>
    <label><span>区间宽度</span><input v-model.number="input.rangeWidth" type="number" step="0.01" /></label>
  </div>
</template>

<style>
.si-form { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 10px; }
.si-form label { display: grid; gap: 2px; }
.si-form span { color: var(--muted); font-size: 0.62rem; font-weight: 800; text-transform: uppercase; }
.si-form input, .si-form select { min-height: 28px; padding: 3px 7px; border: 1px solid var(--line); border-radius: 5px; background: var(--bg); color: var(--ink); font-size: 0.78rem; font-variant-numeric: tabular-nums; }
.si-form select { font-weight: 600; }
</style>
```

- [ ] **Step 16.2：ChartOverlayToggles.vue**

`src/components/ChartOverlayToggles.vue`：

```vue
<script setup>
defineProps({
  overlays: { type: Object, required: true },
})

const TOGGLES = [
  { key: 'costBand', label: '成本锚带' },
  { key: 'entryLine', label: '入场价线' },
  { key: 'volBand', label: '波动带' },
  { key: 'volume', label: '成交量' },
  { key: 'replayMarkers', label: 'Replay 标记' },
  { key: 'currentDecision', label: '当前决策点' },
  { key: 'deltaPane', label: 'Δ 子图' },
  { key: 'equityPane', label: '权益子图' },
]
</script>

<template>
  <div class="cot-grid">
    <label v-for="t in TOGGLES" :key="t.key" class="cot-row">
      <input type="checkbox" v-model="overlays[t.key]" />
      <span>{{ t.label }}</span>
    </label>
  </div>
</template>

<style>
.cot-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 10px; }
.cot-row { display: flex; gap: 7px; align-items: center; padding: 5px 8px; border: 1px solid var(--line); border-radius: 5px; background: var(--bg); cursor: pointer; }
.cot-row:has(input:checked) { border-color: var(--green); background: var(--surface-active); }
.cot-row input { margin: 0; }
.cot-row span { color: var(--ink); font-size: 0.78rem; font-weight: 600; }
</style>
```

- [ ] **Step 16.3：SettingsDrawer.vue**

`src/components/SettingsDrawer.vue`：

```vue
<script setup>
import SimulationInputs from './SimulationInputs.vue'
import AdvancedSettingsContent from './AdvancedSettingsContent.vue'
import ChartOverlayToggles from './ChartOverlayToggles.vue'

defineProps({
  input: { type: Object, required: true },
  tdpyMeta: { type: Object, required: true },
  effectiveTdpy: { type: Number, required: true },
  symbol: { type: String, default: '' },
  overlays: { type: Object, required: true },
  theme: { type: String, default: 'light' },
})

const emit = defineEmits(['override-tdpy', 'reset-tdpy', 'set-theme', 'reset-all'])
</script>

<template>
  <div class="sd-drawer">
    <section class="sd-section">
      <h3 class="sd-h">模拟参数</h3>
      <SimulationInputs :input="input" />
    </section>

    <section class="sd-section">
      <h3 class="sd-h">计算口径</h3>
      <AdvancedSettingsContent
        :tdpy-meta="tdpyMeta"
        :effective-tdpy="effectiveTdpy"
        :symbol="symbol"
        @override="(s, v) => emit('override-tdpy', s, v)"
        @reset="(s) => emit('reset-tdpy', s)"
      />
    </section>

    <section class="sd-section">
      <h3 class="sd-h">主图叠加项</h3>
      <ChartOverlayToggles :overlays="overlays" />
    </section>

    <section class="sd-section">
      <h3 class="sd-h">主题</h3>
      <div class="sd-theme">
        <button :class="{ active: theme === 'light' }" @click="emit('set-theme', 'light')">浅色</button>
        <button :class="{ active: theme === 'dark' }" @click="emit('set-theme', 'dark')">深色</button>
      </div>
    </section>

    <section class="sd-section">
      <h3 class="sd-h">重置</h3>
      <button class="sd-reset" type="button" @click="emit('reset-all')">清空所有持久化参数 + 刷新</button>
    </section>
  </div>
</template>

<style>
.sd-drawer { display: grid; gap: 16px; }
.sd-section { display: grid; gap: 8px; padding-bottom: 12px; border-bottom: 1px solid var(--line); }
.sd-section:last-child { border-bottom: none; }
.sd-h { margin: 0; color: var(--green); font-size: 0.66rem; font-weight: 900; letter-spacing: 0.06em; text-transform: uppercase; }
.sd-theme { display: flex; gap: 6px; }
.sd-theme button { min-height: 30px; padding: 4px 14px; border: 1px solid var(--line); border-radius: 5px; background: var(--bg); color: var(--ink); font-size: 0.78rem; font-weight: 700; cursor: pointer; }
.sd-theme button.active { border-color: var(--green); background: var(--surface-active); }
.sd-reset { min-height: 32px; padding: 5px 14px; border: 1px solid #b8860b; border-radius: 5px; background: var(--bg); color: #b8860b; font-size: 0.8rem; font-weight: 700; cursor: pointer; }
.sd-reset:hover { background: #b8860b; color: #fff; }
</style>
```

---

### Task 17：把 3 个抽屉接到 App.vue

**Files:**
- Modify: `src/App.vue`

- [ ] **Step 17.1：替换 DrawerHost 的 slots**

定位 `<DrawerHost>` 块（含 3 个 todo slot）。将整个 `<DrawerHost>` 块替换为：

```vue
    <DrawerHost :active-drawer="lab.activeDrawer" @close="lab.closeDrawer">
      <template #decision>
        <DecisionDrawer
          :graph="lab.graph"
          :market="lab.market"
          :replay="lab.replay"
          :profile-replays="lab.profileReplays"
          :active-profile-id="lab.effectiveInput.strategyProfile"
          :auto-profile="lab.input.autoProfile"
          :profile-list="lab.strategyProfileList"
          @set-profile="onSetProfile"
          @set-auto-profile="onSetAutoProfile"
        />
      </template>
      <template #compute>
        <ComputeDrawer
          :graph="lab.graph"
          :market="lab.market"
          :rows="lab.rows"
          :cost-path="lab.costPath"
          :source-label="lab.sourceLabel"
          :active-formula-id="lab.activeFormulaId"
          :active-formula="lab.activeFormula"
          @select-formula="(id) => lab.activeFormulaId = id"
        />
      </template>
      <template #settings>
        <SettingsDrawer
          :input="lab.input"
          :tdpy-meta="lab.tdpyMeta"
          :effective-tdpy="lab.effectiveTdpy"
          :symbol="lab.source?.symbol ?? ''"
          :overlays="lab.chartOverlays"
          :theme="theme"
          @override-tdpy="(sym, val) => lab.setTdpyOverride(sym, val)"
          @reset-tdpy="(sym) => lab.clearTdpyOverride(sym)"
          @set-theme="(t) => { theme = t }"
          @reset-all="resetWorkbench"
        />
      </template>
    </DrawerHost>
```

- [ ] **Step 17.2：补 imports**

定位 `<script setup>` 顶部 imports，追加：

```js
import DecisionDrawer from './components/DecisionDrawer.vue'
import ComputeDrawer from './components/ComputeDrawer.vue'
import SettingsDrawer from './components/SettingsDrawer.vue'
```

- [ ] **Step 17.3：跑 dev 验证 3 个抽屉**

```bash
npm run dev
```

打开浏览器：
1. 加载 BTC，点 💡 → 决策抽屉显示完整 6 分区 ✓
2. 点 📊 → 计算抽屉显示 4 分区，点公式列表能切换"当前公式" ✓
3. 点 ⚙️ → 设置抽屉显示 5 分区，勾"Δ 子图"开关 → 主图加 Δ pane ✓
4. 设置抽屉切深色主题 → 全局深色 ✓
5. 重置按钮触发 confirm 后清空 + 刷新 ✓

如有 break 停下报告。

- [ ] **Step 17.4：删除孤儿文件**

> 现在以下文件已无引用，可以删除（如不确定，先用 grep 验证）：

```bash
# grep 验证（应无输出，除注释/文档）
npx grep -rln "from.*components/MarketChart.vue" src/
npx grep -rln "from.*components/QuestionNav.vue" src/
npx grep -rln "from.*components/DecisionPanel.vue" src/
npx grep -rln "from.*components/AdvancedSettings.vue" src/
npx grep -rln "from.*components/FormulaDrawer.vue" src/
```

确认无引用后，把以下文件**移到回收站**（按全局规则不直接 rm）：

```powershell
powershell -Command "Add-Type -AssemblyName Microsoft.VisualBasic; @('F:/devarea/market-lab-amplify/src/components/MarketChart.vue','F:/devarea/market-lab-amplify/src/components/QuestionNav.vue','F:/devarea/market-lab-amplify/src/components/DecisionPanel.vue','F:/devarea/market-lab-amplify/src/components/AdvancedSettings.vue','F:/devarea/market-lab-amplify/src/components/FormulaDrawer.vue','F:/devarea/market-lab-amplify/src/components/ChainFlow.vue.bak') | ForEach-Object { if (Test-Path \$_) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile(\$_, 'OnlyErrorDialogs', 'SendToRecycleBin') } }"
```

> 上面的命令把 5 个文件送回收站。`ChainFlow.vue` **不删**（ComputeDrawer 还在用它）。
> 
> **如果删错**：从回收站还原即可。

> **重要警告**：执行删除前**务必**先跑 `npx grep -rln` 确认无依赖。如有任意一个有引用，停下报告，不要硬删。

- [ ] **Step 17.5：跑测试 + verify + build**

```bash
npm test && npm run verify:domain && npm run check:data && npx vite build
```

Expected: 全部通过。

---

### Task 18：手动验收 + 收尾

- [ ] **Step 18.1：完整验收清单**

启动 dev：

```bash
npm run dev
```

打开 http://localhost:5173/，按 spec §11 验收清单逐条：

| 操作 | 期望 | ☑ |
|---|---|---|
| 加载 BTC | TopBar 现价 / narrative / 推荐动作 / profile chip 全部显示 | |
| 切到 AAPL（搜索框输入） | TopBar 整段更新 | |
| 主图区 | K + 成本带 + 入场 + 成交量 + replay markers + 当前决策点 7 项可见 | |
| Δ 子图 | 默认隐藏 | |
| 权益子图 | 默认隐藏 | |
| 点 ⚙️ FAB | 设置抽屉滑入 | |
| 设置抽屉勾"Δ 子图" | 主图加 pane 2，Δ 线可见 | |
| 关 Δ 开关 | pane 2 消失 | |
| 点 💡 FAB | 决策抽屉滑入，6 分区可见 | |
| 点 📊 FAB | 计算抽屉滑入，4 分区可见 | |
| ESC | 当前抽屉关闭 | |
| 状态栏 [入场价 ▾] | 弹小 popover；改 95 → 99 + Enter | |
| 主图入场价线 | 移到 99 | |
| ProfileChip 切换"均衡 → 激进" | TopBar 推荐动作更新，决策抽屉同步 | |
| 切深色主题 + 刷新 | 主题保留 | |
| 设置抽屉点重置 | confirm 后所有 UI 状态归零 | |
| < 1100px 宽屏 | TopBar 推荐段隐藏 | |
| < 800px 宽屏 | TopBar narrative 段隐藏，搜索框缩小 | |

- [ ] **Step 18.2：最后一次全量回归**

```bash
npm run check:data && npm run verify:domain && npm test
```

Expected: PASS。**测试数 55**（含 PR-A 加的 5 个新测试 + PR-B 加的 4 个 ParamPopover 测试 = 11 - 1（删 selectCapability）= 9，加上原 54 - 5（删旧 input 默认值含 tdpy 的）实际收纳 = 55；如有差异以实际为准）。

- [ ] **Step 18.3：手工删除多余 stale 样式（可选）**

`src/styles/decision.css` 等如有未使用的 `.exec-strip` 等全局样式，本任务不强制清理（实际未影响渲染），后续单独清理。

---

## 自审

### Spec 覆盖检查

| spec 节 | 任务 |
|---|---|
| §3 模块清单 | Tasks 1-17 全覆盖 |
| §4.1 TopBar | Task 11 |
| §4.2 MainChart | Task 12 |
| §4.3 ChartStatusBar | Task 8 |
| §4.4 ParamPopover | Task 4 |
| §4.5 ChartFabs | Task 7 |
| §4.6 DrawerHost | Task 9 |
| §4.7 DecisionDrawer | Task 14 |
| §4.8 ComputeDrawer | Task 15 |
| §4.9 SettingsDrawer | Task 16 |
| §4.10 ProfileChip | Task 10 |
| §4.11 ProfileSwitcher | **合并到 Task 14**（DecisionDrawer 内嵌 dd-profile-tabs + dd-profile-grid，不单独拆 ProfileSwitcher.vue —— 内嵌更简洁，符合 YAGNI） |
| §4.12 SimulationInputs | Task 16 |
| §4.13 ChartOverlayToggles | Task 16 |
| §4.14 既有组件改造 | Task 5 / 6（fragment 化）；其余在 Task 17 删除 |
| §5 数据流 | Tasks 2 / 3 |
| §6 兼容迁移 | Task 3 测试覆盖 |
| §7 错误边界 | Task 13（empty-state 保留）+ Task 9（ESC 处理）|
| §8 测试 | Tasks 1 / 4 / 3 |
| §11 验收清单 | Task 18 |

### 调整说明

- **§4.11 ProfileSwitcher**：spec 原计划独立组件，但本计划合并到 DecisionDrawer 内嵌（4 个按钮 + 4 行回测概览）。理由：YAGNI，不需要独立 .vue 文件。如果未来要在多处复用，再拆。
- **ComputeDrawer QuestionNav 分区**：spec 原计划 5 分区含 QuestionNav，本计划简化为 4 分区。理由：搜索已在 TopBar，问题导航在抽屉里冗余；本任务先不接，等用户反馈。
- **删除 wrapper 时机**：AdvancedSettings.vue / FormulaDrawer.vue 在 PR-B 改成轻 wrapper，PR-D Task 17 删除。MarketChart.vue 在 PR-C 复制成 MainChart.vue 后保留，Task 17 删。

### Placeholder 扫描

- 所有步骤都有具体代码或具体命令
- 无 TBD / TODO
- 测试中具体值（toBe(365)、toContain('深度折价') 等）都明示

### 类型一致性

- `inferTdpy(sample) → { value, basis, label }`：Task 1 定义 / Task 11 / Task 16 引用一致
- `useChartOverlays() → reactive({ ... })`：Task 1 定义 / Task 3 / Task 12 / Task 16 引用一致
- `lab.openDrawer(name)` / `lab.closeDrawer()`：Task 2 定义 / Task 3 暴露 / Task 13 / Task 17 引用一致
- `summarizeReason / summarizeRegime`：PR-2 已存在，本计划复用一致

### 风险点

- **MainChart applyOverlays / removeSeries**：lightweight-charts v5 的 `chart.removeSeries(s)` 在某些情况下可能抛异常。**Task 12 Step 12.3 dev 测试**时如发现 `Δ 开关切换` 失败，把 `toggle()` 改为 `series.X.applyOptions({ visible: false })` 方式（series 不真删）。先按当前方案试，fail 再调。
- **Pinia setup store 持久化触发时机**：activeDrawer 用 persistedRef，用户关浏览器再开会保留 lastDrawer 打开态，**这是有意保留**（spec §6 已确认）。如果不希望保留，把 `persistedRef('lab.activeDrawer.v1', null)` 改为 `ref(null)` 即可。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-15-lab-v3-tradingview-cc.md`. Two execution options:

**1. Subagent-Driven（推荐）** — 每个 Task 派 fresh subagent，任务间停下来给你审，迭代快、上下文干净。

**2. Inline Execution** — 当前会话直接执行，按 PR 批次留 checkpoint 给你审。

**选哪个？**
