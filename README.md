# Market Lab

市场路径实验台。一个独立的纯静态前端工作台，用来把 OHLCV 路径、成本锚、波动带、公式研究层和候选挂单计划放在同一个可检查界面里。

在线访问：[https://www.0xff.tools/](https://www.0xff.tools/)

Market Lab 不是 blog，也不是自动交易机器人。它更像一张紧凑的研究和执行前检查桌：数据、公式、图表、控件、来源状态、风险提示和模拟计划都在界面里；长篇解释、研究日志和公式推导放在 `docs/` 或外部 blog。

## 功能概览

- 三栏市场工作台：标的/公式导航、主图、事实与计划面板。
- 静态 OHLCV 数据集：A 股、港股、美股、ETF、BTC 等日线样本。
- 成本与波动状态：滚动 VWAP 成本锚、成本带、ATR、年化波动、动量和观察日期。
- `GetDelta` 价格带：用入场价、持仓时间、IV 和目标收益生成多空价格带。
- 候选挂单计划：只消费 domain 建模后的成本状态、价格带、账户输入和策略档位。
- 研究层可视化：期权 Greeks、LP 库存、资金费率、AMM 几何、组合研究和流动性指纹以研究状态展示。
- 回放旁路：显式开启的 spot path replay，不把研究层指标冒充成默认交易结论。

## 快速开始

```bash
pnpm install
pnpm run dev
```

本地开发服务启动后，打开终端里显示的 Vite 地址。

常用命令：

```bash
pnpm test              # Vitest 测试
pnpm run verify:domain # domain 层数值验证
pnpm run check:data    # 静态数据索引一致性
pnpm run check:size    # src 文件尺寸检查
pnpm run build         # 完整静态构建，输出 dist/
pnpm run preview       # 本地预览 dist/
```

涉及 Pine 脚本时额外执行：

```bash
pnpm run verify:pine
```

## 技术栈

- Vue 3 + JavaScript + Vite
- Pinia 作为 ViewModel 状态层
- lightweight-charts 作为主图表
- d3-dsv 解析 CSV
- Vitest 做 domain / component 测试
- pnpm 管理依赖和脚本

项目保持纯静态部署形态：构建产物是 `dist/`，不依赖后端服务。

## 项目结构

```txt
src/
  App.vue                  # 三栏工作台壳层
  main.js                  # Vue / Pinia / 样式入口
  domain/                  # 纯领域逻辑，不依赖 Vue、Pinia、DOM 或图表库
    formulas/              # GetDelta、期权、LP、AMM、资金费率等公式
    market-data/           # OHLCV 解析、tdpy、成本路径、市场状态
    strategy-planning/     # 默认条件表、账户输入、候选挂单计划
    replay/                # spot path replay 查询模型
    formula-research/      # 研究层快照
    research-visualization/# 研究视图 ViewModel
  stores/                  # Pinia facade / ViewModel 编排
  composables/             # UI 命令、持久化、数据加载、回放和叠加层
  components/              # 工作台组件
  styles/                  # 按界面域拆分的 CSS
  canvas/                  # 公式图画布
  data/                    # 标的索引

public/data/               # 静态 CSV 数据集
docs/                      # 架构边界、公式证据、设计和交接文档
scripts/                   # 构建前检查、公式审计和数据预处理脚本
```

更完整的边界说明见 [docs/bounded-context-map.md](./docs/bounded-context-map.md)。

## 架构原则

Market Lab 按 DDD、MVVM 和 CQRS 约束维护：

- `src/domain/` 只放纯业务规则和查询模型，不能引入 Vue、Pinia、DOM、图表库或浏览器 API。
- Vue 组件只负责展示和交互；Pinia store / composable 负责把 domain 输出编排成 UI 状态。
- 查询路径保持纯计算；导入数据、切换模式、修改输入、触发回放等命令集中在 ViewModel 层。
- 默认挂单计划只能消费明确建模的 domain 查询结果，不能从研究层可视化反向改写计划。
- 新增公式或策略前先确认它属于公式、市场状态、计划、回放、账户模拟、ViewModel 还是展示组件。
- `markPrice`、`entryPrice`、`costAnchor`、`strikePrice`、`startPrice` 必须保持语义独立。

源码文件尽量保持在 500 行以内，`pnpm run build` 会先执行尺寸、数据和 domain 校验。

## 数据与公式状态

当前静态数据目录包含 160+ 个 CSV 样本。数据通过 `src/data/stock-index.json` 和 `src/domain/market-data/ohlcv.js` 暴露给工作台，构建前会检查索引和文件是否一致。

公式分为两类：

- 可执行层：市场路径、成本锚、波动口径、`GetDelta` 价格带、默认条件表和候选挂单计划。
- 研究层：Black-Scholes、LP 库存、AMM、funding、资本效率、组合曲线和流动性指纹。研究层必须标注来源、实现状态和限制，默认不驱动挂单结论。

公式证据和审计文档见 [docs/formula-evidence/README.md](./docs/formula-evidence/README.md)。

## 自动发布

项目已经配置静态自动发布，线上地址是 [https://www.0xff.tools/](https://www.0xff.tools/)。

托管平台读取 [amplify.yml](./amplify.yml)：

1. 安装 pnpm。
2. 执行 `pnpm install --frozen-lockfile`。
3. 执行 `pnpm run build`。
4. 发布 `dist/` 目录。

因此合并前本地至少跑一次：

```bash
pnpm test
pnpm run build
```

## 许可

本项目以 `AGPL-3.0-or-later` 发布，完整法律文本见 [LICENSE](./LICENSE)。

如果你分发本项目、修改版本、派生作品，或把修改后的版本作为网络服务提供给用户，需要按 AGPL 要求提供对应源码。若希望用于闭源产品、闭源 SaaS、闭源内部发行或无法履行 AGPL 义务的场景，需要先取得单独书面授权。

README 中的许可证说明只用于协作提醒；具体权利和义务以 `LICENSE` 文件为准。

## 风险声明

Market Lab 只提供研究、观察和模拟输出，不构成投资建议、交易建议或收益承诺。市场数据、公式结果、研究层指标和候选挂单计划都需要由使用者自行验证。
