---
name: china-stock-selection
description: Use this skill for beginner-friendly stock selection workflows in Market Lab focused on mainland China and Hong Kong market data, including A-share or HK watchlist screening, domestic CSV refresh checks, and source-labeled candidate pool reports. Trigger when the user asks to choose, screen, rank, or explain stocks using China-market data in this repo.
metadata:
  short-description: Screen China-market stock candidates in Market Lab
---

# China Stock Selection

Use this skill to help entry-level Market Lab users build a source-labeled watchlist for domestic market scenarios. Keep the output as research and observation, not financial advice or a buy/sell command.

## Core Rules

- Work from data first: use `src/data/stock-index.json`, `public/data/*.csv`, and the data refresh flow in `docs/development/data-pipeline.md`.
- Use the whole Market Lab formula map as the selection frame. Formula stages that cannot be truthfully evaluated from domestic OHLCV must still appear as `research-only`, `proxy-only`, or `missing-inputs`, not silently disappear.
- Prefer A-share and HK instruments by default. Include US or crypto only when the user asks for cross-market comparison.
- Every conclusion must show source, market, data-through date, and whether the data is current enough for the requested task.
- Do not invent fundamentals, news, prices, sectors, market caps, or trading calendar facts. If those are needed and not in local data, refresh or explicitly say they are missing.
- Treat the result as a candidate pool: `观察`, `等待`, `剔除`, or `需刷新数据`. Avoid wording like guaranteed upside or direct buy instruction.
- Keep beginner-facing explanations short: signal, risk, why it made or missed the list, and what to verify next.

## Quick Workflow

1. Check repo state and data coverage:

```bash
git status --short
pnpm run check:data
pnpm run check:generated-data
```

2. For a local formula-assisted screen, run:

```bash
node .agents/skills/china-stock-selection/scripts/screen-cn-stocks.mjs --market A股,港股 --top 20
```

Useful variants:

```bash
node .agents/skills/china-stock-selection/scripts/screen-cn-stocks.mjs --market A股 --top 15 --min-rows 240
node .agents/skills/china-stock-selection/scripts/screen-cn-stocks.mjs --market 港股 --top 15 --format json
node .agents/skills/china-stock-selection/scripts/screen-cn-stocks.mjs --market A股,港股 --top 30 --format json
node .agents/skills/china-stock-selection/scripts/screen-cn-stocks.mjs --market A股,港股 --exclude-alcohol false
```

3. If data is stale or missing, use the project pipeline:

```bash
pnpm run plan:market-data
pnpm run refresh:market-data
```

4. Summarize as a watchlist, not a final trade:

```text
范围: A股/港股, daily OHLCV, source ...
数据截至: ...
筛选逻辑: 成本锚(30) + 合成LP分位数主导(45) + z-score回归概率(15) + 数据质量(10)
排除: 酒水板块(9只), 无RSI/KDJ/EMA/MA
候选池: symbol, name, dataThrough, status, score, 成本锚, LP(合成), z-score
JSON模式: --format json 含全量公式字段
剔除/等待: ...
下一步验证: cost anchor stabilization, industry/sector, fundamentals/news if required
```

## Name Resolution

Local `stock-index.json` may only contain codes as labels. The screening script reads `references/stock-names.json` for local convenience names and emits `name` plus `nameSource`.

- If `nameSource` is `local-name-overrides`, say it is a local helper label and verify before publishing.
- If `nameSource` is `unresolved-local-index`, do not guess the name; ask to refresh data or verify from a current market source.
- If the user asks "实际股票名称是什么", answer from the script output first, then verify externally only when exact current names matter.

## Formula Coverage

The screening uses the full Market Lab formula stack. All LP/AMM formulas run in **synthetic mode** (liquidity=1, rangeWidth from ATR) — no on-chain data dependency. The following are NOT used (popular indicators, not part of the project's mathematical framework):

- RSI, KDJ, EMA, MA — excluded

Complete formula stack:

| 模块 | 公式 | 模式 |
|---|---|---|
| 价格路径 → 市场成本 | costAnchor, costBand, costDistance, costSlope5 | real |
| 波动口径 | annualVol, atrPercent | real |
| Δ 成本带 | GetDelta bands (long/short) | real |
| 期权 Greeks | blackScholes delta/gamma/theta | synthetic |
| 亚式近似 | asianOption price | synthetic |
| LP 库存曲线 | uniswapV3Inventory (V3) | **synthetic** |
| 流动性指纹 | liquidityFingerprint (混合密度) | **synthetic** |
| AMM 几何 | ammCurve (xy=k) | **synthetic** |
| 资本效率 | capitalEfficiency | **synthetic** |
| 偏离强度 | deviationScore (z-score) | real |
| 风险曲面 | riskSurface | synthetic |
| Gamma PnL | gammaPnl | synthetic |
| LP 净效率 | netLpEfficiency | **synthetic** |
| 波动率置信 | volConfidence | real |
| 均值回归 | meanReversionHalfLife | real |
| VIX Fix | vixFix | real |
| 订单决策 | buildDecisionGraph | real |
| 资金费率 / 持仓净收益 | fundingRate / netCarry | fallback (no perp data) |

## Screening Semantics

Three-pillar scoring with LP percentile as the dominant signal:

### 成本锚 (30 points)
- **锚方向**: rising ↑ = full points, flattening → = partial, declining ↓ = low
- **价格位置**: within or near cost band scores highest
- Interpretation: anchor direction is the confirmation signal; a declining anchor means wait even if LP/z are aligned

### 合成 LP (45 points)
- **lpValue 分位数 (0-30)**: P<5% = 30, P<10% = 25, P<25% = 18, P<50% = 10
  - P<5% means LP inventory value at 1-year extreme low — LP accumulated maximum stock at cheapest prices
- **zone (0-10)**: range = 10, token0 + low percentile = 10 (best entry setup: LP holds stock at historical low), token0 alone = 4
- **净效率 (0-5)**: netLpEfficiency positive = 5
- Interpretation: token0 zone at P<5% is the ideal setup — LP position is 100% stock bought at historically cheap prices. Anchor stabilization is the only missing piece.

### z-score (15 points)
- **回归概率 (0-8)**: prob ≥ 95% = 8, ≥ 85% = 6, ≥ 70% = 4, ≥ 55% = 2
  - Higher probability = stronger mean-reversion signal
- **折价深度 (0-7)**: z ≤ -3 = 7, ≤ -2 = 6, ≤ -1 = 4
  - Deeper discount = stronger regression potential. Extreme z IS the signal, not noise.

### 数据质量 (10 points)
- Data freshness (stale > 10d penalized) + history depth (500+/1000+ rows bonus)

### 排除规则
- 酒水板块默认排除 (9 symbols): 茅台/五粮液/泸州老窖/洋河/今世缘/酒鬼酒/汾酒/古井贡/水井坊
- `--exclude-alcohol false` to include

Map results:

- `观察` (score ≥ 65): two of three pillars aligned, data current
- `等待` (score ≥ 40): anchor declining or LP not at extreme low, wait for confirmation
- `剔除` (score < 40): data quality issues or no signal alignment
- `需刷新数据`: latest bar > 10 days old

## Output Contract

For stock-selection answers, the markdown table shows:

- Core columns: `symbol`, `name`, `market`, `dataThrough`, `status`, `score`
- Three-pillar columns: `成本锚` (distance + direction + band), `LP(合成)` (zone + value + percentile + net efficiency), `z-score` (σ + regime + regression probability)
- Full formula detail available via `--format json` (includes options, deltaBands, fingerprint, amm, meanReversion, volConfidence, orderPlan)

Never put long market essays into the app UI. If a code change is needed, domain formulas and screening rules belong in `src/domain/`, ViewModel orchestration belongs in `src/stores/` or `src/composables/`, and components should only render compact signals and controls.

Never put long market essays into the app UI. If a code change is needed, domain formulas and screening rules belong in `src/domain/`, ViewModel orchestration belongs in `src/stores/` or `src/composables/`, and components should only render compact signals and controls.
