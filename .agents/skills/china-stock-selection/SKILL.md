---
name: china-stock-selection
description: Use this skill for beginner-friendly Market Lab research on mainland China and Hong Kong stocks, including A-share or HK watchlist screening, dynamic holding-state analysis, T+1 short-hold formula replay, local CSV coverage checks, source-labelled candidate reports, and interpretation of the CK, LP, AMM, option, Greek, volatility, fee, funding, carry, or portfolio fields exposed by those workflows. Trigger when the user asks to choose, screen, rank, replay, backtest, plan around, or explain China-market candidates in this repository.
---

# China Stock Selection

Build a source-labeled research watchlist from Market Lab's local China-market data. Results are observation candidates, not financial advice or direct buy/sell instructions.

The retail value of this skill is decision discipline: make data quality, assumptions, counter-evidence, invalidation, and execution blockers visible. It must not turn mathematical sophistication into false confidence.

## Required Reading Routes

- For every screen, ranking, explanation, holding-state, or plan request, read `references/retail-decision-contract.md` before producing conclusions.
- Before invoking either CLI or interpreting its output, read `references/cli-contract.md`.
- Before consuming or explaining CK, LP, AMM, options, Greeks, volatility, fee, funding, carry, or portfolio fields, also read `references/formula-risk-contract.md`.
- `references/stock-names.json` is only a local display-name aid. It is not a current market-identity source.
- Read the references from this canonical `.agents/skills/china-stock-selection` directory even when invoked through a generic or Claude wrapper.

## Canonical Runtime

- Canonical implementation: `.agents/skills/china-stock-selection`
- Claude wrapper: `.claude/skills/china-stock-selection`
- Generic-agent wrapper: `skills/china-stock-selection`
- Keep executable logic in the canonical `scripts/` directory. Mirror runtimes must delegate to it instead of maintaining divergent copies.

## Non-negotiable Rules

- Read from `src/data/stock-index.json`, `public/data/*.csv`, and the documented data pipeline.
- Report market, source, last data date, row count, and freshness. Do not invent missing prices, fundamentals, sectors, news, or calendar facts.
- Use `观察`, `等待`, `剔除`, or `需刷新数据`; never imply guaranteed returns.
- Do not use RSI, KDJ, EMA, or MA in screening, scoring, entry, exit, holding state, or explanations. If supplied externally, mark them ignored.
- The recommended-pool query accepts only `DIMENSION_LIBRARY` ids and rebinds every id to its canonical `score`, `requires`, `label`, and `optional` definition; callers may override only `enabled` and `weight`. It also strips `rsi`/`j`, rejects duplicate ids, and the generator does not compute or emit those indicators. Aliases and caller-supplied scorer functions are not permitted extension paths.
- Keep formulas in domain modules and orchestration in scripts/stores. Do not duplicate hidden business formulas in UI components.
- Treat backtests as historical replay with stated assumptions. Never describe replay output as live tradability or future expectancy.
- Preserve the distinction between raw diagnostic score, domain holding state, order-plan gate, and executable status. A high score cannot override a blocked domain gate.
- If account size, loss budget, liquidity, settlement, or transaction-cost inputs are absent, position sizing and executable orders remain unavailable.
- Keep `dataState`, `scoreStatus`, `candidateStatus`, and `executionStatus` separate. This static research skill never emits an executable order.
- Classify every nontrivial claim as `exact-identity`, `sample-estimate`, `calibrated-estimate`, `scenario-proxy`, or `missing-input` according to `references/formula-risk-contract.md`.

## End-to-end Workflow

1. Inspect repository state and data coverage. Do not mix unrelated working-tree changes into a skill change or report.
2. Run `pnpm run check:data` and `pnpm run check:generated-data` before a dated conclusion.
3. Run the screen in JSON mode when a downstream plan or explanation is needed; Markdown is only the compact human view.
4. Keep `scoreStatus` separate from the gated `candidateStatus`. Consume `dynamicHolding`, `orderPlan.blockedReasons`, and every `missingInputs` union before using the word `观察`.
5. Use replay only to test a predeclared rule under disclosed fill assumptions. Do not tune thresholds on the same period and then present the result as validation.
6. Produce the minimum backing decision record defined in `references/retail-decision-contract.md`, including claim classes; unresolved fields stay explicit. The five-question retail view is only its compact projection.

```bash
git status --short
pnpm run check:data
pnpm run check:generated-data
node .agents/skills/china-stock-selection/scripts/screen-cn-stocks.mjs --market A股,港股 --top 20 --format json
```

## Market Scope and Social-security Filter

`--market` accepts `A股`, `港股`, or a comma-separated combination.

The local social-security whitelist contains A-share symbols and therefore applies only to entries whose `market` is exactly `A股`:

- `--require-shebao true` filters A shares against the whitelist.
- Hong Kong stocks always bypass this A-share-only filter.
- The screen defaults to `true`; replay defaults to `false`.
- Do not interpret whitelist membership as current institutional ownership without a dated external source.

## Identity and Provenance

Every candidate must retain:

- `symbol`, `market`, `source`, `dataThrough`, `rows`, and `staleDays`
- `name` and `nameSource`
- active market/filter configuration
- `dataState`, `scoreStatus`, `candidateStatus`, `executionStatus`, and the reasons for every non-ready state

If `nameSource=local-name-overrides`, describe it as a local convenience label. If `nameSource=unresolved-local-index`, keep the symbol and do not guess the company name. Current company identity, corporate actions, fundamentals, sectors, and news require a dated external source when the user asks for them.

## Screening

Run the canonical screen:

```bash
node .agents/skills/china-stock-selection/scripts/screen-cn-stocks.mjs --market A股,港股 --top 20
```

Useful variants:

```bash
node .agents/skills/china-stock-selection/scripts/screen-cn-stocks.mjs --market A股 --top 30
node .agents/skills/china-stock-selection/scripts/screen-cn-stocks.mjs --market 港股 --top 15 --format json
node .agents/skills/china-stock-selection/scripts/screen-cn-stocks.mjs --market A股 --require-shebao false
node .agents/skills/china-stock-selection/scripts/screen-cn-stocks.mjs --market A股 --min-rows 240
```

Optional exclusions can be disabled individually:

```bash
node .agents/skills/china-stock-selection/scripts/screen-cn-stocks.mjs --exclude-alcohol false
node .agents/skills/china-stock-selection/scripts/screen-cn-stocks.mjs --exclude-banks false
node .agents/skills/china-stock-selection/scripts/screen-cn-stocks.mjs --exclude-realestate false
node .agents/skills/china-stock-selection/scripts/screen-cn-stocks.mjs --exclude-northeast false
```

### Score Contract

The total is 100 points:

- Cost structure: 30
- Synthetic CK geometry: 35
- Deviation extremeness: 25
- Data completeness: 10

Do not add `regressionProb` or `netLpEfficiency` to this score. Neither is a validated probability or return measure.

The score is diagnostic only. It cannot upgrade a candidate when the domain dynamic-holding state is not `观察` or the order-plan query remains blocked; expose the raw score state separately from the gated candidate state.

Any Black-Scholes/Asian/Bachelier fields in the screen use historical realized volatility as scenario sigma. Label `volatilitySource=historical-realized-scenario` and `isMarketIv=false`. Without option-chain quotes, bid/ask, contract multiplier and settlement rules, they are not executable option or market-making outputs.

### Screen Output Contract

The compact view contains `symbol`, `name`, `market`, `dataThrough`, gated `status`, `score`, cost state, synthetic CK geometry, and deviation extremeness.

The JSON view is the authoritative machine contract. Preserve at least:

- top-level data/filter provenance and `syntheticCkGeometry` disclosure
- machine-readable `stateContract`, complete `claimClassContract.allowedValues`, and
  emitted-claim map `claimClasses`
- `dataState`/`dataStateReasons`, both `scoreStatus` and gated
  `candidateStatus`/legacy `status`, `executionStatus`, and their reasons
- `cost`, `deviation`, `meanReversion`, `dynamicHolding`, and `orderPlan`
- `deltaBands`, option scenario, Gamma scenario, volatility confidence, and their input modes
- synthetic CK geometry, fingerprint, AMM geometry, and LP research attribution
- explicit `funding.hasFunding=false` / `netCarry=null` when the market has no corresponding data

Do not silently omit a model layer because its inputs are missing. Return `null`, `missingInputs`, `research-only`, `proxy-only`, or `calibration-required` as appropriate.

### Deviation Extremeness

`deviationScore()` exposes a normal-reference percentile and two-sided tail:

```text
deviationPercentile = 2 * Phi(abs(z)) - 1
twoSidedTailProbability = 2 * (1 - Phi(abs(z)))
```

The score uses the two-sided normal-reference tail together with negative z depth. `probabilitySemantics` must remain `normal-reference-extremeness-not-mean-reversion-probability`.

For a current cost-distance observation `x` and valid historical sample `x_i`:

```text
percentilePct = count(x_i <= x) / n * 100
lowerTailPct  = count(x_i <= x) / n * 100
upperTailPct  = count(x_i >= x) / n * 100
twoSidedTailPct = min(1, 2 * min(lowerTail, upperTail)) * 100
```

Both families describe extremeness. Neither is a probability that price will revert, rise, or hit a target. A low tail only says the standardized or historical observation was unusual under its stated reference.

### Synthetic CK Geometry

The CK/Uniswap-v3 calculation uses a normalized synthetic setup:

- `liquidity = 1`
- range is symmetric around the rolling cost anchor
- range width is derived from ATR and bounded by the script
- normalization divides the unit-liquidity value by the same synthetic range valued at its rolling cost anchor
- the historical percentile ranks this dimensionless synthetic ratio

It is only a geometry diagnostic. It is not:

- a real LP position or token inventory
- a stock accumulation amount
- fee income, PnL, carry, or investment return
- a price or mean-reversion probability

Capital-efficiency and relative-IL fields are shape diagnostics under the synthetic inputs. Pass them through `lpResearchAttribution()` so dimensional semantics remain explicit. With no path-calibrated fees and common horizon, its status must remain `calibration-required` and `returns.netReturn` must remain `null`. Do not call these fields realized or expected returns. The geometry may contribute to screening diagnostics, but it must not be turned into a fabricated LP upper-price target.

CK's exact symmetric capital-efficiency frontier and its valuation-basis caveat are specified in `references/formula-risk-contract.md`. The exact `±84.13%` result may be explained as a theorem under its own objective, but never installed as a default stock range, probability band, fee optimum, or PnL optimum. Do not combine its geometric-midpoint efficiency with the screen's current-versus-anchor normalized synthetic value; they use different valuation bases.

### Dynamic Holding Targets

Dynamic target generation consumes cost-band structure only:

- `costLower`
- `anchor`

The output must state `targetInputMode=cost-band-and-anchor-only` and `syntheticCkGeometryUsedAsTarget=false`. Synthetic CK range bounds are never target prices.

Any `expectedDays`, `expectedReturn*`, or `monthlyEfficiency*` field is a conditional zero-shock AR-path projection under the frozen sample state. It is not a forecast, expected realized return, promised holding period, or position-sizing input.

### Options, LP, and Market-making Escalation

The stock screen exposes some option/LP fields to teach and compare risk geometry. They do not make this skill an executable option or AMM trader.

- Historical realized volatility is a scenario sigma, not market IV.
- A blank premium remains missing; explicit zero is a distinct input.
- Capital efficiency is a leverage/geometry multiple, not a return.
- Liquidity fingerprint mass is a model allocation weight, not a price probability.
- Pool fee tier is not fee income. Fee return needs a volume/liquidity-share/in-range/cost path.
- `fee ≈ theta` is an analogy only after currency, notional, sign, and horizon are aligned.
- Portfolio PnL must use entry cashflows and mark values on one ledger. Scenario totals stay separate from formal totals with missing inputs.
- `orderPlan.signalStrength` is normal-reference extremeness, not confidence, win probability, or calibrated edge. Any nominal amount derived from it remains `simulation-only`.

If a user requests an executable option, LP, hedge, or market-making plan, apply the promotion checklist in `references/formula-risk-contract.md`. Until every required input is present, report the missing inputs and remain `research-only` or `calibration-required`.

## T+1 Short-hold Replay

Run replay or a latest-observation scan:

```bash
node .agents/skills/china-stock-selection/scripts/replay-short-hold.mjs
node .agents/skills/china-stock-selection/scripts/replay-short-hold.mjs --profile swing
node .agents/skills/china-stock-selection/scripts/replay-short-hold.mjs --profile combo
node .agents/skills/china-stock-selection/scripts/replay-short-hold.mjs --profile combo --mode latest
node .agents/skills/china-stock-selection/scripts/replay-short-hold.mjs --market 港股 --mode latest
```

Profiles are `strict`, `swing`, and `combo`. `--target-mode structure` is the default; `--target-mode fixed` is an explicit alternate price-target assumption, not a bypass around dynamic-holding or phase gates. `low-compression` remains `等待` in both modes.

All defaults, units, profile precedence, output fields, and fill limitations live in `references/cli-contract.md`; do not infer them from flag names.

Relevant overrides include:

```bash
--min-z 2
--ck-geometry-max 3
--max-hl 12
--min-distance 10
--max-distance 16
--min-slope -1
--max-slope 1
--max-hold 5
--fee 0.0011
```

`--lp-max` remains a compatibility alias for `--ck-geometry-max`; new calls and reports must use the CK-geometry name.

Replay signal output includes:

- z score and half-life diagnostics
- normal-reference deviation percentile/two-sided tail with `probabilitySemantics`
- empirical deviation percentile, lower/upper tail, two-sided tail, and sample size
- synthetic CK geometry percentile and model label
- cost distance/slope
- cost/anchor-only dynamic holding state
- entry/exit assumptions and fee-adjusted historical result in replay mode
- market source and name-source provenance

Replay safety rules:

- only positive `rho` with `decayMode=monotonic-decay` may use the half-life target model; negative-rho oscillation and non-stationary estimates are ineligible
- the signal is observed at close and entry occurs at the next session open; use the signal-day frozen cost structure and statistical state to rebase target return and eligibility at that open
- if both stop and target lie inside the same OHLC bar, resolve the ambiguous path as stop-first and disclose `intrabarPolicy=stop-first-conservative-when-both-hit`
- `--require-shebao true` uses the current static whitelist and therefore has point-in-time lookahead in historical replay; keep it off by default and disclose the limitation when enabled

All deviation fields remain extremeness diagnostics, not a reversion probability. The CK percentile remains synthetic geometry, not a real LP metric.

## Data Validation

Before using output for a dated request:

```bash
pnpm run check:data
pnpm run check:generated-data
pnpm run check:skill-runtime
```

Refresh only through the project's existing pipeline. Preserve local source labels and disclose when the available CSV ends before the requested date.

For code changes, validate in proportion to scope:

```bash
pnpm test
pnpm run audit:formulas
pnpm run build
```

## Output Checklist

Every report should include:

1. Market and requested universe.
2. Data source, data-through date, row count, and freshness.
3. Active exclusions and whether the A-share-only social-security filter is enabled.
4. Candidate state and concise reason.
5. Normal-reference and empirical deviation percentile/two-sided tail with the non-probability disclaimer.
6. Synthetic CK geometry label with the non-position/non-return disclaimer.
7. Cost/anchor-only target provenance.
8. Replay assumptions and risks when historical simulation is used.
9. Supporting evidence, counter-evidence, invalidation condition, and unresolved inputs when the user asks for a plan.
10. Explicit execution status; without account/risk/liquidity inputs it cannot be `executable`.

The retail default view should answer five questions: is the data usable, what is the gated state, why, what would invalidate the thesis, and what must be checked next. Keep formulas and evidence available in the research layer, not as a wall of equations in the main workbench.

Keep the report compact and decision-oriented. Longer research notes belong outside the Market Lab workbench.
