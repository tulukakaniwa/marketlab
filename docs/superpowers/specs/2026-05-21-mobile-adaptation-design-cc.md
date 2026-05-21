# Market Lab 移动端适配设计

**日期**：2026-05-21
**作者**：blarmer
**状态**：Design — pending review
**目标分支**：`feature/mobile-adaptation`

---

## 1. 背景与定位

Market Lab 当前是 desktop-first 的纯静态 Vue 3 工作台，主体由 5 列 CSS Grid 组成（左面板 + 拖宽条 + 主图 + 拖宽条 + 右面板），并有 38 个组件、5 个样式文件。它的 viewport meta 标签已设，但仅此而已：

- 主布局 5 列 grid 在 <768px 屏幕根本展不开
- 拖宽 resizer 只绑了 `mousedown/mousemove`，触屏完全不能用
- 散落 8 个组件 + 4 个 CSS 各自定义断点：`760 / 800 / 900 / 980 / 1050 / 1100` 共 6 套，毫无统一
- 已有 `narrowScreen = max-width: 900px` 信号，但只在打开一侧时收起另一侧，没有真正的移动端形态

### 1.1 移动端用户优先级

按使用概率排序（基于工作台属性推断）：

| 优先级 | 行为 |
|---|---|
| P0 | 看推荐池 / 看价格 |
| P1 | 看图表 |
| P2 | 切换标的 |
| P3 | 看公式带 / 看决策 |
| P4 | 调公式参数 / 复杂回放 / 拖宽 / 多面板对照 |

**核心定位**：移动端不是"压缩版桌面"，而是 **只读优先 + 关键操作可达** 的简化形态，保留 P0–P2，弱化或隐藏 P3–P4。

---

## 2. 设计原则

| 原则 | 说明 |
|---|---|
| **Desktop-first 延续** | 项目已有大量 `@media (max-width: ...)`，统一治理为新 token，不切换为 mobile-first（避免大规模 CSS 重写） |
| **DDD/MVVM 边界严守** | 仅改 UI 层（`src/components/*`、`src/styles/*`、`src/App.vue`）；不动 `src/domain/`、`src/stores/`、`scripts/` |
| **YAGNI 落地** | 不做 PWA、不做触屏拖宽、不做横竖屏特殊处理、不做独立移动端路由树 |
| **保留现有键盘隐藏入口** | `g+p` / `Alt+P` / `#pool` 入口不动，键盘流不影响移动端 |
| **现有窄屏策略不破坏** | App.vue 中 `narrowScreen` 信号继续可用，只是行为升级 |

---

## 3. 断点 token 治理

### 3.1 新增 token

写入 `src/styles/base.css` 的 `:root` 块：

```css
:root {
  /* ...既有 token... */
  --bp-mobile: 768px;
  --bp-tablet: 1024px;
  --bp-desktop: 1280px;
}
```

### 3.2 断点迁移映射

| 现状值 | 出现位置 | 迁移到 |
|---|---|---|
| 760px | FormulaChart, LiquidityFingerprintRack, LiquidityRackDepth, StockChipProfileOverlay | `--bp-mobile`（768） |
| 800px | TopBar | `--bp-mobile` |
| 900px | App.vue narrowScreen, MainChartHoverLegend, RecommendedPoolPage | `--bp-mobile` |
| 980px | decision.css | `--bp-tablet`（1024） |
| 1050px | base.css, chart.css | `--bp-tablet` |
| 1100px | TopBar | `--bp-tablet` |

> ⚠️ CSS 媒体查询不能直接消费 CSS 变量。token 用于文档与 JS（`window.matchMedia`）侧；CSS 文件中迁移成显式值 `768px / 1024px`，并在文件顶部加注释引用 token 名称。

### 3.3 JS 侧统一

`src/composables/useBreakpoint.js`（新增，约 30 行）：

```js
import { ref, onBeforeUnmount, onMounted } from 'vue'

const QUERIES = {
  mobile: '(max-width: 768px)',
  tablet: '(max-width: 1024px)',
}

export function useBreakpoint() {
  const isMobile = ref(false)
  const isTablet = ref(false)
  let mqMobile, mqTablet
  const sync = () => {
    isMobile.value = mqMobile?.matches ?? false
    isTablet.value = mqTablet?.matches ?? false
  }
  onMounted(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    mqMobile = window.matchMedia(QUERIES.mobile)
    mqTablet = window.matchMedia(QUERIES.tablet)
    mqMobile.addEventListener('change', sync)
    mqTablet.addEventListener('change', sync)
    sync()
  })
  onBeforeUnmount(() => {
    mqMobile?.removeEventListener('change', sync)
    mqTablet?.removeEventListener('change', sync)
  })
  return { isMobile, isTablet }
}
```

App.vue 用 `useBreakpoint().isMobile` 替换现有 `narrowScreen` 实现，保留对外语义。

---

## 4. 移动端形态（<768px）

### 4.1 布局对比

```
桌面（≥768px，保持不变）                Mobile（<768px，新形态）
┌─────────────────────────────┐         ┌─────────────────────┐
│ TopBar (full)               │         │ TopBar  ☰  ⋯       │
├──┬─────────────────┬────────┤         ├─────────────────────┤
│左│  MainChart      │ 右面板 │         │                     │
│面│                 │  标的  │         │   MainChart         │
│板│  + Hover Legend │  列表  │         │   60vh+             │
│  │                 │       │         │                     │
└──┴─────────────────┴────────┘         ├─────────────────────┤
                                         │ 选中信息条           │
                                         └─────────────────────┘
                                         点 ☰ → LeftPanel 全屏 drawer
                                         点 标的图标 → RightPanel 全屏 drawer
```

### 4.2 组件适配规则

#### 4.2.1 App.vue（主布局）

- **<768px**：
  - `cols` 不再用 5 列 grid，改为单列 `display: flex; flex-direction: column`
  - LeftPanel / RightPanel 脱离文档流，用 `position: fixed; inset: 0`，由 `lab.leftPanelOpen / rightPanelOpen` 控制 `transform: translateX(-100% / 0)` 滑入滑出
  - 加 backdrop（`position: fixed; inset: 0; background: rgba(0,0,0,0.4)`），点击 backdrop 关闭 drawer
  - 同时只允许一个 drawer 打开（保留现有 `narrowScreen + opening` 的互斥逻辑，断点改为 768）
- **≥768px**：保持当前 5 列 grid 不变

#### 4.2.2 TopBar.vue

- **<768px**：
  - 左侧：保留 logo + 标题 + 标的搜索入口
  - 中部：`narrative` 摘要继续 hide（已有逻辑）
  - 右侧：把"主题切换、重置、profile 切换、auto-profile 开关、决策置信度"这些次要项收进一个 `⋯` 溢出菜单（点开为下拉 / popover）
  - 新增：左上 `☰` 按钮触发 LeftPanel drawer，右上 标的图标 触发 RightPanel drawer
- **≥768px**：保持当前布局

#### 4.2.3 LeftPanel.vue / RightPanel.vue

- **<768px**：
  - 容器 100vw × 100vh，固定层级 `z-index: 50`
  - 顶部加关闭按钮（`✕`）
  - 内容区 `overflow-y: auto` 可滚动
  - `transform` 滑入动画 200ms ease
- **≥768px**：保持当前侧栏行为

#### 4.2.4 MainChart.vue

- **<768px**：
  - 容器高度由 `flex: 1`（等分剩余）改为 `min-height: 60vh`，让用户能向下滚到详情
  - 触屏 hover：tap 显示 legend，再 tap 别处隐藏（已有 `cursor-change` 事件，扩展 touchstart）
- **≥768px**：保持

#### 4.2.5 MainChartHoverLegend.vue

- **<768px**：从浮动 floater 改为 MainChart 下方固定条 `position: sticky; bottom: 0`
- **≥768px**：保持浮动

#### 4.2.6 RecommendedPoolPage.vue

- **<768px**：
  - 卡片由当前网格改为单列 stack
  - focus / wait 两组用 tab 切换而非并排
  - 已有 `@media (max-width: 900px)` 升级为 768
- **≥768px**：保持

#### 4.2.7 拖宽 resizer

- **<768px**：`display: none`
- **≥768px**：保持

#### 4.2.8 推迟到后续迭代（不在本次范围）

以下组件本身复杂度高、移动端可用性低，本次**不做内部布局适配**：

- ComputeDrawer / DecisionDrawer / FormulaDrawerContent / ReplayPanel / SettingsDrawer
- AdvancedSettingsContent / OptionPortfolioInputs / SimulationInputs / StrategyProfileInputs

**处理方式**：
- 这些组件作为 LeftPanel 内部 tab 内容时，在移动端 drawer 形态中**仍可访问**（用户切到对应 tab 仍能看到原桌面渲染），但不为它们做专门的窄屏样式
- LeftPanel 的 tab 栏（`activeLeftTab` 切换器）本身在移动端正常显示，仅 tab 内容不专门优化
- 后续迭代再针对每个高级面板做专门移动端形态

---

## 5. 受影响文件清单

| 文件 | 变更类型 | 估计行数 |
|---|---|---|
| `src/styles/base.css` | 加 token + 全局移动样式 + 断点迁移 | +50 / -10 |
| `src/styles/chart.css` | 断点迁移 | +5 / -5 |
| `src/styles/decision.css` | 断点迁移 | +3 / -3 |
| `src/composables/useBreakpoint.js` | 新增 | +30 |
| `src/App.vue` | drawer 模式切换 + 引入 useBreakpoint | +80 / -20 |
| `src/components/TopBar.vue` | 溢出菜单 + ☰ + 标的入口 | +60 / -10 |
| `src/components/LeftPanel.vue` | drawer 容器样式 | +30 / -5 |
| `src/components/RightPanel.vue` | drawer 容器样式 | +30 / -5 |
| `src/components/MainChart.vue` | 高度策略 + tap-to-show | +20 / -5 |
| `src/components/MainChartHoverLegend.vue` | 移动端固定条 | +15 / -3 |
| `src/components/RecommendedPoolPage.vue` | 单列 + tab + 断点迁移 | +40 / -10 |
| `src/components/FormulaChart.vue` | 断点迁移 | +2 / -2 |
| `src/components/LiquidityFingerprintRack.vue` | 断点迁移 | +2 / -2 |
| `src/components/LiquidityRackDepth.vue` | 断点迁移 | +2 / -2 |
| `src/components/StockChipProfileOverlay.vue` | 断点迁移 | +2 / -2 |

合计 **15 个文件**，约 +370 / -90 行。

---

## 6. 不做的事（YAGNI）

- ❌ PWA / Service Worker / 离线缓存
- ❌ 触屏拖宽 resizer（移动端用默认宽度）
- ❌ 横竖屏特殊处理（一套 viewport 自适应）
- ❌ 移动端独立路由树或独立组件副本
- ❌ 改 `src/domain/` 任何代码
- ❌ 改 `src/stores/` 任何 store schema（仅消费现有 state）
- ❌ 重写组件结构（只改 CSS + 容器布局 + 少量模板包裹）
- ❌ 移动端深度交互（拖拽、长按、手势导航）

---

## 7. 测试策略

### 7.1 自动化

- **现有 vitest 测试不应受影响**：`pnpm test` 全绿
- **不新增组件单测**：drawer 开关已经走的是现有 store 状态，行为没变；新增 `useBreakpoint` 是纯 wrapper，不值得单独单测
- **`pnpm run verify:domain` 仍通过**：domain 不动

### 7.2 手动验证

Chrome DevTools 三档屏宽：

| 设备/宽度 | 验证点 |
|---|---|
| iPhone 14 (393×852) | TopBar ☰ 触发左 drawer / 标的入口触发右 drawer / drawer 关闭按钮 / 主图 ≥60vh / hover legend 在底部 |
| iPad mini (768×1024) | 临界值，刚好 mobile/tablet 切换；确认 768 是 mobile，769 是桌面 |
| 桌面 1440px | 完全保持现有 5 列布局、拖宽、Hover Legend 浮动等行为不变 |

### 7.3 Pine 验证

`pnpm run verify:pine` 不需要跑（Pine 与 UI 无关）。

---

## 8. 实施分阶段

**阶段 1：地基**（先合入，单独 commit）
- 加 `--bp-*` token 到 base.css
- 新增 `useBreakpoint.js` composable
- 把所有 8 个组件 + 4 个 CSS 的零散断点迁移到 768/1024

**阶段 2：drawer 模式**
- App.vue 在 mobile 切换布局模式
- LeftPanel / RightPanel 加 drawer 样式与关闭按钮
- backdrop 与互斥逻辑

**阶段 3：TopBar 溢出菜单**
- ☰ 按钮 + 标的入口按钮
- 次要操作收纳到 ⋯ 菜单

**阶段 4：图表与推荐池**
- MainChart 高度策略
- HoverLegend 底部固定
- RecommendedPoolPage 单列 + tab

**阶段 5：手动验证 + 修补**
- DevTools 三档验证
- 修复 cosmetic 细节

每阶段一个 commit，最后整体一份 PR 合到 main。

---

## 9. 风险与权衡

| 风险 | 缓解 |
|---|---|
| 现有桌面行为受影响 | 严格用 `@media (max-width: 768px)` 包裹移动端样式，桌面路径不动 |
| 触屏 hover 体验差 | tap-to-show 走现有 `cursor-change` 事件，不引入新交互模型 |
| drawer 与现有 narrowScreen 逻辑冲突 | useBreakpoint 替换 narrowScreen 内部实现但保留对外行为，互斥逻辑沿用 |
| 断点迁移漏改 | grep `760px / 800px / 900px / 980px / 1050px / 1100px` 全量审计，迁移后再 grep 确认零残留 |
| TopBar 溢出菜单与现有 ParamPopover 冲突 | 复用 ParamPopover.vue 的弹层语义，不新增 popover 组件 |

---

## 10. 验收标准

1. `pnpm test` 全绿
2. `pnpm run verify:domain` 通过
3. `pnpm run build` 成功
4. 三档手动验证全通过（iPhone 14 / iPad mini / 1440 桌面）
5. 全量 grep 确认零残留旧断点值（`760px / 800px / 900px / 980px / 1050px / 1100px`）
6. PR 合到 main 后 Amplify 部署成功，`https://www.0xff.tools/` 在 iPhone 上能正常使用 P0–P2 路径
