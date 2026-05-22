# Pine ↔ 网站 数值对齐改造方案

- 状态：草案，待 review
- 提交日期：2026-05-22
- 涉及分支：`feature/pine-website-alignment`
- 目标读者：marketlab 维护者

## 1. 背景

`0xff.tools` 网站（src/domain/**）与 TradingView 指标 `bl-esw-pinbar-market-lab.pine` 在同一只标的上显示出不一致的关键价格线与状态：

| 指标 | 网站 | TradingView | 差异 |
|------|------|-------------|------|
| 现价 | 384.9 | 383.47 | 0.37%（数据时点） |
| 成本（成本锚 / Cost） | 328.82 | 329.91 | 0.33% |
| 波动率口径 | IV 33.5% | Ann Vol 39.96% | 不同维度 |
| 状态文案 | 高于成本带 / 均衡 / 匹配 86% | Trim / `Balanced*` | 不同维度 |
| LP 区间上下沿 | 361.71 / 295.94 | 不绘制 | TV 缺失 |

通过对比 `bl-esw-pinbar-market-lab.pine` 与 `src/domain/market-data/cost.js`、`src/domain/formulas/options.js`、`src/domain/strategy-planning/orderPlan.js`，定位到差异来源：

1. **Pine 私有扩展默认开启**：`auto_adapt = input.bool(true, ...)` 默认会按 `annual_vol_ratio` 自动切换 profile，JS 不会
2. **`ta.stdev` 用总体方差（n）**，JS 用样本方差（n-1）
3. **`ta.atr(14)` 用 Wilder RMA 平滑**，JS 用 14 期算术平均
4. **Pine 没绘制 LP 区间**（网站独有的 `lpLower / lpUpper`）
5. **状态面板只展示动作（Trim）**，缺位置态（高于/低于成本带）和 `match_pct`

## 2. 改造目标

1. 默认配置下，Pine 与网站在同一只标的、同一份 OHLCV 上输出**完全一致**的关键数值（容差见 §6）
2. Pine 私有扩展（`auto_adapt`、`relax_mode`、`adaptive_cost`）保留为可选，但**默认全部关闭**，且在 UI 上明确标注"开启即偏离网站"
3. Pine 端可视化补齐 `LP 区间` 与 `Position / Match` 两条状态信息，对齐网站语义
4. 建立**自动数值断言机制**，防止后续单边修改导致再次分叉

## 3. 不在范围内（Out of Scope）

- 不动 `bl-esw-pinbar-market-lab-cdx.pine`（Codex 实验线，本轮主线稳定后再同步）
- 不动 `src/domain/**`（JS 是真相源，本轮一切对齐均向 JS 靠拢）
- 不重构现有 5 类核心信号（Low Buy / Wait Stop / Deep Discount / Trim / No Chase）
- 不引入 Pine 端的 IV 数据源（IV 由用户在网站手动输入，Pine 维持用 `annual_vol` 推导 GetDelta 的口径）

## 4. 架构与文件影响

### 4.1 修改文件
- `bl-esw-pinbar-market-lab.pine`：核心改造（约 +60 行净增）
- `scripts/verify-pine.mjs`：增加文本结构检查项
- `package.json`：新增 `verify:pine-equivalence` script，并入 `verify:pine`

### 4.2 新增文件
- `scripts/verify-pine-equivalence.mjs`：JS 双胞胎实现 + 数值对比脚本（CLI 和模块双用途）
- `src/test/pine-equivalence.test.js`：Vitest，跑固定 OHLCV 样本，比对 JS 真相源 vs Pine 双胞胎
- `src/test/helpers/loadCsv.js`：CSV 加载器，复用 `d3-dsv` 解析 `public/data/*.csv`
- `docs/formula-evidence/pine-alignment.md`：每个 Pine 节点的对齐凭证、容差、扩展启用偏离方向

### 4.3 不动
- `src/domain/**`、`src/components/**`、`src/stores/**`、`src/composables/**`
- `bl-esw-pinbar-market-lab-cdx.pine`

## 5. Pine 输入与计算块改动

### 5.1 输入参数

| 参数 | 当前 | 新值 | 说明 |
|------|------|------|------|
| `auto_adapt` | `true` | **`false`** | 关闭自动切档，对齐 JS |
| `relax_mode` | `false` | `false` | 不变 |
| `adaptive_cost` | `false` | `false` | 不变 |
| `target_return_pct` | `30.0` | `30.0` | 不变 |
| `lp_range_width` | — | `0.10` | **新增**，对齐 JS `rangeWidth` 默认 |
| `lp_skew` | — | `1.0` | **新增**，对齐 JS `skew` 默认 |
| `show_lp_band` | — | `true` | **新增**，LP 区间可视化开关 |
| `show_position_row` | — | `true` | **新增**，状态面板 Position 行 |
| `show_match_row` | — | `true` | **新增**，状态面板 Match 行 |

三个扩展开关的标题改为：
```
"Auto Adapt Profile (extension, OFF=site aligned)"
"Relax Mode (extension, OFF=site aligned)"
"Adaptive Cost (extension, OFF=site aligned)"
```

### 5.2 计算块改动

**改动 1：sample stdev（对齐 JS `standardDeviation`）**
```pine
annual_vol_raw = ta.stdev(log_ret, vol_len, false) * math.sqrt(trading_days)
vol_estimate   = ta.stdev(log_ret, cost_len, false) * math.sqrt(math.min(recent_len, cost_len))
```

**改动 2：simple-mean ATR（对齐 JS `average(trueRanges)`）**
```pine
true_range = math.max(high - low, math.max(math.abs(high - close[1]), math.abs(low - close[1])))
atr_14     = ta.sma(true_range, 14)
atr_pct    = close > 0 ? atr_14 / close : 0.0
```

**改动 3：LP 区间**
```pine
lp_lower = cost_anchor * math.max(1 - lp_range_width, 0.001)
lp_upper = cost_anchor * (1 + lp_range_width * lp_skew)
```

**改动 4：Position 三态**
```pine
position_label = close > cost_high ? "高于成本带" : close < cost_low ? "低于成本带" : "成本带内"
```

**改动 5：match_pct（双尾正态，Abramowitz 7.1.26 近似 erf）**
```pine
norm_cdf_abs(x) =>
    a1 =  0.254829592, a2 = -0.284496736, a3 =  1.421413741
    a4 = -1.453152027, a5 =  1.061405429, p  =  0.3275911
    sign_x = x >= 0 ? 1.0 : -1.0
    abs_x  = math.abs(x)
    t = 1.0 / (1.0 + p * abs_x)
    y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * math.exp(-abs_x * abs_x)
    0.5 * (1.0 + sign_x * y)

phi_z     = norm_cdf_abs(z_abs / math.sqrt(2.0))
match_pct = z_abs >= 8.0 ? 1.0 : math.max(0.0, math.min(1.0, 2.0 * phi_z - 1.0))
```

**改动 6：Profile 标识更明确**
```pine
profile_label = active_profile + " (auto: " + (auto_adapt ? "on" : "off") + (relax_mode ? ", relax" : "") + ")"
```

### 5.3 LP 绘图

```pine
plot(show_lab and show_lp_band ? lp_lower : na, title="LP Range Low",
     color=color.new(#a855f7, 40), linewidth=1, style=plot.style_circles)
plot(show_lab and show_lp_band ? lp_upper : na, title="LP Range High",
     color=color.new(#a855f7, 40), linewidth=1, style=plot.style_circles)
```

紫色虚线圆点，与 cost band 的实线、GetDelta band 的细实线形成层次。

### 5.4 状态面板（10 行）

示意（具体数值依实际行情而定，仅展示格式与字段）：

```
Market Lab           Balanced (auto: off)
Position             高于成本带                    ← 新增
Match                86%                          ← 新增
State                Trim
Cost Dev             16.24%
Z (T=30d)            1.42σ · 中
Ann Vol              39.96%       ← 历史年化波动率（sample stdev 修正后），不是网站 GetDelta 输入框的 IV
ATR%                 2.55%        ← simple-mean ATR 修正后
Cost                 328.82       ← VWAP 成本锚，应与网站完全一致
Reason               Premium + 溢价边际达标
```

注意：网站工作台底部的 `IV 33.5%` 是用户在 GetDelta 输入框手动设置的隐含波动率，与 Pine 这里展示的 `Ann Vol`（历史年化）属于不同维度。本方案不在 Pine 引入 IV 输入框，只保证 `Ann Vol` 的计算口径与 JS `buildMarketState` 一致。

`Position` 与 `Match` 两行受 `show_position_row` / `show_match_row` 控制；关闭后回到 8 行旧布局。

## 6. 容差表

测试断言基于 GOOG / AAPL / 600519 / BTCUSDT 四份固定 OHLCV 样本，数据 ≥ 500 根 K 线。

| 指标 | 期望差异（相对） | 来源 |
|------|--------------------|------|
| `cost_anchor` | < 0.05% | 浮点累加顺序 |
| `cost_low / cost_high` | < 0.10% | stdev 累积浮点误差 |
| `lp_lower / lp_upper` | < 0.05% | 同 cost_anchor |
| `annual_vol` | < 0.20% | sample stdev 浮点误差 |
| `atr_pct` | < 0.30% | TR 序列首尾边界差异 |
| `match_pct` | < 0.50% | Abramowitz 近似误差 + z_score 累积误差 |
| `long_cost / long_high / long_low` | < 0.30% | 受 annual_vol 传递影响 |
| 前 60 根 K 线 | 不强制对齐 | 窗口未填满阶段 |

容差超过则 CI 失败；容差内的偏差必须在 `pine-alignment.md` 记录来源。

## 7. NaN / 边界处理

- 所有除法用 `nz()` 或显式 `> 0` 守卫
- `wave >= 1` → GetDelta 全部 `na`，与 JS `getDeltaBands` 返回 `null` 等价
- `volume <= 0` → cost_anchor 回退到 `ta.sma(typical_price, ...)`（已实现）
- 前 N 根 K 线（窗口未填满）→ Pine 输出 `na`，JS 在 `returnBasis < 5` 时 fallback 全历史，本轮接受这一已知偏差，记入 §6 表

## 8. 测试与验证机制

### 8.1 自动化

**`scripts/verify-pine-equivalence.mjs`**：JS 双胞胎，逐行镜像 Pine 计算逻辑

```js
export function pineEquivalent(rows, inputs = {}) {
  const opts = {
    cost_len: 60, recent_len: 20, vol_len: 60,
    holding_days: 30, trading_days: 365,
    target_return_pct: 30,
    lp_range_width: 0.10, lp_skew: 1.0,
    profile: 'Balanced',
    auto_adapt: false, relax_mode: false, adaptive_cost: false,
    ...inputs,
  }
  // 计算 cost_anchor / cost_low / cost_high / lp_lower / lp_upper /
  //     annual_vol / atr_pct / z_score / match_pct /
  //     long_cost / long_high / long_low
  return { ... }
}
```

**`src/test/pine-equivalence.test.js`**：

`computeJsReference(rows)` 内部调用：`buildMarketState(rows, 365)` 拿 `costAnchor / costLow / costHigh / annualVol / atrPercent / costDistance`；`getDeltaBands({ entryPrice: lastClose, holdingDays: 30, iv: annualVol, targetReturn: 0.30 })` 拿 `long.cost / long.high / long.low`；`deviationScore({ costDistance, annualVol, holdingDays: 30 })` 拿 `z`；并以 `2 * normalCdf(|z|) - 1` 计算 `matchPct`；`lpLower/lpUpper` 用 `costAnchor * (1 ± rangeWidth × skew)`（`rangeWidth=0.10, skew=1.0`，与 `formulaPath.js` 默认值一致）。返回扁平结果对象。

```js
const fixtures = ['GOOG', 'AAPL', '600519', 'BTCUSDT']
for (const symbol of fixtures) {
  describe(`Pine ↔ JS alignment: ${symbol}`, () => {
    const rows  = loadCsv(`public/data/${symbol}.csv`)
    const jsRef = computeJsReference(rows)
    const pine  = pineEquivalent(rows)
    const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-9)
    it('cost_anchor 差异 < 0.05%', () => expect(rel(pine.cost_anchor, jsRef.costAnchor)).toBeLessThan(0.0005))
    it('cost_low/high 差异 < 0.10%', () => {
      expect(rel(pine.cost_low, jsRef.costLow)).toBeLessThan(0.001)
      expect(rel(pine.cost_high, jsRef.costHigh)).toBeLessThan(0.001)
    })
    it('lp range 差异 < 0.05%', () => {
      expect(rel(pine.lp_lower, jsRef.lpLower)).toBeLessThan(0.0005)
      expect(rel(pine.lp_upper, jsRef.lpUpper)).toBeLessThan(0.0005)
    })
    it('annual_vol 差异 < 0.20%', () => expect(rel(pine.annual_vol, jsRef.annualVol)).toBeLessThan(0.002))
    it('atr_pct 差异 < 0.30%', () => expect(rel(pine.atr_pct, jsRef.atrPercent)).toBeLessThan(0.003))
    it('match_pct 差异 < 0.50%', () => expect(rel(pine.match_pct, jsRef.matchPct)).toBeLessThan(0.005))
    it('GetDelta long band 差异 < 0.30%', () => {
      expect(rel(pine.long_cost, jsRef.longCost)).toBeLessThan(0.003)
      expect(rel(pine.long_high, jsRef.longHigh)).toBeLessThan(0.003)
      expect(rel(pine.long_low,  jsRef.longLow)).toBeLessThan(0.003)
    })
  })
}
```

**`scripts/verify-pine.mjs` 加强**：
- 验证 `auto_adapt` / `relax_mode` / `adaptive_cost` 默认值是 `false`
- 验证所有 `ta.stdev` 调用都带 `false` 第三参数
- 验证 `lp_lower` / `lp_upper` / `position_label` / `match_pct` 变量存在
- 拒绝 `ta.atr(` 调用（必须用自实现 `atr_simple_14`）

**`package.json`**：
```json
{
  "verify:pine": "node scripts/verify-pine.mjs && pnpm run verify:pine-equivalence",
  "verify:pine-equivalence": "vitest run src/test/pine-equivalence.test.js"
}
```

### 8.2 人工验证 SOP（每次 Pine 改动 PR 必走）

1. 跑 `pnpm run verify:pine` 全绿
2. 把改动后的 Pine 粘到 TradingView GOOG 1D 图表
3. 对照 `0xff.tools` GOOG 工作台，确认 `Cost / Ann Vol / ATR% / Position / Match / State / LP Range` 全部一致或在容差内
4. 截图存档到 PR 描述

## 9. 实施顺序

1. 写 `verify-pine-equivalence.mjs`（JS 双胞胎，但**先按当前 Pine 镜像**——这一步会先证明"当前 Pine 与 JS 不一致"）
2. 写 `pine-equivalence.test.js`，跑出当前所有失败断言（确认问题真实存在）
3. 改 `bl-esw-pinbar-market-lab.pine`：先改默认值（`auto_adapt = false`）
4. 改 stdev 与 ATR 计算口径
5. 加 LP 区间、Position、Match 三块
6. 同步更新 `verify-pine-equivalence.mjs` 中的 JS 双胞胎，使其与新 Pine 镜像
7. 跑测试直到全绿
8. 加强 `verify-pine.mjs` 文本检查项
9. 写 `docs/formula-evidence/pine-alignment.md`
10. 人工 SOP 验证 + 截图
11. 提 PR

## 10. 风险与回退

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| Pine v6 `ta.stdev` 第三参数语法不兼容旧版本 | 低 | 高 | Pine 文件首行已声明 `//@version=6`，本身就是 v6 |
| Abramowitz 近似在 z 极端值（>5σ）失真 | 中 | 低 | `match_pct` 显示给用户的就是 0~100%，z>5 时几乎都是 100%，肉眼无差异 |
| JS 双胞胎与 Pine 实际行为偏离 | 高 | 中 | 强制 PR SOP 截图人工对照；新增 `pine-alignment.md` 列出每个节点容差与凭证 |
| 用户已经在 TV 配置了 `auto_adapt=true`，升级后默认值变了 | 中 | 低 | 在指标说明里明确标注"v2 起 `auto_adapt` 默认关，开启后偏离网站" |
| 现有 Pine 用户依赖 `ta.atr(14)` 的 Wilder 平滑视觉效果 | 低 | 低 | 改完后视觉差异极小；如反馈强烈可加开关 `use_wilder_atr`，本轮不加 |

回退路径：本次改造全部在一个 feature 分支，回退即 `git revert`；JS 真相源未动，回退不影响网站。

## 11. 验收标准

- [ ] `pnpm run verify:pine` 全绿
- [ ] 4 个标的 fixtures 的 Vitest 全绿
- [ ] GOOG 1D 在 TradingView 与 `0xff.tools` 工作台并排截图，数值一致或在 §6 容差内
- [ ] `bl-esw-pinbar-market-lab.pine` 行数控制在 380 行以内（当前 322，预算 +60）
- [ ] 状态面板 Position / Match 行可独立开关
- [ ] 所有扩展开关默认 false 且在 input title 中明确标注"OFF=site aligned"
- [ ] `docs/formula-evidence/pine-alignment.md` 已创建并包含每节点容差凭证

## 12. 后续工作（不在本轮）

- 把 cdx 版本（`bl-esw-pinbar-market-lab-cdx.pine`）按本方案重写
- 评估是否给 IV 加一个网站可手动注入的 `iv_override` 输入
- 评估是否把 `entry_price` 暴露为 input（当前默认 `close`）
