---
name: china-stock-selection
description: Use this skill for Market Lab A-share and Hong Kong stock screening, source-labeled candidate reports, and T+1 short-hold replay.
---

# China Stock Selection — Claude Runtime Wrapper

执行任何选股或回放前，完整阅读 `.agents/skills/china-stock-selection/SKILL.md`（sole semantic and safety contract）。本目录仅作 Claude 运行时薄封装，所有算法与契约统一委托给 `.agents` 标准实现。

```bash
node .claude/skills/china-stock-selection/scripts/screen-cn-stocks.mjs --market A股,港股 --top 20
node .claude/skills/china-stock-selection/scripts/replay-short-hold.mjs --profile combo --fee 0.0011
```

核心守则：

- 社保白名单仅过滤 `A股`，`港股` 自动绕过；历史回放默认关闭静态白名单以防前视偏差。
- `probabilitySemantics`：正态参考分位与历史经验分位仅度量偏离极端度，不是未来回归概率（not a future mean-reversion probability）。
- `synthetic CK geometry` 是基于滚动成本锚的无量纲形状诊断，不是真实 LP 仓位、持币量或手续费收益。
- 动态目标仅消费 `costLow` 与 `costAnchor`；AR 修复周期为冻结结构下的零冲击条件投影。
- 严禁引入 RSI、KDJ、EMA、MA 参与评分或门禁；所有模拟仓位保持 `simulation-only`。
