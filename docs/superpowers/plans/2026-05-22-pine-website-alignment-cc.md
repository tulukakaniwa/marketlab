# Pine ↔ 网站 数值对齐实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `bl-esw-pinbar-market-lab.pine` 在默认配置下与 `0xff.tools` 网站（src/domain/**）输出完全一致的关键数值，并建立自动数值断言机制防止再次分叉。

**Architecture:** Pine 不能本地跑，所以做一个 JS 双胞胎（`scripts/verify-pine-equivalence.mjs`）逐行镜像 Pine 计算逻辑；Vitest 跑固定 OHLCV，比对 JS 双胞胎与 JS 真相源（`src/domain/**`），断言相对差异 < 容差表。任何 Pine 改动必须同步改 JS 双胞胎，否则测试失败。

**Tech Stack:** Pine v6、Vue 3、Vitest 4、d3-dsv、Node.js 22+、pnpm

**Spec:** `docs/superpowers/specs/2026-05-22-pine-website-alignment-design-cc.md`

---

## 文件结构

| 路径 | 角色 | 操作 |
|------|------|------|
| `bl-esw-pinbar-market-lab.pine` | TradingView 指标主文件 | 修改 |
| `scripts/verify-pine.mjs` | Pine 文本结构检查（Node） | 修改 |
| `scripts/verify-pine.ps1` | Pine 文本结构检查（PowerShell 镜像） | 修改 |
| `scripts/verify-pine-equivalence.mjs` | JS 双胞胎 + 数值对比工具 | 新增 |
| `src/test/pine-equivalence.test.js` | Vitest 数值断言 | 新增 |
| `src/test/helpers/loadCsv.js` | CSV 加载（复用 d3-dsv） | 新增 |
| `docs/formula-evidence/pine-alignment.md` | 对齐凭证、容差、扩展偏离方向 | 新增 |
| `package.json` | 新增 `verify:pine-equivalence` script | 修改 |
| `bl-esw-pinbar-market-lab-cdx.pine` | Codex 实验线 | **不动** |
| `src/domain/**` | JS 真相源 | **不动** |

---

## 前置：分支与环境

```bash
cd F:/devarea/marketlab
git stash push -u bl-esw-pinbar-market-lab.pine scripts/verify-pine.mjs scripts/verify-pine.ps1 -m "WIP unrelated hotfix pine"
git checkout main
git pull --ff-only
git checkout -b feature/pine-website-alignment
pnpm install --frozen-lockfile
```

---

## Task 1：CSV 加载 helper

**Files:**
- Create: `F:/devarea/marketlab/src/test/helpers/loadCsv.js`
- Test: `F:/devarea/marketlab/src/test/helpers/__tests__/loadCsv.test.js`

- [ ] **Step 1：写失败的测试**

`src/test/helpers/__tests__/loadCsv.test.js`：
```js
import { describe, expect, it } from 'vitest'
import { loadCsv } from '../loadCsv.js'

describe('loadCsv', () => {
  it('能加载 GOOG-1d.csv 并返回标准化 OHLCV 行', () => {
    const rows = loadCsv('public/data/GOOG-1d.csv')
    expect(rows.length).toBeGreaterThan(500)
    const last = rows.at(-1)
    expect(last).toMatchObject({
      date: expect.any(String),
      open: expect.any(Number),
      high: expect.any(Number),
      low: expect.any(Number),
      close: expect.any(Number),
      volume: expect.any(Number),
    })
    expect(last.high).toBeGreaterThanOrEqual(last.low)
  })
})
```

- [ ] **Step 2：跑测试确认失败**

```bash
cd F:/devarea/marketlab
pnpm vitest run src/test/helpers/__tests__/loadCsv.test.js
```
预期：`Cannot find module '../loadCsv.js'`

- [ ] **Step 3：实现 loadCsv**

`src/test/helpers/loadCsv.js`：
```js
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseCsvText } from '../../domain/market-data/ohlcv.js'

export function loadCsv(relativePath) {
  const absPath = resolve(process.cwd(), relativePath)
  const text = readFileSync(absPath, 'utf8')
  return parseCsvText(text)
}
```

- [ ] **Step 4：跑测试确认通过**

```bash
pnpm vitest run src/test/helpers/__tests__/loadCsv.test.js
```
预期：1 passed

- [ ] **Step 5：commit**

```bash
git add src/test/helpers/loadCsv.js src/test/helpers/__tests__/loadCsv.test.js
git commit -m "test: add loadCsv helper for pine equivalence fixtures"
```

---

## Task 2：JS 双胞胎初版（镜像当前 Pine）

**Files:**
- Create: `F:/devarea/marketlab/scripts/verify-pine-equivalence.mjs`

这一步先按**当前 Pine 的实际行为**实现 JS 双胞胎（`auto_adapt=false`、population stdev、Wilder ATR），后续每个 Pine 改动都会同步更新这里。

- [ ] **Step 1：创建文件 + 工具函数**

`scripts/verify-pine-equivalence.mjs`：
```js
// JS 双胞胎：逐行镜像 bl-esw-pinbar-market-lab.pine 的计算逻辑
// 任何 Pine 改动必须同步改这里，否则 src/test/pine-equivalence.test.js 会失败

const DEFAULTS = {
  cost_len: 60,
  recent_len: 20,
  vol_len: 60,
  holding_days: 30,
  trading_days: 365,
  target_return_pct: 30,
  lp_range_width: 0.10,
  lp_skew: 1.0,
  profile: 'Balanced',
  auto_adapt: false,
  relax_mode: false,
  adaptive_cost: false,
}

function biasedStdev(values) {
  // Pine ta.stdev 默认 biased=true（除以 n）
  if (values.length < 1) return 0
  const mean = values.reduce((s, v) => s + v, 0) / values.length
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

function wilderAtr(rows, period = 14) {
  // Pine ta.atr 用 RMA：RMA[i] = (RMA[i-1]*(n-1) + tr[i]) / n
  const trs = rows.map((row, i) => {
    if (i === 0) return row.high - row.low
    const prevClose = rows[i - 1].close
    return Math.max(row.high - row.low, Math.abs(row.high - prevClose), Math.abs(row.low - prevClose))
  })
  let rma = trs.slice(0, period).reduce((s, v) => s + v, 0) / period
  for (let i = period; i < trs.length; i += 1) {
    rma = (rma * (period - 1) + trs[i]) / period
  }
  return rma
}

function vwapTypical(rows) {
  if (!rows.length) return 0
  const totalVol = rows.reduce((s, r) => s + r.volume, 0)
  if (totalVol <= 0) {
    return rows.reduce((s, r) => s + (r.high + r.low + r.close) / 3, 0) / rows.length
  }
  return rows.reduce((s, r) => s + ((r.high + r.low + r.close) / 3) * r.volume, 0) / totalVol
}

export function pineEquivalent(rows, inputs = {}) {
  const opts = { ...DEFAULTS, ...inputs }
  if (rows.length < opts.cost_len + 5) {
    throw new Error(`pineEquivalent 需要至少 ${opts.cost_len + 5} 根 K 线`)
  }
  const last = rows.at(-1)

  // cost anchor (VWAP of typical price)
  const anchorRows = rows.slice(-opts.cost_len)
  const cost_anchor = vwapTypical(anchorRows)

  // log returns（最近 cost_len 期，从 cost_len+1 行算 cost_len 个收益）
  const bandRows = rows.slice(-(opts.cost_len + 1))
  const logRets = bandRows.slice(1).map((row, i) => Math.log(row.close / bandRows[i].close))
  const vol_estimate = biasedStdev(logRets) * Math.sqrt(Math.min(opts.recent_len, logRets.length))
  const min_band = Math.max(vol_estimate * 0.25, 0.005)
  const band_width = Math.max(vol_estimate, min_band)
  const cost_low = cost_anchor * (1 - band_width)
  const cost_high = cost_anchor * (1 + band_width)

  // annual vol（用 vol_len 个收益，biased stdev）
  const volRows = rows.slice(-(opts.vol_len + 1))
  const volRets = volRows.slice(1).map((row, i) => Math.log(row.close / volRows[i].close))
  const annual_vol = Math.max(biasedStdev(volRets) * Math.sqrt(opts.trading_days), 0.01)

  // atr_pct（Wilder RMA 14）
  const atr_14 = wilderAtr(rows, 14)
  const atr_pct = last.close > 0 ? atr_14 / last.close : 0

  // GetDelta band
  const target_return = opts.target_return_pct / 100
  const wave_raw = annual_vol * Math.sqrt(opts.holding_days / (opts.trading_days * 2 * Math.PI))
  const wave = Math.min(wave_raw, 0.99)
  let long_cost = NaN, long_high = NaN, long_low = NaN
  if (wave > 0 && wave < 1 && last.close > 0) {
    const long_ratio = ((1 + wave) / (1 - wave)) ** 2
    long_cost = last.close * (target_return * long_ratio - target_return + 1) ** 2 / long_ratio
    long_high = long_cost * long_ratio
    long_low = long_cost / long_ratio
  }

  // z score（用 holding 周期化）
  const period_vol = annual_vol > 0 ? annual_vol * Math.sqrt(opts.holding_days / opts.trading_days) : 0.01
  const cost_distance = cost_anchor > 0 ? last.close / cost_anchor - 1 : 0
  const z_score = period_vol > 0 ? cost_distance / period_vol : 0

  return {
    cost_anchor, cost_low, cost_high,
    annual_vol, atr_pct,
    long_cost, long_high, long_low,
    z_score, cost_distance, period_vol,
    band_width,
    last_close: last.close,
  }
}

// CLI 用法：node scripts/verify-pine-equivalence.mjs public/data/GOOG-1d.csv
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  const { readFileSync } = await import('node:fs')
  const { resolve } = await import('node:path')
  const { parseCsvText } = await import('../src/domain/market-data/ohlcv.js')
  const path = process.argv[2] || 'public/data/GOOG-1d.csv'
  const text = readFileSync(resolve(process.cwd(), path), 'utf8')
  const rows = parseCsvText(text)
  console.log(JSON.stringify(pineEquivalent(rows), null, 2))
}
```

- [ ] **Step 2：手动跑一次确认能输出**

```bash
cd F:/devarea/marketlab
node scripts/verify-pine-equivalence.mjs public/data/GOOG-1d.csv
```
预期：输出 JSON，包含 `cost_anchor` 等字段，数值非 NaN。

- [ ] **Step 3：commit**

```bash
git add scripts/verify-pine-equivalence.mjs
git commit -m "feat: add JS twin mirroring current pine for equivalence testing"
```

---

## Task 3：第一个数值断言（cost_anchor 通过、annual_vol 失败）

**Files:**
- Create: `F:/devarea/marketlab/src/test/pine-equivalence.test.js`

- [ ] **Step 1：写测试，包含 cost_anchor 和 annual_vol 两条断言**

`src/test/pine-equivalence.test.js`：
```js
import { describe, expect, it } from 'vitest'
import { loadCsv } from './helpers/loadCsv.js'
import { pineEquivalent } from '../../scripts/verify-pine-equivalence.mjs'
import { buildMarketState } from '../domain/market-data/cost.js'

const FIXTURES = [
  { symbol: 'GOOG', path: 'public/data/GOOG-1d.csv' },
  { symbol: 'AAPL', path: 'public/data/AAPL-1d.csv' },
  { symbol: '600519', path: 'public/data/600519-1d.csv' },
  { symbol: 'BTCUSDT', path: 'public/data/BTCUSDT-1d.csv' },
]

const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-9)

for (const { symbol, path } of FIXTURES) {
  describe(`Pine ↔ JS alignment: ${symbol}`, () => {
    const rows = loadCsv(path)
    const jsRef = buildMarketState(rows, 365)
    const pine = pineEquivalent(rows)

    it('cost_anchor 差异 < 0.05%', () => {
      expect(rel(pine.cost_anchor, jsRef.costAnchor)).toBeLessThan(0.0005)
    })
    it('annual_vol 差异 < 0.20%', () => {
      expect(rel(pine.annual_vol, jsRef.annualVol)).toBeLessThan(0.002)
    })
  })
}
```

- [ ] **Step 2：跑测试**

```bash
pnpm vitest run src/test/pine-equivalence.test.js
```
预期：
- `cost_anchor 差异 < 0.05%` → **PASS**（4 个 fixture 都通过，VWAP 公式两边一致）
- `annual_vol 差异 < 0.20%` → **FAIL**（Pine 用 biased stdev 比 JS 的 sample stdev 系统性偏小约 0.84%）

把失败输出截图或贴到 commit message，作为"分歧确实存在"的凭证。

- [ ] **Step 3：commit（带失败凭证）**

```bash
git add src/test/pine-equivalence.test.js
git commit -m "test: add pine equivalence assertions; annual_vol fails as expected (biased stdev divergence)"
```

---

## Task 4：修复 annual_vol → sample stdev

**Files:**
- Modify: `F:/devarea/marketlab/bl-esw-pinbar-market-lab.pine` 第 96 行、第 105 行
- Modify: `F:/devarea/marketlab/scripts/verify-pine-equivalence.mjs`（同步 JS 双胞胎）

- [ ] **Step 1：改 Pine 的 ta.stdev 调用**

把 `bl-esw-pinbar-market-lab.pine` 第 96 行：
```pine
annual_vol_raw = ta.stdev(log_ret, vol_len) * math.sqrt(trading_days)
```
改为：
```pine
annual_vol_raw = ta.stdev(log_ret, vol_len, false) * math.sqrt(trading_days)
```

把第 105 行：
```pine
vol_estimate = ta.stdev(log_ret, cost_len) * math.sqrt(math.min(recent_len, cost_len))
```
改为：
```pine
vol_estimate = ta.stdev(log_ret, cost_len, false) * math.sqrt(math.min(recent_len, cost_len))
```

- [ ] **Step 2：同步 JS 双胞胎用 sample stdev**

`scripts/verify-pine-equivalence.mjs` 顶部新增 `sampleStdev`，并把所有 `biasedStdev` 调用替换为 `sampleStdev`：
```js
function sampleStdev(values) {
  // Pine ta.stdev(..., false) 用 biased=false（除以 n-1，对齐 JS）
  if (values.length < 2) return 0
  const mean = values.reduce((s, v) => s + v, 0) / values.length
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}
```
然后把 `pineEquivalent` 里两处 `biasedStdev(logRets)`、`biasedStdev(volRets)` 改为 `sampleStdev(...)`。`biasedStdev` 函数可删除（已无引用）。

- [ ] **Step 3：跑测试确认 annual_vol 通过**

```bash
pnpm vitest run src/test/pine-equivalence.test.js
```
预期：4 个 fixture 的 `annual_vol` 全部 PASS。

- [ ] **Step 4：跑 verify-pine 确保 Pine 文本结构没坏**

```bash
pnpm run verify:pine
```
预期：`Pine static checks passed`

- [ ] **Step 5：commit**

```bash
git add bl-esw-pinbar-market-lab.pine scripts/verify-pine-equivalence.mjs
git commit -m "fix(pine): use sample stdev (n-1) to align with JS standardDeviation"
```

---

## Task 5：修复 atr_pct → simple-mean ATR

**Files:**
- Modify: `F:/devarea/marketlab/bl-esw-pinbar-market-lab.pine` 第 99-101 行
- Modify: `F:/devarea/marketlab/scripts/verify-pine-equivalence.mjs`

- [ ] **Step 1：先加 atr_pct 测试断言**

在 `src/test/pine-equivalence.test.js` 的 `describe` 里追加：
```js
    it('atr_pct 差异 < 0.30%', () => {
      expect(rel(pine.atr_pct, jsRef.atrPercent)).toBeLessThan(0.003)
    })
```

- [ ] **Step 2：跑测试，确认失败**

```bash
pnpm vitest run src/test/pine-equivalence.test.js
```
预期：`atr_pct` 在 4 个 fixture 上失败（Wilder RMA 与 simple mean 在趋势期偏差超过 0.3%）。

- [ ] **Step 3：改 Pine ATR 计算**

把 `bl-esw-pinbar-market-lab.pine` 第 99-101 行：
```pine
atr_14 = ta.atr(14)
atr_pct_raw = close > 0 ? atr_14 / close : 0.0
atr_pct = atr_pct_raw
```
替换为：
```pine
true_range = math.max(high - low, math.max(math.abs(high - close[1]), math.abs(low - close[1])))
atr_14 = ta.sma(true_range, 14)
atr_pct = close > 0 ? atr_14 / close : 0.0
```

- [ ] **Step 4：同步 JS 双胞胎**

`scripts/verify-pine-equivalence.mjs`：
- 删除 `wilderAtr` 函数
- 新增 `simpleMeanAtr`：
```js
function simpleMeanAtr(rows, period = 14) {
  // Pine ta.sma(true_range, 14)，对齐 JS average(trueRanges[index-13..index])
  const trs = rows.map((row, i) => {
    if (i === 0) return 0
    const prevClose = rows[i - 1].close
    return Math.max(row.high - row.low, Math.abs(row.high - prevClose), Math.abs(row.low - prevClose))
  })
  const recent = trs.slice(-period)
  return recent.reduce((s, v) => s + v, 0) / recent.length
}
```
把 `pineEquivalent` 里 `wilderAtr(rows, 14)` 改为 `simpleMeanAtr(rows, 14)`。

- [ ] **Step 5：跑测试**

```bash
pnpm vitest run src/test/pine-equivalence.test.js
```
预期：所有 fixture 的 `atr_pct` PASS。

- [ ] **Step 6：跑 verify-pine 确认结构 OK**

```bash
pnpm run verify:pine
```

- [ ] **Step 7：commit**

```bash
git add bl-esw-pinbar-market-lab.pine scripts/verify-pine-equivalence.mjs src/test/pine-equivalence.test.js
git commit -m "fix(pine): replace Wilder RMA atr with simple-mean atr to align with JS"
```

---

## Task 6：补全 cost_low / cost_high / GetDelta 断言

**Files:**
- Modify: `F:/devarea/marketlab/src/test/pine-equivalence.test.js`

stdev 修好后 cost band 应该自动通过；GetDelta 受 annual_vol 影响也应该接近。

- [ ] **Step 1：追加断言**

在 `src/test/pine-equivalence.test.js` 的 `describe` 里追加：
```js
    it('cost_low 差异 < 0.10%', () => {
      expect(rel(pine.cost_low, jsRef.costLow)).toBeLessThan(0.001)
    })
    it('cost_high 差异 < 0.10%', () => {
      expect(rel(pine.cost_high, jsRef.costHigh)).toBeLessThan(0.001)
    })
    it('GetDelta long band 差异 < 0.30%', () => {
      // jsRef 不直接含 longCost；需要从 getDeltaBands 拿
      // 直接放在内层调用
      // 这里转用辅助函数 jsGetDeltaBand（见 Step 2）
      const { longCost, longHigh, longLow } = jsGetDeltaBand(jsRef, rows.at(-1).close)
      expect(rel(pine.long_cost, longCost)).toBeLessThan(0.003)
      expect(rel(pine.long_high, longHigh)).toBeLessThan(0.003)
      expect(rel(pine.long_low, longLow)).toBeLessThan(0.003)
    })
```

- [ ] **Step 2：在测试文件顶部新增 jsGetDeltaBand**

```js
import { getDeltaBands } from '../domain/formulas/options.js'

function jsGetDeltaBand(market, lastClose) {
  const r = getDeltaBands({
    entryPrice: lastClose,
    holdingDays: 30,
    iv: market.annualVol,
    targetReturn: 0.30,
    z: 1,
    tradingDaysPerYear: 365,
  })
  return { longCost: r.long.cost, longHigh: r.long.high, longLow: r.long.low }
}
```

- [ ] **Step 3：跑测试**

```bash
pnpm vitest run src/test/pine-equivalence.test.js
```
预期：所有 4 个 fixture × 5 条断言全 PASS。如有失败，定位是 JS 双胞胎漏抄了某行 Pine 逻辑（最常见：z 参数、target_return 默认值、wave clamp 0.99 vs 1）。

- [ ] **Step 4：commit**

```bash
git add src/test/pine-equivalence.test.js
git commit -m "test: add cost band and GetDelta long band equivalence assertions"
```

---

## Task 7：添加 LP 区间（Pine 可视化 + 数值）

**Files:**
- Modify: `F:/devarea/marketlab/bl-esw-pinbar-market-lab.pine`（输入区 + 计算区 + plot 区）
- Modify: `F:/devarea/marketlab/scripts/verify-pine-equivalence.mjs`
- Modify: `F:/devarea/marketlab/src/test/pine-equivalence.test.js`

- [ ] **Step 1：先加 LP 测试断言**

在 `src/test/pine-equivalence.test.js` 的 `describe` 里追加：
```js
    it('lp_lower / lp_upper 差异 < 0.05%', () => {
      const lpLower = jsRef.costAnchor * Math.max(1 - 0.10, 0.001)
      const lpUpper = jsRef.costAnchor * (1 + 0.10 * 1.0)
      expect(rel(pine.lp_lower, lpLower)).toBeLessThan(0.0005)
      expect(rel(pine.lp_upper, lpUpper)).toBeLessThan(0.0005)
    })
```

- [ ] **Step 2：跑测试确认失败**

```bash
pnpm vitest run src/test/pine-equivalence.test.js
```
预期：`lp_lower / lp_upper` 失败（pineEquivalent 还没实现这两个字段）。

- [ ] **Step 3：在 Pine 输入区追加（紧跟 `target_return_pct = ...` 那行后面）**

```pine
lp_range_width = input.float(0.10, "LP Range Width", minval=0.001, maxval=0.95, step=0.01, group=grp_lab)
lp_skew = input.float(1.0, "LP Skew", minval=0.01, step=0.05, group=grp_lab)
show_lp_band = input.bool(true, "Show LP Range", group=grp_lab)
```

- [ ] **Step 4：在 Pine 计算区追加（紧跟 `cost_low = ...` `cost_high = ...` 后面）**

```pine
lp_lower = cost_anchor * math.max(1 - lp_range_width, 0.001)
lp_upper = cost_anchor * (1 + lp_range_width * lp_skew)
```

- [ ] **Step 5：在 Pine plot 区追加（紧跟 GetDelta band 的三个 plot 后面）**

```pine
plot(show_lab and show_lp_band ? lp_lower : na, title="LP Range Low", color=color.new(#a855f7, 40), linewidth=1, style=plot.style_circles)
plot(show_lab and show_lp_band ? lp_upper : na, title="LP Range High", color=color.new(#a855f7, 40), linewidth=1, style=plot.style_circles)
```

- [ ] **Step 6：同步 JS 双胞胎**

在 `scripts/verify-pine-equivalence.mjs` 的 `pineEquivalent` 里，`return` 之前追加：
```js
  // LP 区间
  const lp_lower = cost_anchor * Math.max(1 - opts.lp_range_width, 0.001)
  const lp_upper = cost_anchor * (1 + opts.lp_range_width * opts.lp_skew)
```
然后把 `lp_lower, lp_upper` 加到 return 对象里。

- [ ] **Step 7：跑测试**

```bash
pnpm vitest run src/test/pine-equivalence.test.js
```
预期：所有断言全 PASS。

- [ ] **Step 8：跑 verify-pine 确认结构 OK**

```bash
pnpm run verify:pine
```

- [ ] **Step 9：commit**

```bash
git add bl-esw-pinbar-market-lab.pine scripts/verify-pine-equivalence.mjs src/test/pine-equivalence.test.js
git commit -m "feat(pine): add LP range upper/lower aligned with JS formulaPath"
```

---

## Task 8：添加 Position 标签

**Files:**
- Modify: `F:/devarea/marketlab/bl-esw-pinbar-market-lab.pine`（计算区 + 状态面板表格）

Position 是字符串标签，不写数值断言；改完后用人工 SOP 在 TV 看效果。

- [ ] **Step 1：在 Pine 输入区追加**

紧跟 `show_lp_band = ...`：
```pine
show_position_row = input.bool(true, "Show Position Row", group=grp_lab)
```

- [ ] **Step 2：在 Pine 计算区追加（紧跟 `lp_upper = ...`）**

```pine
position_label = close > cost_high ? "高于成本带" : close < cost_low ? "低于成本带" : "成本带内"
```

- [ ] **Step 3：把状态面板表格从 8 行扩到 9 行**

找到第 274 行 `var table lab_table = table.new(position.top_right, 2, 8, border_width=1)`，把 `2, 8` 改成 `2, 9`：
```pine
var table lab_table = table.new(position.top_right, 2, 9, border_width=1)
```

然后在 `if barstate.islast and show_lab and show_lab_panel` 块内，紧跟 `table.cell(lab_table, 1, 0, ...)`（第 0 行 Profile 标签那行）后插入 Position 行（第 1 行）：
```pine
    if show_position_row
        table.cell(lab_table, 0, 1, "Position", text_color=color.black, bgcolor=color.white)
        table.cell(lab_table, 1, 1, position_label, text_color=color.black, bgcolor=color.white)
```

把原来第 1 行 State 改为第 2 行，第 2 行 Cost Dev 改为第 3 行，依此类推：
```pine
    table.cell(lab_table, 0, 2, "State", text_color=color.black, bgcolor=color.white)
    table.cell(lab_table, 1, 2, lab_state, text_color=color.black, bgcolor=state_color)
    table.cell(lab_table, 0, 3, "Cost Dev", text_color=color.black, bgcolor=color.white)
    table.cell(lab_table, 1, 3, str.tostring(cost_distance * 100, "#.##") + "%", text_color=color.black, bgcolor=color.white)
    table.cell(lab_table, 0, 4, "Z (T=" + str.tostring(holding_days) + "d)", text_color=color.black, bgcolor=color.white)
    table.cell(lab_table, 1, 4, str.tostring(z_score, "#.##") + "σ · " + z_strength, text_color=color.black, bgcolor=color.white)
    table.cell(lab_table, 0, 5, "Ann Vol", text_color=color.black, bgcolor=color.white)
    table.cell(lab_table, 1, 5, str.tostring(annual_vol * 100, "#.##") + "%", text_color=color.black, bgcolor=color.white)
    table.cell(lab_table, 0, 6, "ATR%", text_color=color.black, bgcolor=color.white)
    table.cell(lab_table, 1, 6, str.tostring(atr_pct * 100, "#.##") + "%", text_color=color.black, bgcolor=color.white)
    table.cell(lab_table, 0, 7, "Cost", text_color=color.black, bgcolor=color.white)
    table.cell(lab_table, 1, 7, str.tostring(cost_anchor, "#.##"), text_color=color.black, bgcolor=color.white)
    table.cell(lab_table, 0, 8, "Reason", text_color=color.black, bgcolor=color.white)
    table.cell(lab_table, 1, 8, lab_reason, text_color=color.black, bgcolor=color.white)
```

- [ ] **Step 4：跑 verify-pine**

```bash
pnpm run verify:pine
```
预期：`Pine static checks passed`

- [ ] **Step 5：commit**

```bash
git add bl-esw-pinbar-market-lab.pine
git commit -m "feat(pine): add Position label row in status panel"
```

---

## Task 9：添加 Match（Abramowitz erf 近似）

**Files:**
- Modify: `F:/devarea/marketlab/bl-esw-pinbar-market-lab.pine`（计算区 + 状态面板）
- Modify: `F:/devarea/marketlab/scripts/verify-pine-equivalence.mjs`
- Modify: `F:/devarea/marketlab/src/test/pine-equivalence.test.js`

- [ ] **Step 1：在测试里追加 match_pct 断言**

在 `src/test/pine-equivalence.test.js`：
```js
import { deviationScore } from '../domain/formulas/options.js'
import { normalCdf } from '../domain/formulas/probability.js'

// 在 describe 块内追加：
    it('match_pct 差异 < 0.50%', () => {
      const dev = deviationScore({
        costDistance: jsRef.costDistance,
        annualVol: jsRef.annualVol,
        holdingDays: 30,
        tradingDaysPerYear: 365,
      })
      const zAbs = Math.abs(dev.z)
      const matchJs = zAbs >= 8 ? 1 : Math.max(0, Math.min(1, 2 * normalCdf(zAbs) - 1))
      expect(rel(pine.match_pct, matchJs)).toBeLessThan(0.005)
    })
```

- [ ] **Step 2：跑测试确认失败**

```bash
pnpm vitest run src/test/pine-equivalence.test.js
```
预期：`match_pct` 失败（双胞胎还没实现）。

- [ ] **Step 3：在 Pine 计算区追加（紧跟 `z_strength = ...` 那行后面）**

```pine
norm_cdf_abs(x) =>
    a1 =  0.254829592
    a2 = -0.284496736
    a3 =  1.421413741
    a4 = -1.453152027
    a5 =  1.061405429
    p  =  0.3275911
    sign_x = x >= 0 ? 1.0 : -1.0
    abs_x = math.abs(x)
    t = 1.0 / (1.0 + p * abs_x)
    y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * math.exp(-abs_x * abs_x)
    0.5 * (1.0 + sign_x * y)

phi_z = norm_cdf_abs(z_abs / math.sqrt(2.0))
match_pct = z_abs >= 8.0 ? 1.0 : math.max(0.0, math.min(1.0, 2.0 * phi_z - 1.0))
```

- [ ] **Step 4：在 Pine 输入区追加 show_match_row**

```pine
show_match_row = input.bool(true, "Show Match Row", group=grp_lab)
```

- [ ] **Step 5：状态面板表格扩到 10 行**

把 `var table lab_table = table.new(position.top_right, 2, 9, border_width=1)` 改为 `2, 10`。

在 Position 行（行索引 1）之后插入 Match 行（行索引 2）：
```pine
    if show_match_row
        table.cell(lab_table, 0, 2, "Match", text_color=color.black, bgcolor=color.white)
        table.cell(lab_table, 1, 2, str.tostring(match_pct * 100, "#") + "%", text_color=color.black, bgcolor=color.white)
```

把后面的 State / Cost Dev / Z / Ann Vol / ATR% / Cost / Reason 全部行索引 +1（从 3 起到 9）：
```pine
    table.cell(lab_table, 0, 3, "State", ...)
    table.cell(lab_table, 1, 3, lab_state, ...)
    ...
    table.cell(lab_table, 0, 9, "Reason", ...)
    table.cell(lab_table, 1, 9, lab_reason, ...)
```

- [ ] **Step 6：同步 JS 双胞胎**

在 `scripts/verify-pine-equivalence.mjs` 的 `pineEquivalent` 里 return 之前追加：
```js
  // Abramowitz 7.1.26 erf 近似
  const normCdfAbs = (x) => {
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741
    const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911
    const signX = x >= 0 ? 1 : -1
    const absX = Math.abs(x)
    const t = 1 / (1 + p * absX)
    const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX)
    return 0.5 * (1 + signX * y)
  }
  const z_abs = Math.abs(z_score)
  const phi_z = normCdfAbs(z_abs / Math.sqrt(2))
  const match_pct = z_abs >= 8 ? 1 : Math.max(0, Math.min(1, 2 * phi_z - 1))
```
把 `match_pct` 加到 return 对象。

- [ ] **Step 7：跑测试**

```bash
pnpm vitest run src/test/pine-equivalence.test.js
```
预期：4 fixture × 7 条断言全 PASS。

- [ ] **Step 8：跑 verify-pine**

```bash
pnpm run verify:pine
```

- [ ] **Step 9：commit**

```bash
git add bl-esw-pinbar-market-lab.pine scripts/verify-pine-equivalence.mjs src/test/pine-equivalence.test.js
git commit -m "feat(pine): add match_pct (double-tail normal cdf via Abramowitz erf)"
```

---

## Task 10：auto_adapt 默认 false + 扩展标签清晰化

**Files:**
- Modify: `F:/devarea/marketlab/bl-esw-pinbar-market-lab.pine` 第 24-27 行 + 第 279 行

- [ ] **Step 1：把扩展开关默认值与标题改清楚**

把 Pine 第 24-27 行：
```pine
adaptive_cost = input.bool(false, "Adaptive Cost (Pine ext, off=JS aligned)", group=grp_lab)
auto_adapt = input.bool(true, "Auto Adapt Profile (Pine ext)", group=grp_lab)
relax_mode = input.bool(false, "Relax Mode (Pine ext)", group=grp_lab)
```
改为：
```pine
adaptive_cost = input.bool(false, "Adaptive Cost (extension, OFF=site aligned)", group=grp_lab)
auto_adapt = input.bool(false, "Auto Adapt Profile (extension, OFF=site aligned)", group=grp_lab)
relax_mode = input.bool(false, "Relax Mode (extension, OFF=site aligned)", group=grp_lab)
```

- [ ] **Step 2：把状态面板里的 Profile 标签改清楚**

找到第 279 行：
```pine
    table.cell(lab_table, 1, 0, active_profile + (auto_adapt ? "*" : "") + (relax_mode ? " (R)" : ""), text_color=color.white, bgcolor=color.black)
```
改为：
```pine
    profile_label = active_profile + " (auto: " + (auto_adapt ? "on" : "off") + (relax_mode ? ", relax" : "") + ")"
    table.cell(lab_table, 1, 0, profile_label, text_color=color.white, bgcolor=color.black)
```

- [ ] **Step 3：跑 verify-pine**

```bash
pnpm run verify:pine
```

- [ ] **Step 4：跑 vitest（默认 inputs 在 JS 双胞胎里 auto_adapt 已经是 false，应继续全绿）**

```bash
pnpm vitest run src/test/pine-equivalence.test.js
```

- [ ] **Step 5：commit**

```bash
git add bl-esw-pinbar-market-lab.pine
git commit -m "fix(pine): auto_adapt defaults to off, profile label exposes auto/relax state"
```

---

## Task 11：强化 verify-pine.mjs 与 verify-pine.ps1 文本检查

**Files:**
- Modify: `F:/devarea/marketlab/scripts/verify-pine.mjs`
- Modify: `F:/devarea/marketlab/scripts/verify-pine.ps1`

- [ ] **Step 1：改 verify-pine.mjs 加新断言**

在 `scripts/verify-pine.mjs` 的 `if (errors.length)` 之前追加：

```js
// 默认对齐网站：扩展开关默认 false
if (!/auto_adapt\s*=\s*input\.bool\(false,/.test(content)) {
  errors.push('auto_adapt must default to false to align with JS')
}
if (!/adaptive_cost\s*=\s*input\.bool\(false,/.test(content)) {
  errors.push('adaptive_cost must default to false to align with JS')
}
if (!/relax_mode\s*=\s*input\.bool\(false,/.test(content)) {
  errors.push('relax_mode must default to false to align with JS')
}

// stdev 必须用 sample 模式（biased=false）
const stdevCalls = [...content.matchAll(/ta\.stdev\(([^)]*)\)/g)]
for (const call of stdevCalls) {
  const args = call[1].split(',').map((s) => s.trim())
  if (args.length < 3 || args[2] !== 'false') {
    errors.push(`ta.stdev must pass biased=false third arg: ta.stdev(${call[1]})`)
  }
}

// 禁止 ta.atr( 直接调用（必须用自实现 simple-mean ATR）
if (/ta\.atr\(/.test(content)) {
  errors.push('Do not call ta.atr directly; use simple-mean ATR via ta.sma(true_range, 14) to align with JS')
}

// 必须存在的对齐变量
for (const v of ['lp_lower', 'lp_upper', 'position_label', 'match_pct']) {
  if (!new RegExp(`(^|\\s)${v}\\s*=`, 'm').test(content)) {
    errors.push(`Missing alignment variable: ${v}`)
  }
}
```

- [ ] **Step 2：改 verify-pine.ps1 镜像同样的检查**

在 `scripts/verify-pine.ps1` 的 `if ($errors.Count -gt 0)` 之前追加：

```powershell
if ($content -notmatch 'auto_adapt\s*=\s*input\.bool\(false,') {
  $errors.Add("auto_adapt must default to false to align with JS")
}
if ($content -notmatch 'adaptive_cost\s*=\s*input\.bool\(false,') {
  $errors.Add("adaptive_cost must default to false to align with JS")
}
if ($content -notmatch 'relax_mode\s*=\s*input\.bool\(false,') {
  $errors.Add("relax_mode must default to false to align with JS")
}

$stdevMatches = [regex]::Matches($content, 'ta\.stdev\(([^)]*)\)')
foreach ($m in $stdevMatches) {
  $args = $m.Groups[1].Value -split ',' | ForEach-Object { $_.Trim() }
  if ($args.Count -lt 3 -or $args[2] -ne 'false') {
    $errors.Add("ta.stdev must pass biased=false third arg: ta.stdev($($m.Groups[1].Value))")
  }
}

if ($content -match 'ta\.atr\(') {
  $errors.Add("Do not call ta.atr directly; use simple-mean ATR via ta.sma(true_range, 14)")
}

foreach ($v in @('lp_lower', 'lp_upper', 'position_label', 'match_pct')) {
  if ($content -notmatch "(?m)(^|\s)$v\s*=") {
    $errors.Add("Missing alignment variable: $v")
  }
}
```

- [ ] **Step 3：跑 verify-pine.mjs**

```bash
pnpm run verify:pine
```
预期：通过（前面所有改动都已经满足新增断言）。

- [ ] **Step 4：跑 verify-pine.ps1（PowerShell）**

```powershell
pwsh F:/devarea/marketlab/scripts/verify-pine.ps1
```
预期：`Pine static checks passed`。如果 Windows 没有 `pwsh`，也可以跑 `powershell -File F:/devarea/marketlab/scripts/verify-pine.ps1`。

- [ ] **Step 5：commit**

```bash
git add scripts/verify-pine.mjs scripts/verify-pine.ps1
git commit -m "test: enforce alignment via verify-pine static checks (stdev, atr, defaults, vars)"
```

---

## Task 12：package.json 加 verify:pine-equivalence script

**Files:**
- Modify: `F:/devarea/marketlab/package.json`

- [ ] **Step 1：改 package.json**

把 `"verify:pine"` 那行：
```json
"verify:pine": "node scripts/verify-pine.mjs",
```
改为：
```json
"verify:pine": "node scripts/verify-pine.mjs && pnpm run verify:pine-equivalence",
"verify:pine-equivalence": "vitest run src/test/pine-equivalence.test.js",
```

注意 JSON 顺序：把新行加在 `verify:pine` 下面、`check:data` 上面。

- [ ] **Step 2：跑完整链路**

```bash
pnpm run verify:pine
```
预期：先跑 mjs 文本检查，再跑 vitest 数值断言，全绿。

- [ ] **Step 3：跑全量测试确认没有副作用**

```bash
pnpm test
```
预期：原有测试 + 新增 pine-equivalence 测试全 PASS。

- [ ] **Step 4：commit**

```bash
git add package.json
git commit -m "build: chain verify:pine-equivalence into verify:pine"
```

---

## Task 13：写 pine-alignment.md 凭证文档

**Files:**
- Create: `F:/devarea/marketlab/docs/formula-evidence/pine-alignment.md`

- [ ] **Step 1：写文档**

`docs/formula-evidence/pine-alignment.md`：

```markdown
# Pine ↔ 网站 数值对齐凭证

> 真相源：`src/domain/**`（Vue 项目工作台）
> 对齐文件：`bl-esw-pinbar-market-lab.pine`
> 自动断言：`src/test/pine-equivalence.test.js`
> 双胞胎 JS：`scripts/verify-pine-equivalence.mjs`

## 1. 默认配置一致性

| 项目 | Pine 默认 | JS 默认（src/domain） | 一致性 |
|------|-----------|------------------------|---------|
| `cost_len` | 60 | `deriveWindows(n=500+).cost = 60` | ✓ |
| `recent_len` | 20 | `deriveWindows(n=500+).recent = 20` | ✓ |
| `vol_len` | 60 | `deriveWindows(n=500+).vol = 60` | ✓ |
| `holding_days` | 30 | `holdingDays` UI 默认 30 | ✓ |
| `trading_days` | 365 | `tradingDaysPerYear` 默认 365 | ✓ |
| `target_return_pct` | 30 | `getDeltaBands.targetReturn` 默认 0.30 | ✓ |
| `lp_range_width` | 0.10 | `formulaPath.rangeWidth` 默认 0.10 | ✓ |
| `lp_skew` | 1.0 | `formulaPath.skew` 默认 1.0 | ✓ |
| `auto_adapt` | **false** | JS 不切档 | ✓ |
| `relax_mode` | false | JS 没有 | ✓ |
| `adaptive_cost` | false | JS 用单一 cost 锚 | ✓ |

## 2. 公式对齐节点

| Pine 节点 | JS 真相源 | 对齐方式 |
|-----------|-----------|----------|
| `cost_anchor` | `weightedTypicalCost(rows)` in `cost.js` | 同公式（typical price × volume / Σvolume） |
| `cost_low / cost_high` | `rollingCost.lower/upper` in `cost.js` | 同 `bandWidth` 公式 + sample stdev |
| `lp_lower / lp_upper` | `lpLower / lpUpper` in `formulaPath.js` | 同 `costAnchor × (1 ± rangeWidth × skew)` |
| `annual_vol` | `annualVol` in `cost.js` | sample stdev × √trading_days |
| `atr_pct` | `atrPercent` in `cost.js` | simple-mean of 14 TR / close |
| `long_cost / long_high / long_low` | `getDeltaBands.long.*` in `options.js` | 同 wave 公式（z=1 隐含） |
| `z_score` | `deviationScore.z` in `options.js` | 同 cost_distance / period_vol |
| `match_pct` | `2·Φ(|z|) - 1` 用 `normalCdf` | Pine 用 Abramowitz 7.1.26 erf 近似 |
| `position_label` | `orderPlan.js` 状态字符串 | "高于成本带" / "低于成本带" / "成本带内" |

## 3. 容差表（自动断言）

| 指标 | 容差（相对） | 来源 |
|------|--------------|------|
| `cost_anchor` | < 0.05% | 浮点累加顺序 |
| `cost_low / cost_high` | < 0.10% | stdev 累积浮点误差 |
| `lp_lower / lp_upper` | < 0.05% | 同 cost_anchor |
| `annual_vol` | < 0.20% | sample stdev 浮点误差 |
| `atr_pct` | < 0.30% | TR 序列首尾边界差异 |
| `match_pct` | < 0.50% | Abramowitz 近似 ~7.5e-8 + z_score 累积误差 |
| `long_cost / long_high / long_low` | < 0.30% | 受 annual_vol 传递影响 |

## 4. 已知偏差（可接受范围内）

- 前 60 根 K 线（cost_len 窗口未填满）：Pine 输出 `na`，JS 在 `returnBasis < 5` 时 fallback 全历史，本轮接受
- `volume <= 0`（如指数）：JS 回退等权 typical；Pine `cost_main_anchor_raw` 在 `not has_volume` 时降级到 `ta.sma`，行为对齐
- `wave >= 1`（极高波动）：JS `getDeltaBands` 返回 null；Pine `delta_ok = false`，画线为 na

## 5. 扩展开关启用后的偏离方向

| 开关 | 启用后 | 偏离方向 |
|------|--------|----------|
| `auto_adapt` | profile 按 `annual_vol_ratio` 自动切换 | `min_edge / cost_slope_threshold` 在波动率分位数 > 1.25 或 < 0.80 时偏离 JS |
| `relax_mode` | edge_sigma × 0.65、momentum_sigma -0.30、cost_slope_sigma × 0.75 | 信号触发更宽松，**JS 没有等价开关，启用即明确偏离** |
| `adaptive_cost` | cost_fast × 0.35 + cost_main × 0.45 + cost_slow × 0.20 | `cost_anchor` 在三档差异大时偏离 JS 单档；`cost_low/high` 同步偏离 |

## 6. 维护契约

任何修改 `bl-esw-pinbar-market-lab.pine` 计算公式的 PR 必须：

1. 跑 `pnpm run verify:pine` 全绿（包含文本检查 + 数值断言）
2. 同步修改 `scripts/verify-pine-equivalence.mjs` 中的 JS 双胞胎
3. 在 PR 描述里附 TradingView GOOG 1D 截图，对照 `0xff.tools` 网站工作台同标的，证明 `Cost / Ann Vol / ATR% / Position / Match / State / LP Range` 视觉一致
4. 如果引入新的容差，更新本文件 §3 表
```

- [ ] **Step 2：commit**

```bash
git add docs/formula-evidence/pine-alignment.md
git commit -m "docs: add pine ↔ website alignment evidence"
```

---

## Task 14：人工 TradingView 验证 + 截图

**Files:**
- 无文件改动；产出 PR 描述用的截图

- [ ] **Step 1：复制 Pine 源到 TradingView**

打开 `F:/devarea/marketlab/bl-esw-pinbar-market-lab.pine`，全选复制，粘到 TradingView Pine Editor，点 "Add to chart" 应用到 GOOG 1D 图表。

- [ ] **Step 2：打开 0xff.tools GOOG 工作台**

浏览器访问 `https://www.0xff.tools/`，左侧选 GOOG。

- [ ] **Step 3：并排对照 7 个关键值**

| 指标 | 网站 | TradingView | 容差内？ |
|------|------|-------------|----------|
| Cost (成本锚) | __ | __ | __ |
| Ann Vol | __ | __ | __ |
| ATR% | __ | __ | __ |
| Position | __ | __ | __ |
| Match | __ | __ | __ |
| State | __ | __ | __ |
| LP Range Low / High | __ | __ | __ |

把这个表填好作为 PR 描述的一部分。

- [ ] **Step 4：截图存档**

- 截图 1：网站 GOOG 工作台（含状态面板 + 价格线）
- 截图 2：TradingView GOOG 1D 应用 Pine 后（含右上 Market Lab 表格 + 价格线）

存到 `docs/formula-evidence/screenshots/2026-05-22-goog-alignment-website.png` 和 `2026-05-22-goog-alignment-tv.png`。

- [ ] **Step 5：如有差异超过容差**

回 Task 4 / 5 / 6 / 7 / 9 排查 JS 双胞胎是否漏抄了某行 Pine 逻辑；不要改 Pine 公式去就网站，因为 JS 真相源是基准。

- [ ] **Step 6：开 PR**

```bash
git push -u origin feature/pine-website-alignment
gh pr create --title "feat(pine): align bl-esw-pinbar-market-lab.pine with 0xff.tools website" --body "$(cat <<'EOF'
## Summary
- Default-aligned Pine indicator with JS source of truth (src/domain/**)
- Fixed sample stdev (n-1) and simple-mean ATR(14)
- Added LP Range / Position / Match cells in status panel
- Pine extensions (auto_adapt / relax_mode / adaptive_cost) all default OFF, labeled "OFF=site aligned"
- New JS twin + Vitest assertions enforce 7 numeric tolerances across 4 fixtures (GOOG/AAPL/600519/BTCUSDT)
- Strengthened verify-pine.mjs to reject regressions

## Spec
docs/superpowers/specs/2026-05-22-pine-website-alignment-design-cc.md

## Test plan
- [x] pnpm run verify:pine passes (static checks + numeric assertions)
- [x] pnpm test all green
- [x] TradingView GOOG 1D vs 0xff.tools GOOG: 7 metrics within tolerance (screenshots attached)
- [x] docs/formula-evidence/pine-alignment.md created

EOF
)"
```

---

## 自检清单（计划作者自查）

- [x] §1（背景）：Task 3 用失败断言验证分歧确实存在
- [x] §2 改造目标 1（默认值一致）：Task 4-9 全覆盖
- [x] §2 改造目标 2（扩展默认 false）：Task 10
- [x] §2 改造目标 3（LP / Position / Match 可视化）：Task 7-9
- [x] §2 改造目标 4（自动数值断言）：Task 3-9 + Task 11-12
- [x] §3 不在范围内：明确不动 cdx Pine 与 src/domain
- [x] §4.1 修改文件：Task 4-12 全覆盖
- [x] §4.2 新增文件：loadCsv/verify-pine-equivalence/pine-equivalence.test/pine-alignment.md 各有对应 task
- [x] §5.1 输入参数变更：Task 7（lp_*）、Task 8（show_position_row）、Task 9（show_match_row）、Task 10（默认值）
- [x] §5.2 计算块改动 1（sample stdev）：Task 4
- [x] §5.2 计算块改动 2（simple-mean ATR）：Task 5
- [x] §5.2 计算块改动 3（LP）：Task 7
- [x] §5.2 计算块改动 4（Position）：Task 8
- [x] §5.2 计算块改动 5（match_pct）：Task 9
- [x] §5.2 计算块改动 6（profile_label）：Task 10
- [x] §5.3 LP 绘图：Task 7 Step 5
- [x] §5.4 状态面板 10 行：Task 8 + Task 9
- [x] §6 容差表：Task 3-9 中每个断言都对齐 §6 表中数值
- [x] §7 NaN 边界：Task 2 双胞胎里 `cost_distance > 0` 守卫，`wave < 1` 守卫；Pine 已有
- [x] §8.1 自动化：Task 1-12
- [x] §8.2 人工 SOP：Task 14
- [x] §9 实施顺序：Task 编号与 spec §9 步骤一致
- [x] §10 风险：每个高风险点都有缓解（容差测试覆盖、PR SOP 截图）
- [x] §11 验收：Task 14 Step 6 的 PR 描述涵盖全部 7 项验收标准
- [x] §12 后续工作：cdx Pine 与 IV 输入框未在本计划中实现，明确留给后续
