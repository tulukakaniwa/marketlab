# Market Lab 改造交接文档

> 用途：在另一台电脑上继续改造时，先读这份。包含完整改造思路、决策依据、踩坑记录、下一步候选。
>
> 状态：所有改动**未 commit**，全部在工作区。

## 一、当前批次状态

| 批次 | 主题 | 状态 |
|---|---|---|
| **A** | Bug 修复（5 处） | ✅ 完成 |
| **B** | 死代码清理 | ✅ 完成 |
| **C** | 工程基建（别名 / chunk / README） | ✅ 完成 |
| **D1** | 依赖清理（删 echarts） | ✅ 完成 |
| **D2** | 拆分 labStore | ✅ 完成 |
| **D3** | 引入 vitest（35 测试） | ✅ 完成 |
| **D4** | 重排 UI（问题驱动导航） | ✅ 完成 |
| **E1** | 公式详情抽屉 | ✅ 完成 |
| **E2** | Web Worker | ❌ **撤回**（基准测试后判断不必要） |
| **E3** | 数据层健壮性 | ✅ 完成 |
| **F1** | 决策回放联动 | ✅ 完成 |
| **F3** | 参数持久化 | ✅ 完成 |
| **F4** | 错误与加载体验 | ✅ 完成 |

## 二、修改清单（与原始项目的 diff）

```
src/
├── App.vue                         [改] 加 QuestionNav + FormulaDrawer + 主题持久化 + 重置按钮 + 错误条增强
├── stores/
│   ├── labStore.js                 [改] 215 行 → 110 行 facade，组合 4 个 composable
│   └── __tests__/labStore.test.js  [新] 6 个集成测试
├── composables/                    [全新目录]
│   ├── useDataLoader.js            数据加载 + 重试 + 错误分级
│   ├── useMarketState.js           市场态 + tdpy 二级缓存
│   ├── useReplay.js                回放 + profile 选档
│   ├── usePlanning.js              输入 + UI 状态（持久化）
│   └── usePersisted.js             localStorage 封装
├── domain/
│   ├── market/cost.js              [改] 全局可变状态 → 纯函数 + deriveWindows
│   ├── market/formulaPath.js       [改] 复用 deriveWindows
│   ├── replay/dailyReplay.js       [改] 接收外部 marketStates + tdpy 透传
│   └── __tests__/                  [新]
│       ├── formulas.test.js        9 用例
│       ├── cost.test.js            9 用例
│       ├── planning.test.js        5 用例
│       └── replay.test.js          4 用例
├── components/
│   ├── ExecutionPanel.vue          [删] → 回收站
│   ├── QuestionNav.vue             [新] 问题驱动导航
│   ├── FormulaDrawer.vue           [新] 公式详情抽屉
│   └── MarketChart.vue             [改] 加 pane 3 权益曲线
└── styles/decision.css             [改] 删 .execution-panel 块（约 60 行）

vite.config.js                      [改] @ 别名 + manualChunks + vitest 配置
package.json                        [改] echarts 删；xlsx 转 dev；+ vitest/jsdom/@vue/test-utils；+ check:data
README.md                           [改] 36 行 → 105 行决策模型说明
scripts/
├── convert-stocks-xlsx.mjs         [改] 路径硬编码 → CLI 参数 / STOCKS_XLSX 环境变量
└── check-data-index.mjs            [新] 索引一致性校验
```

## 三、各批次详细思路

### 批次 A · Bug 修复

**5 处都是正确性问题，是后续改造的前提。**

#### A1：`cost.js` 模块级可变全局
- **原问题**：`COST_WINDOW`/`RECENT_WINDOW`/`VOL_WINDOW` 是模块顶层 `let`，`setWindows()` 仅在 `buildMarketStatePath` 调用，但 `buildCostPath`/`rollingCost` 也读这几个变量
- **场景**：先调 `buildCostPath([200 行])` 设 `COST_WINDOW=60`，再调 `buildCostPath([20 行])` 时仍用 60，结果错乱
- **修复**：改为纯函数，新增 `deriveWindows(n)` 根据样本量推导，`buildCostPath` / `buildMarketStatePath` 接受可选 `windows` 参数，跨调用零污染

#### A2：`formulaPath.js` 与 `cost.js` 的 VOL_WINDOW 脱节
- **原问题**：`formulaPath` 写死 `const VOL_WINDOW = 60`，与 `cost.js` 的动态窗口不一致，导致 delta 带、期权价格基于不同的年化波动率窗口
- **修复**：`formulaPath` 也调 `deriveWindows()` 共用窗口

#### A3：`labStore` 缓存键漏 `tradingDaysPerYear`
- **原问题**：`marketStatePathCache` 是 `WeakMap<rows, states>`，用户切年时间基（365 → 252）后，**同一个 rows 对象**仍命中旧缓存，结果年化波动率错了
- **修复**：改为二级桶 `WeakMap<rows, Map<tdpy, states>>`

#### A4：`dailyReplay` 调 `buildMarketStatePath` 未传 tdpy
- **原问题**：`getMarketStates(rows)` 默认 365，与用户当前年时间基设置脱节，三档 profile 回放有系统性偏差
- **修复**：透传 `input.tradingDaysPerYear`

#### A5：消除 store 与 replay 双 WeakMap 冗余
- **原问题**：两边各算一遍 marketStates，浪费且可能不同步
- **修复**：`buildDailyReplay(rows, input, marketStates?)` 接收外部 states，store 单源

---

### 批次 B · 死代码清理

- 删 `ExecutionPanel.vue`（→ 回收站，遵循全局规则）
- 删 `decision.css` 中 `.execution-panel` 块（60 行）
- **canvas/ 保留**（用户偏好，未来可能复活画布功能）
- **撤回过的清理**：原本想删 `mapped` 状态公式（asian/lp-fingerprint/amm），grep 后发现它们在 `FormulaChart.vue` 展示卡片用了，**不进入决策**，标签语义正确，不改

---

### 批次 C · 工程基建

- `vite.config.js` 加 `@` 别名指向 `src/`
- `manualChunks` 用**函数形式**（vite 8 + rolldown 不接受 object 形式，初次踩坑）
- `README.md` 从 36 行扩到 105 行：补目录结构、决策模型、`GetDelta` 公式、三档 profile、回放语义

---

### 批次 D · 大改造

#### D1：依赖清理
- `echarts` 真零引用，删
- `xlsx` 仅 `scripts/convert-stocks-xlsx.mjs` 用（离线工具），挪到 `devDependencies`
- vite manualChunks 同步移除 echarts/xlsx 分支

#### D2：拆分 labStore（215 行 → 110 行 facade）
- **拆分边界**：4 个 composable
  - `useDataLoader` → rows/source/loading/error/cursor + 加载/导入
  - `useMarketState` → marketStateFull/market/costPath/formulaPath（带 tdpy 二级缓存）
  - `useReplay` → profileReplays/recommendedProfile/replay
  - `usePlanning` → input + UI 选中态
- **核心难点：循环依赖**
  - planning 需要 market（来自 marketState）+ recommendedProfile（来自 replay）
  - marketState 需要 input（来自 planning）
  - replay 需要 effectiveInput + marketStateFull
- **解法**：让 `usePlanning` **只管 input + UI 状态**，把 `effectiveInput` / `graph` / `executionBrief` 提到 store 层组合，依赖图变线性
  - 顺序：`usePlanning` → `useDataLoader` → `useMarketState` → `useReplay` → 在 store 里用 `computed` 组合 `effectiveInput`/`graph`
  - 用 `let replayLayer` + 后赋值 + computed 惰性求值绕过 TDZ
- **对外 API 100% 保持兼容**，`App.vue` 不动

#### D3：引入 vitest
- 装 `vitest @vue/test-utils jsdom`，配置 `vite.config.js` 的 test 段
- 测试文件位置：`src/**/__tests__/*.test.js`（与被测代码同级）
- **保留 `verify-domain.mjs`** 作为 build 守门员（数值断言用 BTC/NVDA/TSLA 真实数据）
- **测试用例的"可观测差异"陷阱**：写 A4 回归测试时三次失败——合成线性数据触发不了行为差异，最后回退到契约测试（"接受参数 + 字段齐全"）

#### D4：重排 UI（问题驱动导航）
- 用户选 **"中量级"**：左栏从公式选择 → 问题选择
- 新增 `QuestionNav.vue`：4 个问题块
  1. 看什么品种？→ 顶栏搜索框聚焦
  2. 入场价/持仓窗口？→ 切到 `delta-band`
  3. 盈利来源？→ 4 选 1（成本回归 / 手续费 / 波动率 / 资金费率）
  4. 何处失效？→ 切到 `order-plan`
- `FormulaNav` 折叠到 `<details>` "完整公式列表（点击查看每个公式）"

---

### 批次 E

#### E1：公式详情抽屉
- 新增 `FormulaDrawer.vue`：
  - 触发：QuestionNav "为什么" 按钮、完整公式列表点击公式
  - 内容：metadata（role/inputs/outputs/formulas）+ 当前实时值 + 决策落点（feeds 反推）+ 上下游依赖
  - 滑入动画 + ESC/遮罩/X 关闭
- App.vue 持有 `drawerOpen` 状态

#### E2：Web Worker（撤回）
- **基准测试**：3000 K + 三档回放 27ms，单次决策图重算 0.12ms
- **结论**：完全无瓶颈，撤回。**经验：性能优化前先测基线**

#### E3：数据层健壮性
- `convert-stocks-xlsx.mjs` 路径硬编码 `/Users/wangxuanzhe/...` → 改为 CLI 参数 / `STOCKS_XLSX` 环境变量
- 新增 `scripts/check-data-index.mjs`：校验 stock-index.json 与 CSV 文件的一致性
  - id/symbol 唯一性
  - index entry 引用的 CSV 都存在
  - CSV 都被 index 引用（除 BTC 白名单）
- build 流程纳入：`pnpm run build` 现在跑 `check:data → verify:domain → vite build`

---

### 批次 F

#### F3：参数持久化
- 新增 `usePersisted.js`：
  - `persistedRef(key, default)` / `persistedReactive(key, defaults)`
  - JSON 序列化 + 200ms 防抖 + 字段级合并（防新版本被旧数据污染）
  - key 加版本号 `.v1`，结构升级时旧数据被忽略
  - 浏览器环境检测，SSR/Node 测试中 no-op
  - `clearPersistedLab()` 清所有 `lab.*` 键
- 持久化项：
  - `lab.input.v1` —— 所有 input 字段
  - `lab.activeMode.v1` / `lab.activeCapabilityId.v1` / `lab.activeFormulaId.v1`
  - `lab.theme.v1` —— light/dark
- App.vue 加"重置"按钮 → confirm + clearPersistedLab + reload
- **决策**：加载新品种**仍然回填** `entryPrice` 等（直觉一致），持久化的价值在于刷新页面 + 跨会话保留 UI 偏好

#### F4：错误与加载体验
- `useDataLoader.js` 错误从 string 升级为对象：
  ```js
  { message, kind: 'network'|'parse'|'empty'|'unknown', sample? }
  ```
- 新增 `retryLast()` / `dismissError()`
- App.vue 错误条按 kind 上色 + 重试按钮 + 关闭按钮
- 空状态加 loading 文案

#### F1：决策回放联动
- `MarketChart.vue` 新增 **pane 3**：权益曲线 + 盈亏=0 baseline
- 数据源：`replay.equityCurve` 按 date 对齐到 rows
- pane 拉伸比例调整：`[0.62, 0.08, 0.18, 0.12]`

## 四、关键设计决策

### 1. 为什么不引入 TypeScript？
- 项目是个人快速迭代工具，类型成本 > 收益
- 通过 `verify-domain.mjs` + `vitest` + 数值断言锁住边界
- 用 JSDoc 在关键 composable 标注（已加）

### 2. 为什么不引入 Vue Router？
- 单页工作台无路由需求
- 所有状态切换通过 Pinia store + composable

### 3. 为什么用 composable + facade store 而不是多 store？
- Pinia 多 store 之间共享状态需要相互 import + 暴露 API，循环依赖更难处理
- composable 直接传 ref/computed 引用，依赖关系显式
- facade store 保持单一对外接口，组件无感知

### 4. 缓存策略
- `marketStatePathCache`: `WeakMap<rows, Map<tdpy, states>>` —— rows 引用变即自动 GC，tdpy 切换不冲突
- 旧的 `marketStateCache` in dailyReplay 已删，统一从 store 接收

### 5. localStorage 持久化的 key 命名
- `lab.<field>.v<version>`
- 字段级合并避免新版 default 被旧 storage 污染
- 升级时改 `.v1` → `.v2` 即可丢弃旧数据

## 五、踩过的坑

### 坑 1：vite 8 / rolldown 的 manualChunks
- **现象**：用 object 形式 `{ 'vendor-vue': ['vue'] }` 报 `manualChunks is not a function`
- **原因**：vite 8 默认用 rolldown，只接受函数形式
- **解法**：改成 `manualChunks(id) { if (id.includes('lightweight-charts')) return 'vendor-charts-lw' }`

### 坑 2：D2 拆 store 的循环依赖
- planning 依赖 market + recommendedProfile，但它们又依赖 input
- **解法**：让 planning 只管 input/UI，graph/effectiveInput 提到 store 层组合

### 坑 3：测试合成数据触发不了差异
- A4 回归测试用线性数据时，两个 tdpy 算出的 vol 都接近 0，`toBeCloseTo` 4 位精度判平
- **解法**：换震荡数据 `Math.sin(i / 4) * 8`；或直接断言数学关系 `ratio ≈ √(365/252)`

### 坑 4：Edit 工具重复写入
- 修 QuestionNav 时连续 Edit 把 `openWhy` 函数写了两遍
- 触发 `SyntaxError: Identifier 'openWhy' has already been declared`
- **教训**：连续 Edit 同一文件时 Read 一下再写

### 坑 5：dependencies 删除后 lockfile 同步
- 删 echarts 后必须跑 `pnpm install` 才能更新 lockfile
- build 会失败如果 lockfile 与 package.json 不一致

## 六、验证清单

任何改动后必跑：

```bash
pnpm run check:data        # 162×163 一致
pnpm run verify:domain     # domain 数值断言
pnpm run test              # 35 vitest 用例
pnpm run build             # 含上面三步 + vite build
```

手动验证（启动 `pnpm run dev`）：

| 操作 | 期望 | 验证哪个修复 |
|---|---|---|
| 加载 NVDA → 改右下"年时间基" 365→252 | IV 数值变化、Δ 带宽变化 | A3 |
| 切右栏"保守/均衡/激进" | 回放数字变化 | A4 |
| 改右栏 `entryPrice` → 刷新页面 | 值保留 | F3 |
| 切深色主题 → 刷新 | 主题保留 | F3 |
| 点"重置"按钮 → confirm → 刷新 | 所有持久化清空 | F3 |
| 改 URL 模拟断网 → 加载 | 错误条按 network 上色 + 重试按钮 | F4 |
| 加载完后看 K 线下方 | 有权益曲线 pane | F1 |
| 点左栏问题 3 的"成本回归" | 公式面板切到偏离强度 | D4 |
| 点左栏"为什么" | 抽屉滑出 + ESC 关闭 | E1 |
| 展开"完整公式列表" → 点公式 | 切公式 + 抽屉打开 | E1+D4 |

## 七、下一步候选（G 批次）

未做，等用户决策：

| 项 | 内容 | 风险 | 价值 |
|---|---|---|---|
| **G1** | 多品种对比仓：顶栏跳 2-3 品种，右栏并排显示三档回放 | 中（涉及 store 数组化） | 高 |
| **G2** | 权益曲线 hover 联动到主图（hover 主图时高亮当时账户状态） | 低 | 中 |
| **G3** | 批量回放：选中一组品种跑 profile，输出 CSV 报告 | 中 | 中 |
| **G4** | UI 暗色模式打磨（部分组件深色不一致） | 低 | 低 |
| **G5** | `scripts/convert-stocks-xlsx.mjs` 加 `--help` 和进度条 | 低 | 低 |
| **G6** | 提交 git（建议分两个 commit：A+B+C / D+E+F） | 低 | 必做 |

## 八、CLI 配置注意

- 项目根**没有** `CLAUDE.md`，所有指令来自全局 `~/.claude-internal/CLAUDE.md`
- 用户全局规则要求：
  - 中文沟通
  - 不直接 `rm`，删除走回收站（PowerShell `SendToRecycleBin`）
  - 文件名加 `-cc` 后缀（本文件 `optimization-handoff-cc.md`）
  - 文件内容**不署名工具/模型**
  - 给 file:// 路径方便 Ctrl+Click

## 九、文件路径快查

```
file:///M:/devFolder/market-lab-amplify/README.md
file:///M:/devFolder/market-lab-amplify/docs/optimization-handoff-cc.md
file:///M:/devFolder/market-lab-amplify/src/stores/labStore.js
file:///M:/devFolder/market-lab-amplify/src/composables/useDataLoader.js
file:///M:/devFolder/market-lab-amplify/src/composables/useMarketState.js
file:///M:/devFolder/market-lab-amplify/src/composables/useReplay.js
file:///M:/devFolder/market-lab-amplify/src/composables/usePlanning.js
file:///M:/devFolder/market-lab-amplify/src/composables/usePersisted.js
file:///M:/devFolder/market-lab-amplify/src/components/QuestionNav.vue
file:///M:/devFolder/market-lab-amplify/src/components/FormulaDrawer.vue
file:///M:/devFolder/market-lab-amplify/scripts/check-data-index.mjs
```
