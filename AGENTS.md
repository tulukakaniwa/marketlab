# Agent Guide

## 项目形态

- 这是独立的纯静态 Market Lab，使用 Vue 3、JavaScript、Vite、Pinia、lightweight-charts 和 pnpm。
- 保持静态部署：`pnpm run build`，发布 `dist/`。
- 这不是 blog。长解释、研究笔记、公式文章和日志放回 blog。

## 架构

- `src/domain/`：纯公式、市场、计划和回放逻辑，不引入 Vue。
- `src/stores/`：Pinia ViewModel，只负责把 domain 输出接到 UI 状态。
- `src/components/`：紧凑工作台组件，优先图表、表格、控件和状态信号。
- `src/styles/`：按界面域拆 CSS。
- `public/data/`：静态数据集。

## 产品规则

- Lab 是工作台，不是文章。
- 主界面不要放长段落。
- 前端文字以标签、单位、状态、风险提示和来源标记为主。
- 公式关系必须先成为结构化输入输出，再进入 UI。
- 不要混用 `markPrice`、`entryPrice`、`costAnchor`、`strikePrice` 和 `startPrice`。

## 公式规则

- `GetDelta(price, T, iv, profit)` 是任意入场价和持仓时间上的价格带引擎。
- `OrderPlan` 必须消费公式带和市场成本状态，不能另起一套无关梯度公式。
- Black-Scholes、LP 库存、funding、资本效率默认属于风险层和组合层。
- 回放和账户模拟必须有边界或异步执行，不要在热 computed 里跑无界历史计算。

## 文件尺寸

- 源文件尽量保持在 500 行以内。
- 增加行为前先按职责拆文件。

## GitFlow

- `main` 只放可发布的静态版本；不要在 `main` 上直接堆功能改动。
- 日常开发从 `main` 拉 `feature/<scope>` 分支；修线上问题用 `hotfix/<scope>`；发布整理用 `release/<version>`。
- 每个分支只处理一个明确主题，提交前跑 `pnpm test` 和 `pnpm run build`；涉及 Pine 时补跑 `pnpm run verify:pine`。
- 合并回 `main` 前确认工作区只包含本次主题文件；截图、页面快照、临时检查日志不要提交。
- 合并后推送 `main`，并保留清楚的提交信息：`feat:`、`fix:`、`docs:`、`build:`、`test:`。
