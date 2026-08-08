# China Stock Selection CLI Contract

This reference records the current command-line behavior of the canonical runtime in
`.agents/skills/china-stock-selection/scripts/`. Read it before running, overriding, or
interpreting the screen or replay. The CLI is a research runtime, not an order router.

The executable scripts remain the source of truth. When their defaults, units, fields,
or fill rules change, update this contract and `scripts/check-china-stock-skill-runtime.mjs`
in the same change.

## Shared Invocation Rules

- Canonical screen: `node .agents/skills/china-stock-selection/scripts/screen-cn-stocks.mjs`
- Canonical replay: `node .agents/skills/china-stock-selection/scripts/replay-short-hold.mjs`
- Generic and Claude runtimes must delegate to these canonical scripts.
- Flags use `--key value`. A flag without a following value becomes boolean `true`.
  Declared boolean options reject values other than `true` or `false`; declared enum
  options reject unknown values.
- Unknown flag names, positional arguments, and missing values for non-boolean flags
  fail. This prevents a typo or incomplete override from looking applied.
- Paths are resolved from the repository root, not the caller's current directory.
- Only local index and CSV inputs are read. Neither CLI fetches current quotes, company
  identity, fundamentals, sectors, news, calendars, option chains, or account state.
- Percent-like inputs are not uniform: the tables below distinguish decimal return
  fractions from percentage-point thresholds.

## Screen CLI

### Screen options

| Flag                   |                     Default | Unit / accepted value                     | Runtime meaning                                                                                                                                      |
| ---------------------- | --------------------------: | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--market`             |                  `A股,港股` | comma-separated exact market labels       | Includes entries whose `market` is in the requested set.                                                                                             |
| `--top`                |                        `20` | positive integer count                    | Final candidate gate is ordered first (`观察`, `等待`, `剔除`, `需刷新数据`), then diagnostic score within each state. Invalid supplied values fail. |
| `--min-rows`           |                       `180` | OHLCV row count                           | Skips a file with fewer parsed rows. This is not a freshness test.                                                                                   |
| `--format`             |                  `markdown` | `markdown` or `json`                      | Unknown values fail instead of silently changing the output contract.                                                                                |
| `--require-shebao`     |                      `true` | boolean                                   | The whitelist is applied to A shares only; Hong Kong entries bypass it.                                                                              |
| `--exclude-alcohol`    |                      `true` | boolean                                   | Controls the hard-coded A-share symbol exclusion.                                                                                                    |
| `--exclude-banks`      |                      `true` | boolean                                   | Controls the hard-coded A-share symbol exclusion.                                                                                                    |
| `--exclude-realestate` |                      `true` | boolean                                   | Controls the hard-coded A-share symbol exclusion.                                                                                                    |
| `--exclude-northeast`  |                      `true` | boolean                                   | Controls the hard-coded A-share symbol exclusion.                                                                                                    |
| `--index`              | `src/data/stock-index.json` | repository-relative or absolute path      | Instrument index and its local source labels.                                                                                                        |
| `--data-dir`           |               `public/data` | repository-relative or absolute directory | Directory containing the CSV named by each index entry.                                                                                              |
| `--name-map`           |      local reference lookup | repository-relative or absolute JSON path | Optional display-name map; it is not current identity evidence.                                                                                      |

The screen has no fee, slippage, account, position-size, or order-quantity input.

### Screen JSON contract

Top-level fields are:

- `schemaVersion=china-stock-selection.screen.v1`, `generatedAt`, `markets`, `top`,
  and `minRows`
- `provenance` with canonical runtime, local data model, index, data directory, and
  name-map inputs
- complete `filters` with markets, all four optional exclusion toggles, and
  `requireShebaoForAshareOnly`
- aggregate `freshness` and `audit`, including considered/data-ready/emitted/skipped
  counts and `skipReasons`
- `stateContract`, `claimClassContract.allowedValues`, and `claimClasses`. The
  contract field exposes the complete five-value enum; `claimClasses` maps only
  claims actually emitted by this runtime
- `syntheticCkGeometry` disclosure
- `researchBoundary` with `status=research-only` and `executionStatus=blocked`
- `ranked` candidates and reason-coded `skipped` records

Each ranked candidate preserves at least:

- identity/provenance: `symbol`, `label`, `name`, `nameSource`, `market`, `source`
- data coverage: `dataThrough`, `rows`, `staleDays`
- decision separation: `dataState`/`dataStateReasons`, diagnostic `score` and
  `scoreStatus`, gated `candidateStatus` plus compatibility alias `status`,
  `statusReasons`, `executionStatus`, and `executionReasons`
- row-level `claimClasses` using only the enum from `formula-risk-contract.md`
- row-level `freshness` and `provenance`
- compact diagnostics: `costNote`, `ckGeometryNote`, `zNote`, `avgAmt20`
- structured `formula` with `tdpy`, `cost`, `deviation`, `deltaBands`, `options`,
  `gammaConvexity`, `syntheticCkGeometry`, `fingerprint`, `amm`, `funding`,
  `netCarry`, `volConfidence`, `meanReversion`, `dynamicHolding`, `vixFix`, and
  `orderPlan`

Important field semantics:

- `dataState` alone carries freshness and provenance readiness. `scoreStatus` is only
  `diagnostic-high`, `diagnostic-medium`, or `diagnostic-low`; it never carries stale
  state. `candidateStatus` is the final gate after dynamic-holding and
  `orderPlan.blockedReasons`; score cannot override a blocked gate.
  The emitted top set is ordered by this final gate before raw score.
- Valid, current local OHLCV remains `dataState=provisional` in this bundled candidate
  record because corporate actions, exchange state, point-in-time identity, and live
  execution inputs are not all verified. `ready` is reserved by the enum for a future
  input path that verifies the declared claim scope; it is not emitted by the current
  local-only CLIs.
- `options.volatilitySource=historical-realized-scenario` and `isMarketIv=false`.
  `options.missingInputs` keeps market option data explicit.
- `funding.hasFunding=false` and `netCarry=null` are deliberate for unsupported A/H
  stock funding data.
- `syntheticCkGeometry`, `fingerprint`, AMM, option, and Gamma values are research
  geometry/scenarios, not positions, quoted prices, probabilities, or executable PnL.
- `syntheticCkGeometry.capitalEfficiencyMultiple` uses the declared
  `capitalEfficiencyValuationBasis=range-geometric-midpoint`; when the arithmetic
  reference is treated as current price, consume the separately reported
  `capitalEfficiencyAtArithmeticCenterMultiple`. Neither shares the normalized
  current-versus-anchor synthetic-geometry basis.
- `syntheticCkGeometry.fullRangeV2IlProxyPct` is a constant-product v2 proxy based on
  current price versus cost anchor. It does not consume the synthetic v3 range bounds
  and must never be described as that range's v3 IL.
- Candidate `candidateStatus`/legacy `status` is one of `需刷新数据`, `剔除`, `等待`, or `观察`;
  `executionStatus` remains `blocked`, so none means an order.

Residual provenance limitation: the JSON records input paths, coverage end, row count,
freshness, filters, and skip reasons, but not the exact command string, per-file digest,
or coverage start. Preserve those separately when a byte-for-byte audit is required.

## Replay and Latest-scan CLI

### Global replay options

| Flag               |                     Default | Unit / accepted value                         | Runtime meaning                                                                                  |
| ------------------ | --------------------------: | --------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `--profile`        |                    `strict` | `strict`, `swing`, `combo`                    | Unknown values fail. Combo evaluates fast first, then swing.                                     |
| `--mode`           |                    `replay` | `replay`, `latest`                            | Unknown values fail. Latest emits current eligible observations without simulated exits.         |
| `--market`         |                       `A股` | `A股`, `港股`, or comma-separated combination | Unknown market labels fail; `config.markets` preserves the resolved set.                         |
| `--fee`            |                    `0.0011` | decimal return fraction                       | One total replay drag: `netReturn = grossReturn - feeRate`; 0.0011 means 0.11 percentage points. |
| `--require-shebao` |                     `false` | boolean                                       | Enables the current static whitelist for A shares only; Hong Kong entries bypass it.             |
| `--min-rows`       |                       `360` | OHLCV row count                               | Files below this count are skipped.                                                              |
| `--format`         |                  `markdown` | `markdown` or `json`                          | Unknown values fail.                                                                             |
| `--index`          | `src/data/stock-index.json` | repository-relative or absolute path          | Instrument index.                                                                                |
| `--data-dir`       |               `public/data` | repository-relative or absolute directory     | OHLCV CSV directory.                                                                             |
| `--name-map`       |      local reference lookup | repository-relative or absolute JSON path     | Optional display-name map and its source label.                                                  |

### Profiles and override units

| Override            | Strict / `strict-5d` | Swing / `swing-10d` | Unit and rule                                                          |
| ------------------- | -------------------: | ------------------: | ---------------------------------------------------------------------- |
| `--target`          |               `0.03` |              `0.04` | decimal gross-return floor: 3% / 4%                                    |
| `--stop`            |              `0.015` |             `0.015` | decimal loss fraction: 1.5%                                            |
| `--min-z`           |                  `2` |               `2.5` | absolute negative z threshold; signal requires `z <= -minZ`            |
| `--ck-geometry-max` |                  `3` |                 `5` | synthetic CK geometry percentile points, not a probability             |
| `--lp-max`          |                alias |               alias | compatibility alias for `--ck-geometry-max`; do not use in new reports |
| `--max-hl`          |                 `12` |                `20` | modeled trading days; only positive monotonic AR decay is eligible     |
| `--min-slope`       |                 `-1` |                `-1` | cost-slope percentage points                                           |
| `--max-slope`       |                  `1` |               `0.5` | cost-slope percentage points                                           |
| `--min-distance`    |                 `10` |                `12` | absolute percentage points below the cost anchor                       |
| `--max-distance`    |                 `16` |                `22` | absolute percentage points below the cost anchor                       |
| `--max-entry-gap`   |                `0.5` |               `0.5` | next-open gap percentage points versus signal close                    |
| `--min-entry-gap`   |                 `-3` |                `-3` | next-open gap percentage points versus signal close                    |
| `--max-hold`        |                  `5` |                `10` | trading sessions after entry                                           |
| `--min-sell-days`   |                  `1` |                 `1` | sessions after entry before the first exit check                       |
| `--target-mode`     |          `structure` |         `structure` | `structure` or explicit alternate `fixed`; unknown values fail         |
| `--anchor-recovery` |              `0.875` |             `0.875` | decimal recovery fraction used by structural target construction       |

Every supplied profile override applies to each profile selected by `combo`. A signal is
assigned to the first eligible profile, so `fast-5d` takes precedence over `swing-10d`
for an observation that passes both.

Supplied numeric overrides are strict: non-finite or out-of-domain values fail rather
than falling back. `fee` is in `[0,1)`; `target` and `stop` are in `(0,1)`; `min-z` is
non-negative; the CK geometry threshold is in `[0,100]`; maximum half-life is positive;
distance bounds are non-negative; holding fields are positive integers; and anchor
recovery is in `(0,1]`. Minimum slope, distance, and entry-gap bounds must not exceed
their maximums, and `min-sell-days` must not exceed `max-hold`. Screen `top`, screen
`min-rows`, and replay `min-rows` are also strict positive integers.

### Replay sample and non-overlap rules

- The default file gate is `minRows=360`.
- Historical signal scanning starts at zero-based `startIndex=260`, the 261st row, so
  every tested signal has 260 earlier rows available.
- CK geometry rank uses at most 242 observations including the signal; empirical
  deviation uses at most 726; mean-reversion fitting uses at most 180.
- Signals must have negative cost distance, positive monotonic mean reversion
  (`0 < rho < 1`, `isMeanReverting=true`, `decayMode=monotonic-decay`), and pass the
  selected profile gates.
- Accepted trades do not overlap within an instrument. After a trade is accepted,
  `nextAllowedIndex = signalIndex + selectedProfile.maxHoldingDays + 1`; this reserves
  the full profile window even if the simulated trade exits earlier.
- Non-overlap resets for each instrument. There is no portfolio-level capital or
  cross-symbol overlap constraint.
- The loop leaves enough trailing rows for next-session entry and the longest selected
  profile. Latest mode evaluates only the final row after the 360-row file gate.

### Signal, entry, and exit timeline

The default conservative timeline is:

```text
T session close: observe signal
T+1 next session open: enter if the open-gap gate passes
T+2 earliest session: first stop/target check when minSellDays=1
```

More exactly:

- `entryIndex = signalIndex + 1`; entry price is that row's `open`.
- Structural targets are recomputed against the actual entry open and retain
  `targetTiming=signal-context-frozen-target-recomputed-with-next-session-open` and
  `targetRecomputedAtEntry=true`.
- `targetContextPolicy=cost-band-deviation-half-life-and-drawdown-frozen-at-signal-close`:
  the entry open changes the target price calculation, while cost band, deviation,
  half-life, slope, and drawdown context remain frozen at signal close.
- Exit scanning begins at `entryIndex + minSellDays`.
- Stop is `entryPrice * (1 - stopLoss)`. A fixed target is
  `entryPrice * (1 + targetReturn)`; structure mode uses the recomputed eligible target.
- Fixed target mode changes only the price target assumption. It still computes and
  enforces the same dynamic-holding and phase gates; `low-compression` remains `等待`,
  and replay trades require the short-plan action to be `execute`.
- If stop and target both fall inside one daily OHLC bar, stop wins and output retains
  `intrabarPolicy=stop-first-conservative-when-both-hit` plus `intrabarBothHit=true`.
- Stop/target hits fill exactly at their boundary. A max-hold exit fills at that day's
  close.

This timing is deliberately conservative for Hong Kong stocks too: although Hong Kong
shares generally permit same-day resale, the runtime does not inspect the entry-day
high/low and waits until the next session by default. Both A-share and Hong Kong
annualization use 242 trading days. Hong Kong entries bypass the A-share social-security
whitelist.

### Fee and return semantics

`--fee` is a single dimensionless round-trip drag subtracted once from gross return in
`replay` mode:

```text
grossReturn = exitPrice / entryPrice - 1
netReturn   = grossReturn - feeRate
```

It is not a per-side rate, LP fee tier, broker tariff, or cash ledger. The replay does
not separately model commission minimums, stamp duty/tax, exchange and clearing fees,
transfer fees, bid/ask spread, slippage, market impact, FX, financing, or borrow cost.
Reports must call it an assumed aggregate fee drag, not actual transaction cost.
In `latest` mode there is no return simulation: `feeAppliedToReturns=false`,
`feeModel.appliedRate=null`, and the requested fee is retained only as provenance.

### Replay JSON contract

Top-level fields are:

- `schemaVersion=china-stock-selection.replay.v1` and `generatedAt`
- resolved `config`, including `profile`, `mode`, `market`, `feeRate`,
- `markets`, `feeAppliedToReturns`, `feeModel`, `requireShebao`, `minRows`, `format`,
  `intrabarPolicy`, `targetTiming`, `targetContextPolicy`, `shebaoEvidence`, resolved
  `profiles`, and `requireShebaoForAshareOnly`
- `provenance`, complete `filters`, aggregate `freshness`, `audit`, and
  `researchBoundary`
- machine-readable `stateContract`, complete `claimClassContract.allowedValues`, and
  emitted-claim mapping `claimClasses`
- `syntheticCkGeometry` disclosure
- `summary`
- `trades` in replay mode or `signals` in latest mode, plus reason-coded `skipped`

Every eligible signal includes:

- profile and target: `profile`, `profileTargetPct`, `profileStopPct`, `targetMode`,
  `targetId`, `targetPrice`
- provenance: `symbol`, `name`, `nameSource`, `market`, `source`, `dataThrough`,
  `rows`, `staleDays`, row-level `freshness`, `provenance`, and `signalDate`
- gated research state: `dataState`, `dataStateReasons`,
  `scoreStatus=not-applicable`, `candidateStatus` plus compatibility alias `status`,
  `statusReasons`, `executionStatus`, and `executionReasons`
- row-level `claimClasses` using only the enum from `formula-risk-contract.md`
- mean-reversion diagnostics: `z5`, `halfLifeDays`, `meanReversionRho`,
  `meanReversionDecayMode`
- normal-reference and empirical deviation fields with
  `deviationProbabilitySemantics`
- `ckGeometryPercentile`, `ckGeometryModel`, `ckGeometryInterpretation`
- cost fields, conditional zero-shock holding projections, `dynamicHolding`, and flattened dynamic-state
  fields such as `dynamicStatus`, `shortPlan`, `fundPlan`, and `waitingReasons`
- `eligible=true`, meaning only that the research signal passed the declared gates

Replay trades add `entryDate`, `exitDate`, `entryGapPct`, `entryPrice`, `exitPrice`,
`signalTargetPrice`, recomputed `targetPrice`, `targetRecomputedAtEntry`, `targetTiming`,
`targetContextPolicy`, `reason`, `intrabarBothHit`, `intrabarPolicy`, `holdDays`,
`grossReturnPct`, and `netReturnPct`.

Replay `summary` reports trade count, win/target/stop percentages, average, median,
p10, p90, worst, best, and per-profile summaries. Latest `summary` reports eligible
signal counts by profile. These are in-sample historical diagnostics, not expected
future return.

Residual provenance limitations: replay now emits input paths, filters, coverage end,
row count, freshness, names and name sources, audit counts, and skipped-symbol reasons.
It still does not emit the exact command string, per-file digest, or coverage start;
preserve those separately when byte-for-byte auditability is required.

## Unmodeled Execution and Cost Mechanisms

Neither CLI models or verifies:

- live bid/ask, depth, spread, slippage, impact, latency, partial fills, or rejected orders
- gap-through stop/target fills; daily-bar boundaries are filled at the declared level
- exchange price limits, trading halts, auctions, suspensions, tick size, board lot, or
  broker minimum-order rules
- A-share or Hong Kong commissions, taxes/stamp duty, levies, transfer/clearing fees,
  minimum commissions, or currency conversion
- account cash, position size, portfolio loss budget, settlement availability, margin,
  financing, securities borrowing, liquidation, or cross-position exposure
- point-in-time constituents, delistings, survivorship bias, corporate-action identity,
  fundamentals, news, or event calendars
- train/validation/holdout separation or parameter-selection bias

Therefore `eligible=true`, `观察`, a high score, a high win rate, or a positive
`netReturnPct` never promotes output to `executable`. The safe terminal states remain
research-only, calibration-required, missing-input, `需刷新数据`, `剔除`, `等待`, or
`观察` until a separate execution workflow supplies and validates the missing inputs.

## Required Provenance for Reports

For a result intended to be reproducible, retain:

1. exact command and resolved profile configuration
2. symbol, market, source/name source, CSV identity, coverage start/end, rows, and freshness
3. active filters, including the point-in-time limitation of a static whitelist
4. `dataState`, raw `scoreStatus`, gated `candidateStatus`, and `executionStatus`
5. signal, entry, earliest-exit, target-recompute, intrabar, max-hold, and fee assumptions
6. model labels and non-probability/non-return disclaimers
7. missing account, liquidity, cost, settlement, and fill inputs
