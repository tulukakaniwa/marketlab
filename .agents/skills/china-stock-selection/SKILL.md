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
筛选逻辑: formula registry coverage + cost/deviation + delta band + volatility confidence + mean reversion + liquidity proxy + risk penalty
候选池: include symbol, actual local name, dataThrough, status, score, formula note
持仓/收益: show scenario ranges only, never promise returns
剔除/等待: ...
下一步验证: data freshness, industry/sector, fundamentals/news if required
```

## Name Resolution

Local `stock-index.json` may only contain codes as labels. The screening script reads `references/stock-names.json` for local convenience names and emits `name` plus `nameSource`.

- If `nameSource` is `local-name-overrides`, say it is a local helper label and verify before publishing.
- If `nameSource` is `unresolved-local-index`, do not guess the name; ask to refresh data or verify from a current market source.
- If the user asks "实际股票名称是什么", answer from the script output first, then verify externally only when exact current names matter.

## Formula Coverage

Use `src/domain/formulas/registry.js` as the map of "all formulas". For stock selection, split the formula stack this way:

- Direct selection signals: `path`, `cost`, `volatility`, `delta-band`, `order-plan`, `deviation-score`, `mean-reversion`, `vol-confidence`, RSI, and KDJ.
- Risk and stress-test lenses: `option-greeks`, `asian-option`, `risk-surface`, `gamma-pnl`, `capital-efficiency`, and `liquidity-fingerprint`.
- Research-only or missing-input lenses for domestic stocks: `lp-inventory`, `amm-geometry`, `funding`, `portfolio`, `net-lp-efficiency`, and `net-carry` unless the user provides real LP, derivatives, funding, fee, or hedge inputs.

Selection answers should explain both what the formula stack confirms and what it refuses to conclude.

## Screening Semantics

Use local daily OHLCV plus formula outputs for a first pass:

- Trend: close above 20/60/120-day moving averages, and shorter averages above longer averages.
- Momentum: 20/60/120-day returns are positive without being extremely extended.
- Cost and deviation: price versus Market Lab cost anchor, cost band, z-score, and regression probability.
- Delta band: `GetDelta(price, T, iv, profit)` checks whether the current price has a workable observation band.
- Order plan: only consume the domain decision graph. Do not create a separate order ladder in the skill.
- Liquidity proxy: recent traded amount and volume stability. This is only a proxy because local CSVs do not include free float or full order-book depth.
- Risk: ATR percent, 120-day drawdown, volatility confidence, mean-reversion half-life, stale data, and insufficient history.
- Derivative/LP/AMM formulas: use as stress-test and limitation signals unless real inputs are provided.
- Holding and return scenario: derive from ATR, cost band, delta band, order-plan state, mean-reversion half-life, and drawdown. Present as `base` and `stretch` ranges with execution conditions, not as expected guaranteed profit.

Map results for beginners:

- `观察`: trend is aligned, data is usable, and risk is not extreme.
- `等待`: signal is mixed, too extended, or risk is elevated.
- `剔除`: weak trend, shallow history, or poor data quality.
- `需刷新数据`: latest bar is too old for current-market selection.

## Output Contract

For stock-selection answers, include:

- A concise table with `symbol`, `name`, `market`, `dataThrough`, `status`, `score`, `signal`, and `risk`.
- A compact formula note per candidate: `cost/deviation`, `deltaBand`, `meanReversion`, `volConfidence`, and `blockedFormulaInputs`.
- A holding/return scenario per candidate: `holding`, `baseReturn`, `stretchReturn`, `execution`, and `riskTrigger`.
- A short note on data limitations and whether live/current data was verified.
- A next-step checklist that stays within Market Lab's DDD/MVVM boundaries if code changes are requested.

Never put long market essays into the app UI. If a code change is needed, domain formulas and screening rules belong in `src/domain/`, ViewModel orchestration belongs in `src/stores/` or `src/composables/`, and components should only render compact signals and controls.
