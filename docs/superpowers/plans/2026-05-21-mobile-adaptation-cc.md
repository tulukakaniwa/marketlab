# Market Lab 移动端适配实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给桌面工作台加移动端形态（<768px），保留核心路径（看推荐池、看图、切标的），高级面板做弱化处理。零 domain/scripts 改动。

**Architecture:** 统一断点 token（mobile 768 / tablet 1024）→ useBreakpoint composable → App.vue 在 mobile 切换为单列 + drawer 布局 → LeftPanel/RightPanel 在 mobile 用 `position: fixed` drawer + backdrop → TopBar 加 ☰/标的入口 + ⋯ 溢出菜单 → MainChart 高度改 `min-height: 60vh` + Hover Legend 在 mobile 改底部固定条 → RecommendedPoolPage 单列 + focus/wait tab。

**Tech Stack:** Vue 3 Composition API · Pinia · vitest · lightweight-charts v5 · CSS Grid → flex 切换 · `window.matchMedia`

**Spec:** `docs/superpowers/specs/2026-05-21-mobile-adaptation-design-cc.md`

**约束**：
- 不改 `src/domain/`、`src/stores/` schema、`scripts/`、`pyproject.toml`、`package.json` 脚本
- 浅色主题为主；中文注释；中文 describe/it
- 项目源码不加 `-cc` 后缀；文件内容不署名工具
- 单 PR；当前分支 `feature/mobile-adaptation`

**命令注意**：
- 本机用 `pnpm` 而不是 `npm`
- Windows 下 `python3` 是商店代理，不在本计划任何命令里出现
- 全量校验：`pnpm test && pnpm run verify:domain && pnpm run check:data && pnpm run check:generated-data`

---

## File Structure

| 文件 | 责任 | 改动类型 |
|---|---|---|
| `src/styles/base.css` | 断点 token 定义 + 全局 mobile 样式 | 修改 |
| `src/styles/chart.css` | 断点迁移到 768/1024 | 修改 |
| `src/styles/decision.css` | 断点迁移到 1024 | 修改 |
| `src/composables/useBreakpoint.js` | 统一的 `isMobile / isTablet` 信号 | 新增 |
| `src/composables/__tests__/useBreakpoint.test.js` | useBreakpoint 单测 | 新增 |
| `src/App.vue` | 用 useBreakpoint 替 narrowScreen + mobile 布局切换 + backdrop | 修改 |
| `src/components/TopBar.vue` | mobile ☰ + 标的入口 + ⋯ 溢出菜单 | 修改 |
| `src/components/LeftPanel.vue` | mobile drawer 样式 + 关闭按钮 | 修改 |
| `src/components/RightPanel.vue` | mobile drawer 样式 + 关闭按钮 | 修改 |
| `src/components/MainChart.vue` | mobile 高度策略 + tap-to-show 事件 | 修改 |
| `src/components/MainChartHoverLegend.vue` | mobile 固定底栏 + 断点迁移 | 修改 |
| `src/components/RecommendedPoolPage.vue` | mobile 单列 + focus/wait tab + 断点迁移 | 修改 |
| `src/components/FormulaChart.vue` | 断点迁移到 768 | 修改 |
| `src/components/LiquidityFingerprintRack.vue` | 断点迁移到 768 | 修改 |
| `src/components/LiquidityRackDepth.vue` | 断点迁移到 768 | 修改 |
| `src/components/StockChipProfileOverlay.vue` | 断点迁移到 768 | 修改 |

---

## Task 拆分（共 12 个 task，按 spec §8 五阶段组织）

**Stage 1 - 地基**：Task 1 / 2 / 3
**Stage 2 - drawer 模式**：Task 4 / 5 / 6
**Stage 3 - TopBar 溢出菜单**：Task 7 / 8
**Stage 4 - 图表与推荐池**：Task 9 / 10 / 11
**Stage 5 - 最终验收**：Task 12

---

## Task 1：断点 token + `useBreakpoint` composable

**Files:**
- Modify: `src/styles/base.css`（顶部 `:root` 块）
- Create: `src/composables/useBreakpoint.js`
- Create: `src/composables/__tests__/useBreakpoint.test.js`

- [ ] **Step 1.1：在 `base.css` 的 `:root` 块加断点 token**

打开 `src/styles/base.css`，找到 `:root {` 块（顶部，约 line 1-30 范围内），在颜色 token 之后追加：

```css
  /* 断点 token：仅供 JS 端 matchMedia 与文档使用，CSS @media 直接写 768px / 1024px */
  --bp-mobile: 768px;
  --bp-tablet: 1024px;
  --bp-desktop: 1280px;
```

- [ ] **Step 1.2：创建 composable 目录结构（如不存在）**

```bash
mkdir -p src/composables/__tests__
```

- [ ] **Step 1.3：写失败测试 `useBreakpoint.test.js`**

```js
// src/composables/__tests__/useBreakpoint.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { useBreakpoint } from '../useBreakpoint.js'

describe('useBreakpoint', () => {
  let listeners = {}

  beforeEach(() => {
    listeners = {}
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: query === '(max-width: 768px)' ? true : false,
      addEventListener: (_event, cb) => { listeners[query] = cb },
      removeEventListener: () => { delete listeners[query] },
    }))
  })

  function harness() {
    const Comp = defineComponent({
      setup() {
        const bp = useBreakpoint()
        return () => h('div', { 'data-mobile': bp.isMobile.value, 'data-tablet': bp.isTablet.value })
      },
    })
    return mount(Comp)
  }

  it('mobile 媒体匹配时返回 isMobile=true', () => {
    const wrapper = harness()
    expect(wrapper.attributes('data-mobile')).toBe('true')
  })

  it('mq.change 事件后值会同步', async () => {
    const wrapper = harness()
    listeners['(max-width: 768px)']?.()
    listeners['(max-width: 1024px)']?.()
    await wrapper.vm.$nextTick()
    expect(wrapper.attributes('data-tablet')).toBe('false')
  })
})
```

- [ ] **Step 1.4：跑测试确认失败**

```bash
pnpm exec vitest run src/composables/__tests__/useBreakpoint.test.js
```

预期：FAIL，找不到 `useBreakpoint`。

- [ ] **Step 1.5：实现 `useBreakpoint.js`**

```js
// src/composables/useBreakpoint.js
// 统一的响应式断点信号，避免组件各自定义 matchMedia。
import { onBeforeUnmount, onMounted, ref } from 'vue'

const QUERIES = {
  mobile: '(max-width: 768px)',
  tablet: '(max-width: 1024px)',
}

export function useBreakpoint() {
  const isMobile = ref(false)
  const isTablet = ref(false)
  let mqMobile = null
  let mqTablet = null

  function syncMobile() { isMobile.value = mqMobile?.matches ?? false }
  function syncTablet() { isTablet.value = mqTablet?.matches ?? false }

  onMounted(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    mqMobile = window.matchMedia(QUERIES.mobile)
    mqTablet = window.matchMedia(QUERIES.tablet)
    mqMobile.addEventListener('change', syncMobile)
    mqTablet.addEventListener('change', syncTablet)
    syncMobile()
    syncTablet()
  })

  onBeforeUnmount(() => {
    mqMobile?.removeEventListener('change', syncMobile)
    mqTablet?.removeEventListener('change', syncTablet)
  })

  return { isMobile, isTablet }
}
```

- [ ] **Step 1.6：跑测试确认通过**

```bash
pnpm exec vitest run src/composables/__tests__/useBreakpoint.test.js
```

预期：2 个 test 全 PASS。

- [ ] **Step 1.7：commit**

```bash
git add src/styles/base.css src/composables/useBreakpoint.js src/composables/__tests__/useBreakpoint.test.js
git commit -m "feat: add mobile/tablet breakpoint tokens and useBreakpoint composable"
```

---

## Task 2：迁移零散断点到统一值

**Files (全部 modify)**：
- `src/styles/chart.css`
- `src/styles/decision.css`
- `src/components/TopBar.vue`
- `src/components/MainChartHoverLegend.vue`
- `src/components/FormulaChart.vue`
- `src/components/LiquidityFingerprintRack.vue`
- `src/components/LiquidityRackDepth.vue`
- `src/components/StockChipProfileOverlay.vue`
- `src/components/RecommendedPoolPage.vue`
- `src/styles/base.css`

> **迁移规则**：760/800/900 → 768；980/1050/1100 → 1024。每个文件改 `@media` 头的数值，**不改媒体查询内的样式**。

- [ ] **Step 2.1：迁移 `760px` 出现位置**

文件 + 行号（用 grep 复核）：
```bash
pnpm exec grep -rn "max-width: 760px" src/
```

依次把每处 `@media (max-width: 760px)` 改为 `@media (max-width: 768px)`。涉及文件：
- `src/components/FormulaChart.vue`
- `src/components/LiquidityFingerprintRack.vue`
- `src/components/LiquidityRackDepth.vue`
- `src/components/StockChipProfileOverlay.vue`

- [ ] **Step 2.2：迁移 `800px`**

```bash
pnpm exec grep -rn "max-width: 800px" src/
```

把 `src/components/TopBar.vue` 中 `@media (max-width: 800px)` 改为 `@media (max-width: 768px)`。

- [ ] **Step 2.3：迁移 `900px`**

```bash
pnpm exec grep -rn "max-width: 900px" src/
```

涉及：
- `src/components/MainChartHoverLegend.vue`
- `src/components/RecommendedPoolPage.vue`

把这两个文件的 `@media (max-width: 900px)` 改为 `@media (max-width: 768px)`。

- [ ] **Step 2.4：迁移 `980px / 1050px / 1100px`（合并到 1024）**

```bash
pnpm exec grep -rn "max-width: 980px\|max-width: 1050px\|max-width: 1100px" src/
```

把以下文件中的对应 `@media` 改为 `@media (max-width: 1024px)`：
- `src/styles/decision.css`（980 → 1024）
- `src/styles/base.css`（1050 → 1024）
- `src/styles/chart.css`（1050 → 1024）
- `src/components/TopBar.vue`（1100 → 1024）

- [ ] **Step 2.5：审计零残留**

```bash
pnpm exec grep -rn "max-width: 76\|max-width: 80\|max-width: 90\|max-width: 98\|max-width: 105\|max-width: 110" src/
```

预期：**无输出**（除非命中无关字符串如 `max-width: 760` 在数据文件里，应当全无）。

- [ ] **Step 2.6：跑现有测试确认无破坏**

```bash
pnpm test
```

预期：全 PASS（断点迁移不影响 domain 测试）。

- [ ] **Step 2.7：commit**

```bash
git add src/styles src/components
git commit -m "refactor: unify scattered breakpoints to 768/1024 tokens"
```

---

## Task 3：App.vue 用 `useBreakpoint` 替换 `narrowScreen`

**Files:**
- Modify: `src/App.vue`

> 保留对外行为（打开一侧时收起另一侧），仅替换内部信号源。后续 task 6 会扩展真正的 mobile 布局切换。

- [ ] **Step 3.1：在 `<script setup>` 顶部 import 区追加**

```js
import { useBreakpoint } from './composables/useBreakpoint.js'
```

- [ ] **Step 3.2：替换 narrowScreen 实现**

把 App.vue 中第 34-38 行的 `narrowScreen` ref 与 `syncNarrowScreen` 函数 + 第 90-93 行的 `mediaQuery` 监听 + 第 105 行的 `removeEventListener`，整体替换：

**删除**这些原代码：
```js
const narrowScreen = ref(false)
let mediaQuery = null
function syncNarrowScreen() {
  narrowScreen.value = mediaQuery?.matches ?? false
}
```
以及 `onMounted` 中的：
```js
if (typeof window !== 'undefined' && window.matchMedia) {
  mediaQuery = window.matchMedia('(max-width: 900px)')
  syncNarrowScreen()
  mediaQuery.addEventListener('change', syncNarrowScreen)
}
```
和 `onBeforeUnmount` 中的：
```js
mediaQuery?.removeEventListener('change', syncNarrowScreen)
```

**新增**（接在原 `const lab = useLabStore()` 行之后）：
```js
const { isMobile } = useBreakpoint()
const narrowScreen = isMobile  // 行为别名，保留 toggleLeftPanel/toggleRightPanel 内引用
```

- [ ] **Step 3.3：跑现有测试**

```bash
pnpm test
```

预期：全 PASS。

- [ ] **Step 3.4：手动 sanity 跑 dev server**

```bash
pnpm exec vite --host 127.0.0.1 --port 5173
```

打开 http://127.0.0.1:5173/ ，缩窗到 <768px，确认打开左侧面板时右侧自动收起。`Ctrl+C` 停 server。

- [ ] **Step 3.5：commit**

```bash
git add src/App.vue
git commit -m "refactor: route App.vue narrowScreen through useBreakpoint"
```

---

## Task 4：LeftPanel 加 mobile drawer 样式

**Files:**
- Modify: `src/components/LeftPanel.vue`

- [ ] **Step 4.1：阅读 LeftPanel 现有结构**

```bash
pnpm exec head -50 src/components/LeftPanel.vue
```

确认根元素 class（一般是 `.lp-root` 或 `.left-panel`），后续样式以这个根 class 作为选择器前缀。

- [ ] **Step 4.2：在模板根元素上加 `:class="{ 'lp-mobile-open': isMobile && open }"`**

打开 `src/components/LeftPanel.vue`，在 `<script setup>` 中 import 并使用 useBreakpoint：

```js
import { useBreakpoint } from '../composables/useBreakpoint.js'
const { isMobile } = useBreakpoint()
```

模板根元素 class 改为（保留原 class，加上条件）：

```vue
<aside
  class="lp-root"
  :class="{
    'lp-collapsed': !open,
    'lp-mobile': isMobile,
    'lp-mobile-open': isMobile && open,
  }"
>
```

如根 class 不是 `lp-root`，按实际命名替换三处。

- [ ] **Step 4.3：模板内加关闭按钮（mobile only）**

在根元素的最顶部内容前加：

```vue
<button
  v-if="isMobile"
  class="lp-mobile-close"
  type="button"
  aria-label="关闭"
  @click="$emit('toggle')"
>✕</button>
```

- [ ] **Step 4.4：在 `<style>` 末尾追加 mobile drawer 样式**

```css
/* mobile drawer 形态 */
@media (max-width: 768px) {
  .lp-root.lp-mobile {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    max-width: 100vw;
    z-index: 50;
    background: var(--bg);
    transform: translateX(-100%);
    transition: transform 200ms ease;
    overflow-y: auto;
    box-shadow: 2px 0 12px rgba(0, 0, 0, 0.18);
  }
  .lp-root.lp-mobile.lp-mobile-open {
    transform: translateX(0);
  }
  .lp-root.lp-mobile .lp-mobile-close {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 32px;
    height: 32px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--bg);
    color: var(--ink);
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
    z-index: 51;
  }
  .lp-root.lp-mobile .lp-mobile-close:hover {
    border-color: var(--green);
  }
}
```

- [ ] **Step 4.5：跑测试**

```bash
pnpm test
```

预期：全 PASS（视觉改动不影响测试）。

- [ ] **Step 4.6：commit**

```bash
git add src/components/LeftPanel.vue
git commit -m "feat: turn LeftPanel into fixed drawer on mobile"
```

---

## Task 5：RightPanel 加 mobile drawer 样式

**Files:**
- Modify: `src/components/RightPanel.vue`

- [ ] **Step 5.1：阅读 RightPanel 根元素 class**

```bash
pnpm exec head -50 src/components/RightPanel.vue
```

记录根 class（一般 `.rp-root` 或 `.right-panel`）。

- [ ] **Step 5.2：script setup 引入 useBreakpoint**

```js
import { useBreakpoint } from '../composables/useBreakpoint.js'
const { isMobile } = useBreakpoint()
```

- [ ] **Step 5.3：模板根元素 class 增加移动端条件**

```vue
<aside
  class="rp-root"
  :class="{
    'rp-collapsed': !open,
    'rp-mobile': isMobile,
    'rp-mobile-open': isMobile && open,
  }"
>
```

如根 class 不是 `rp-root`，替换为实际值。

- [ ] **Step 5.4：模板顶部加关闭按钮**

```vue
<button
  v-if="isMobile"
  class="rp-mobile-close"
  type="button"
  aria-label="关闭"
  @click="$emit('toggle')"
>✕</button>
```

- [ ] **Step 5.5：style 末尾追加 mobile drawer 样式**

```css
/* mobile drawer 形态：从右侧滑入 */
@media (max-width: 768px) {
  .rp-root.rp-mobile {
    position: fixed;
    top: 0;
    right: 0;
    width: 100vw;
    height: 100vh;
    max-width: 100vw;
    z-index: 50;
    background: var(--bg);
    transform: translateX(100%);
    transition: transform 200ms ease;
    overflow-y: auto;
    box-shadow: -2px 0 12px rgba(0, 0, 0, 0.18);
  }
  .rp-root.rp-mobile.rp-mobile-open {
    transform: translateX(0);
  }
  .rp-root.rp-mobile .rp-mobile-close {
    position: absolute;
    top: 8px;
    left: 8px;
    width: 32px;
    height: 32px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--bg);
    color: var(--ink);
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
    z-index: 51;
  }
  .rp-root.rp-mobile .rp-mobile-close:hover {
    border-color: var(--green);
  }
}
```

- [ ] **Step 5.6：跑测试**

```bash
pnpm test
```

预期：全 PASS。

- [ ] **Step 5.7：commit**

```bash
git add src/components/RightPanel.vue
git commit -m "feat: turn RightPanel into fixed drawer on mobile"
```

---

## Task 6：App.vue 加 mobile 单列布局 + backdrop

**Files:**
- Modify: `src/App.vue`

- [ ] **Step 6.1：模板 `<div class="app-root">` 内、`<TopBar>` 下方加 backdrop**

在 `</TopBar>` 后、`<p v-if="lab.error">` 之前插入：

```vue
<div
  v-if="isMobile && (effectiveLeftOpen || effectiveRightOpen)"
  class="mobile-backdrop"
  @click="closeMobileDrawers"
/>
```

- [ ] **Step 6.2：script 中加关闭函数**

在 `function toggleRightPanel` 之后加：

```js
function closeMobileDrawers() {
  lab.leftPanelOpen = false
  lab.rightPanelOpen = false
}
```

- [ ] **Step 6.3：style 区域加 backdrop 样式与 mobile 单列布局**

在原 `<style>` 末尾追加：

```css
/* 移动端：backdrop 与单列布局 */
@media (max-width: 768px) {
  .mobile-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    z-index: 40;
  }
  /* 单列：左右面板脱离 grid，主图占满 */
  .app-root .cols,
  .app-root.left-collapsed .cols,
  .app-root.right-collapsed .cols,
  .app-root.left-collapsed.right-collapsed .cols {
    grid-template-columns: 1fr;
    gap: 0;
  }
  .app-root .resizer {
    display: none;
  }
  .app-root .app-main {
    width: 100%;
  }
}
```

- [ ] **Step 6.4：跑测试**

```bash
pnpm test
```

预期：全 PASS。

- [ ] **Step 6.5：手动 dev 验证**

```bash
pnpm exec vite --host 127.0.0.1 --port 5173
```

DevTools 切 iPhone 14（393×852），确认：
- 左右面板初始关闭，主图占整屏
- store 模拟打开 leftPanelOpen 后，左 drawer 从左滑入，背景出现 backdrop
- 点击 backdrop 关闭 drawer
- 桌面 1440 缩到 768 不破坏现有 grid 布局

`Ctrl+C` 停 server。

- [ ] **Step 6.6：commit**

```bash
git add src/App.vue
git commit -m "feat: collapse to single-column with drawer backdrop on mobile"
```

---

## Task 7：TopBar 加 ☰ 与 标的入口按钮

**Files:**
- Modify: `src/components/TopBar.vue`

- [ ] **Step 7.1：script setup 引入 useBreakpoint 和 lucide 图标**

```js
import { useBreakpoint } from '../composables/useBreakpoint.js'
import { Menu, List } from 'lucide-vue-next'
const { isMobile } = useBreakpoint()
```

- [ ] **Step 7.2：模板顶部加移动端左右两个按钮**

在 TopBar 模板的 logo 区前加：

```vue
<button
  v-if="isMobile"
  class="tb-mobile-btn tb-mobile-left"
  type="button"
  aria-label="打开菜单"
  @click="$emit('mobile-open-left')"
>
  <Menu :size="20" />
</button>
```

在 TopBar 模板末尾（`</style>` 前的最后一个根级元素位置）加：

```vue
<button
  v-if="isMobile"
  class="tb-mobile-btn tb-mobile-right"
  type="button"
  aria-label="标的列表"
  @click="$emit('mobile-open-right')"
>
  <List :size="20" />
</button>
```

- [ ] **Step 7.3：在 TopBar `defineEmits` 中追加事件**

定位 `defineEmits([` 调用，把 `mobile-open-left`、`mobile-open-right` 加入数组。如原本没有 defineEmits，新增：

```js
const emit = defineEmits([
  'set-profile', 'set-auto-profile', 'toggle-theme', 'reset',
  'mobile-open-left', 'mobile-open-right',
])
```

- [ ] **Step 7.4：style 末尾加按钮样式（mobile only）**

```css
.tb-mobile-btn { display: none; }
@media (max-width: 768px) {
  .tb-mobile-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--bg);
    color: var(--ink);
    cursor: pointer;
    flex-shrink: 0;
  }
  .tb-mobile-btn:hover { border-color: var(--green); }
  .tb-mobile-left { margin-right: 8px; }
  .tb-mobile-right { margin-left: auto; }
}
```

- [ ] **Step 7.5：在 App.vue 模板中接 TopBar 新事件**

```vue
<TopBar
  ...
  @reset="resetWorkbench"
  @mobile-open-left="lab.leftPanelOpen = true; lab.rightPanelOpen = false"
  @mobile-open-right="lab.rightPanelOpen = true; lab.leftPanelOpen = false"
/>
```

- [ ] **Step 7.6：跑测试**

```bash
pnpm test
```

预期：全 PASS。

- [ ] **Step 7.7：手动 dev 验证**

启 dev，DevTools iPhone 14：点 ☰ 左 drawer 滑入，点 List 图标右 drawer 滑入。

- [ ] **Step 7.8：commit**

```bash
git add src/components/TopBar.vue src/App.vue
git commit -m "feat: add menu/list buttons in TopBar to open mobile drawers"
```

---

## Task 8：TopBar 把次要项收纳到 ⋯ 溢出菜单

**Files:**
- Modify: `src/components/TopBar.vue`

> 移动端把"主题切换、重置、profile 切换、auto-profile 开关"这些次要操作从 TopBar 直接展示移到 ⋯ 菜单内。桌面布局保持原样。

- [ ] **Step 8.1：script 加菜单展开状态**

```js
import { ref } from 'vue'
const overflowOpen = ref(false)
function toggleOverflow() { overflowOpen.value = !overflowOpen.value }
function closeOverflow() { overflowOpen.value = false }
```

- [ ] **Step 8.2：script 引入 MoreHorizontal 图标**

```js
import { Menu, List, MoreHorizontal } from 'lucide-vue-next'
```

- [ ] **Step 8.3：模板加 ⋯ 按钮（位于 tb-mobile-right 之前）**

```vue
<div v-if="isMobile" class="tb-overflow-wrap">
  <button
    class="tb-mobile-btn tb-overflow-btn"
    type="button"
    aria-label="更多"
    @click="toggleOverflow"
  >
    <MoreHorizontal :size="20" />
  </button>
  <div v-if="overflowOpen" class="tb-overflow-menu" @click.stop>
    <button class="tb-overflow-item" @click="$emit('toggle-theme'); closeOverflow()">
      切换主题（当前 {{ theme === 'dark' ? '深色' : '浅色' }}）
    </button>
    <button class="tb-overflow-item" @click="$emit('reset'); closeOverflow()">
      重置工作台
    </button>
    <div class="tb-overflow-section">策略 Profile</div>
    <button
      v-for="p in profileList"
      :key="p.id"
      class="tb-overflow-item"
      :class="{ 'is-active': p.id === profileId && !autoProfile }"
      @click="$emit('set-profile', p.id); closeOverflow()"
    >
      {{ p.label || p.id }}
      <span v-if="p.id === recommendedId" class="tb-recommended">推荐</span>
    </button>
    <button
      class="tb-overflow-item"
      :class="{ 'is-active': autoProfile }"
      @click="$emit('set-auto-profile', !autoProfile); closeOverflow()"
    >
      自动跟随回放：{{ autoProfile ? '开' : '关' }}
    </button>
  </div>
</div>
```

- [ ] **Step 8.4：模板：在 mobile 时把次要项从可见区域隐藏**

定位 TopBar 内现有的"主题切换按钮、重置按钮、profile 切换器、auto-profile 开关"等元素，给它们加 `class="tb-desktop-only"`（保留原 class，叠加）。

- [ ] **Step 8.5：style 末尾追加溢出菜单样式与桌面元素隐藏**

```css
@media (max-width: 768px) {
  .tb-desktop-only { display: none !important; }

  .tb-overflow-wrap {
    position: relative;
    margin-left: 8px;
  }
  .tb-overflow-menu {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 4px;
    min-width: 220px;
    max-width: 80vw;
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
    z-index: 60;
    padding: 4px;
  }
  .tb-overflow-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: 10px 12px;
    border: none;
    background: transparent;
    color: var(--ink);
    font-size: 0.82rem;
    cursor: pointer;
    border-radius: 6px;
  }
  .tb-overflow-item:hover { background: var(--hover); }
  .tb-overflow-item.is-active {
    color: var(--green);
    font-weight: 700;
  }
  .tb-overflow-section {
    padding: 8px 12px 4px;
    font-size: 0.66rem;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .tb-recommended {
    margin-left: 6px;
    font-size: 0.66rem;
    color: var(--green);
  }
}
```

- [ ] **Step 8.6：script 加 click outside 关闭菜单**

```js
import { onMounted, onBeforeUnmount } from 'vue'

function onDocClick(e) {
  if (!overflowOpen.value) return
  if (e.target.closest('.tb-overflow-wrap')) return
  closeOverflow()
}
onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))
```

- [ ] **Step 8.7：跑测试**

```bash
pnpm test
```

预期：全 PASS。

- [ ] **Step 8.8：手动 dev 验证**

DevTools iPhone 14：⋯ 按钮可点开，菜单显示主题、重置、所有 profile，点击触发对应 emit，点其它处自动关闭。

- [ ] **Step 8.9：commit**

```bash
git add src/components/TopBar.vue
git commit -m "feat: collapse TopBar secondary actions into overflow menu on mobile"
```

---

## Task 9：MainChart 高度策略 + tap-to-show

**Files:**
- Modify: `src/components/MainChart.vue`

- [ ] **Step 9.1：找到主图根容器的 class**

```bash
pnpm exec head -200 src/components/MainChart.vue | grep -E "class=|mc-root|chart-panel"
```

记录根 class。下文以 `.mc-root` 为例。

- [ ] **Step 9.2：style 区追加 mobile 高度策略**

```css
@media (max-width: 768px) {
  .mc-root,
  .chart-panel,
  .market-chart {
    min-height: 60vh;
    height: auto;
  }
}
```

> 如果 MainChart 内部设置了 inline `style="height: ..."`，需配合 isMobile 用 computed 切换；若仅靠 CSS 类即可，则保留 CSS-only 实现。

- [ ] **Step 9.3：script 加 useBreakpoint（仅当 inline style 需要切换时）**

如果根容器有 inline 高度，加：

```js
import { useBreakpoint } from '../composables/useBreakpoint.js'
import { computed } from 'vue'
const { isMobile } = useBreakpoint()
const rootStyle = computed(() => isMobile.value ? { minHeight: '60vh' } : {})
```

并在模板根元素 `:style="rootStyle"`。

- [ ] **Step 9.4：tap-to-show hover legend（mobile only）**

定位主图区域处理 `cursor-change` 事件的 `<div>` 或 chart container，加 `@touchstart="onMobileTap"`：

```vue
<div
  class="mc-chart-area"
  @touchstart="onMobileTap"
>
```

script 中加：

```js
function onMobileTap(e) {
  if (!isMobile.value) return
  // 让 lightweight-charts 在 touch 时模拟 hover 触发现有 cursor-change 流
  // 实际方案：找到 touch 在 chart 上的 logical x，调用 chart.timeScale().coordinateToTime
  // 简化：直接转 mousemove
  const touch = e.touches?.[0]
  if (!touch) return
  const evt = new MouseEvent('mousemove', {
    clientX: touch.clientX,
    clientY: touch.clientY,
    bubbles: true,
  })
  e.target.dispatchEvent(evt)
}
```

- [ ] **Step 9.5：跑测试**

```bash
pnpm test
```

预期：全 PASS。

- [ ] **Step 9.6：手动 dev 验证**

DevTools iPhone 14：图表占 60vh+，下方有空间继续滚动；触屏 tap 主图后 legend 显示。

- [ ] **Step 9.7：commit**

```bash
git add src/components/MainChart.vue
git commit -m "feat: enforce 60vh chart height and tap-to-show legend on mobile"
```

---

## Task 10：MainChartHoverLegend 移动端固定底栏

**Files:**
- Modify: `src/components/MainChartHoverLegend.vue`

- [ ] **Step 10.1：阅读现有结构**

```bash
pnpm exec head -100 src/components/MainChartHoverLegend.vue
```

记录根 class（一般 `.hover-legend` 或类似）。

- [ ] **Step 10.2：style 中找到现有 `@media (max-width: 768px)`（在 Task 2 中已迁移自 900）**

把该媒体查询内的样式补充为底部固定栏：

```css
@media (max-width: 768px) {
  .hover-legend {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100vw;
    max-width: 100vw;
    transform: none !important;
    border-radius: 0;
    border-top: 1px solid var(--line);
    background: var(--bg);
    box-shadow: 0 -2px 12px rgba(0, 0, 0, 0.12);
    padding: 8px 12px;
    z-index: 30;
    /* 保留浮动 legend 内的字号/排版 */
  }
}
```

> 把根 class 名替换成实际值。

- [ ] **Step 10.3：跑测试**

```bash
pnpm test
```

预期：全 PASS。

- [ ] **Step 10.4：手动验证**

DevTools iPhone 14 + tap 图表后，legend 应贴底显示且占满宽度，不再浮动。

- [ ] **Step 10.5：commit**

```bash
git add src/components/MainChartHoverLegend.vue
git commit -m "feat: pin hover legend to viewport bottom on mobile"
```

---

## Task 11：RecommendedPoolPage 单列 + tab

**Files:**
- Modify: `src/components/RecommendedPoolPage.vue`

- [ ] **Step 11.1：阅读结构**

```bash
pnpm exec head -100 src/components/RecommendedPoolPage.vue
```

定位 focus / wait 两组卡片的容器（一般是 `.rp-focus` `.rp-wait` 或共用 `.rp-section`）。

- [ ] **Step 11.2：script 加 mobile tab 状态**

```js
import { ref } from 'vue'
import { useBreakpoint } from '../composables/useBreakpoint.js'
const { isMobile } = useBreakpoint()
const mobileTab = ref('focus')  // 'focus' | 'wait'
```

- [ ] **Step 11.3：模板顶部加 mobile tab 切换器**

在 focus / wait 两组容器之前加：

```vue
<div v-if="isMobile" class="rp-mobile-tabs">
  <button
    type="button"
    class="rp-mobile-tab"
    :class="{ 'is-active': mobileTab === 'focus' }"
    @click="mobileTab = 'focus'"
  >
    重点关注
  </button>
  <button
    type="button"
    class="rp-mobile-tab"
    :class="{ 'is-active': mobileTab === 'wait' }"
    @click="mobileTab = 'wait'"
  >
    观察等待
  </button>
</div>
```

- [ ] **Step 11.4：模板：focus 容器加 v-show，wait 容器加 v-show**

```vue
<section v-show="!isMobile || mobileTab === 'focus'" class="rp-focus">
  ...原 focus 内容
</section>
<section v-show="!isMobile || mobileTab === 'wait'" class="rp-wait">
  ...原 wait 内容
</section>
```

- [ ] **Step 11.5：style 中追加 mobile 单列与 tab 样式**

```css
@media (max-width: 768px) {
  .rp-mobile-tabs {
    display: flex;
    gap: 8px;
    padding: 12px 12px 0;
  }
  .rp-mobile-tab {
    flex: 1;
    min-height: 36px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--bg);
    color: var(--ink);
    font-size: 0.84rem;
    font-weight: 700;
    cursor: pointer;
  }
  .rp-mobile-tab.is-active {
    border-color: var(--green);
    color: var(--green);
  }
  /* 卡片单列 */
  .rp-focus,
  .rp-wait,
  .rp-section,
  .rp-card-grid {
    grid-template-columns: 1fr !important;
  }
}
```

> 把根 class 替换成实际值；如果用的是 flex 而非 grid，把 `grid-template-columns` 改为 `flex-direction: column`。

- [ ] **Step 11.6：跑测试**

```bash
pnpm test
```

- [ ] **Step 11.7：手动验证（独立路径）**

```bash
pnpm exec vite --host 127.0.0.1 --port 5173
```

打开 http://127.0.0.1:5173/recommended-pool/ ，DevTools iPhone 14，确认：
- 两个 tab 切换正常
- 卡片单列堆叠
- 桌面 1440 仍是双列

- [ ] **Step 11.8：commit**

```bash
git add src/components/RecommendedPoolPage.vue
git commit -m "feat: stack recommended pool sections with focus/wait tabs on mobile"
```

---

## Task 12：最终验收

**Files:** 无新增。

- [ ] **Step 12.1：旧断点零残留审计**

```bash
pnpm exec grep -rn "max-width: 760\|max-width: 800\|max-width: 900\|max-width: 980\|max-width: 1050\|max-width: 1100" src/
```

预期：**无任何输出**。如有残留，回到 Task 2 补迁移。

- [ ] **Step 12.2：完整测试套件**

```bash
pnpm test
```

预期：全 PASS。

- [ ] **Step 12.3：domain 校验**

```bash
pnpm run verify:domain
```

预期：通过。

- [ ] **Step 12.4：数据校验**

```bash
pnpm run check:data && pnpm run check:generated-data
```

预期：通过。

> 如 `src/data/generated/` 不存在或不一致，先跑 `node scripts/csv2js.mjs`（参考早前 README 的本地坑）；如遇 EPERM，用 powershell Move-Item 绕开。

- [ ] **Step 12.5：构建**

```bash
pnpm exec vite build
```

预期：成功，产出 `dist/`。

- [ ] **Step 12.6：手动 DevTools 三档验证**

```bash
pnpm exec vite preview --host 127.0.0.1 --port 4173
```

打开 http://127.0.0.1:4173/ ，DevTools 切换：

| 设备 | 验证清单 |
|---|---|
| iPhone 14 (393×852) | TopBar ☰ 触发左 drawer ／ List 触发右 drawer ／ ⋯ 菜单含主题/重置/profile ／ 主图 ≥60vh ／ tap 图表 legend 在底部 ／ /recommended-pool/ 单列 + tab |
| iPad mini (768×1024) | 临界 768：mobile 形态命中（drawer 模式） |
| 桌面 1440 | 5 列 grid + 拖宽 + 浮动 legend 完全保留 |

- [ ] **Step 12.7：推送分支**

```bash
git push -u origin feature/mobile-adaptation
```

- [ ] **Step 12.8：开 PR**

```bash
gh pr create --base main --title "feat: mobile adaptation (drawer layout, breakpoint tokens)" --body "$(cat <<'EOF'
## Summary

- 加 mobile/tablet 断点 token 与 useBreakpoint composable
- 把零散的 760/800/900/980/1050/1100 六套断点统一到 768/1024
- 移动端 (<768) 主布局改为单列；左右面板改 fixed drawer + backdrop
- TopBar 加 ☰ + 标的入口 + ⋯ 溢出菜单
- 主图 min-height 60vh；hover legend 底部固定条
- 推荐池页单列 + focus/wait tab

零 domain/scripts 改动；Spec: docs/superpowers/specs/2026-05-21-mobile-adaptation-design-cc.md

## Test plan

- [x] pnpm test 全绿
- [x] pnpm run verify:domain 通过
- [x] pnpm run check:data / check:generated-data 通过
- [x] pnpm exec vite build 成功
- [x] DevTools iPhone 14 / iPad mini / 1440 三档验证通过
- [x] 旧断点 grep 零残留
EOF
)"
```

返回 PR URL，结束。

---

## 自检（Plan Self-Review）

> 以下为 plan 写完后的对照检查，已修正:
>
> 1. **Spec 覆盖**：spec §3 (token 治理) → Task 1+2；§4.2.1 App.vue → Task 3+6；§4.2.2 TopBar → Task 7+8；§4.2.3 LeftPanel → Task 4；§4.2.3 RightPanel → Task 5；§4.2.4 MainChart → Task 9；§4.2.5 HoverLegend → Task 10；§4.2.6 RecommendedPool → Task 11；§4.2.7 resizer 隐藏 → 在 Task 6 CSS 中处理；§4.2.8 高级面板推迟 → 不需 task；§7 验收 → Task 12。
> 2. **无 placeholder**：所有 step 都给了实际代码 / 命令 / 期望值。
> 3. **类型一致**：useBreakpoint 暴露 `isMobile` / `isTablet` 两个 ref，全 plan 引用一致；事件名 `mobile-open-left` / `mobile-open-right` 一致；class 命名 `lp-mobile` / `rp-mobile` / `tb-mobile-*` 一致。
> 4. **YAGNI 边界**：未引入触屏拖宽、PWA、独立路由树。
