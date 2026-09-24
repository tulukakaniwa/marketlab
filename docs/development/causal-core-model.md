# Causal Core Model

The workbench exposes a separate `graph.causalModel` query. Its pure domain owner
is `src/domain/market-model/`; `useCausalModel` schedules the query and the
"因果模型" disclosure presents its results. It has no order execution authority.

## Information boundary

- `buildCausalModelSnapshot({ rows, tradingDaysPerYear, observationIndex })` first
  slices the observation prefix. It does not accept scenario IV, holding periods,
  entry prices, future targets, or externally fitted full-sample parameters.
- At session t, the filter scores the observation using parameters through t−1.
  Only afterward does it learn from t and publish a snapshot available at t:close.
  `predictionAudit.parametersThrough` and `parametersThrough` distinguish the two.
- There is no backward smoother, full-history parameter fit, centered window, or
  normalization based on later data. Appending or perturbing future rows leaves
  all earlier states unchanged.
- Explicit `isClosed: false` / `closed: false`, invalid observations, sparse rows,
  and duplicate or unordered dates break the learning segment. A later valid row
  reinitializes it instead of forming a return across missing observations.
- CSV rows without closure flags retain the project's completed daily-bar input
  contract. The pure domain layer does not infer exchange closure from wall time.
  Unrepresented missing sessions cannot be identified without an exchange calendar.

## State estimation

The forward Kalman filter estimates a local linear log-price level and drift.
Its process and observation noise use the previous session's innovation variance.
`equilibrium.price` is a statistical equilibrium proxy, distinct from observed
`markPrice`, rolling `costAnchor`, and position `entryPrice`.

Three conditional Gaussian experts represent reversion toward that filtered
level, a learned return drift, and a zero-drift high-variance shock. Forward
likelihood updates produce model weights. Discounted soft transition counts update
a row-stochastic Markov matrix. The reversion coefficient and trend drift use
discounted, regime-weighted observations with explicit priors.

Conditional innovation variance uses EWMA of one-step forecast errors. Reported
annualized conditional volatility includes next-regime mixture variances and the
dispersion between their means; `innovationAnnualized` preserves the base EWMA
quantity. This implementation is an adaptive Gaussian regime ensemble, not a
joint Bayesian switching filter, fitted GARCH, or Student-t model.

Fixed priors and numerical floors are listed in `causalStateAssumptions.js` and
copied to `state.modelAssumptions`. No-future-input does not mean parameter-free.
The initial volatility, persistence priors, learning rates, shock variance ratio,
and minimum contiguous sample count are declared modeling choices, not market
facts. `ready` indicates input readiness, not statistical certainty.

## First-passage query

The target is the current equilibrium estimate. The opposite boundary is the
same log-distance from the observed price. Both are research query boundaries,
not an entry, stop-loss, or automatically selected optimal exit.

Let d be the log-distance to equilibrium, and v the next-regime-weighted
innovation variance. The default query window is `max(1, ceil(d²/v))`, a current
diffusion time scale. It is not an expected hitting time, a forecast holding
period, or a manually supplied future parameter. An indistinguishable anchor or
degenerate variance leaves the passage query unavailable.

The solver starts at the exact current log-price, integrates Gaussian probability
over cells and both unbounded tails, and absorbs boundary mass. At subsequent
sessions it first transitions regime i to j and then applies expert j's price
kernel. Parameters and the equilibrium point remain frozen at the observation;
the regime itself can transition. It does not know future volatility or future
anchor values. Anchor-estimation uncertainty is reported separately and is not
repeatedly injected as independent multi-step noise.

Outputs distinguish target-first, risk-first, and no-hit-within-window probability.
Their sum remains one. Conditional medians refer only to paths hitting the named
boundary within the computed window. Observation mode is session close; daily
OHLC does not establish the order or timing of intraday boundary crossings.

Default workbench limits are 61 price cells and 128 sessions. The public solver
has hard limits of 121 cells, 256 sessions, and 8 regimes. Requested and computed
windows remain separate when capped. Metadata reports mass error, CDF tolerance,
and grid resolution; the UI flags coarse resolution. These are numerical model
estimates, not calibrated win rates.

## ViewModel and verification

The ViewModel immediately invalidates results on date, instrument, or annual
session-count changes. It copies only the visible prefix, schedules one bounded
query outside hot computed state, and rejects stale completions with a ticket.
It does not alter GetDelta inputs, existing candidate gates, or order plans.

Tests cover append and future-mutation invariance, lagged predictive parameters,
unclosed/invalid segment resets, scale equivariance, analytic one-step passage,
deterministic paths, Markov persistence, probability conservation, explicit
truncation, scenario-input isolation, and stale UI result isolation.

References: [local linear state-space models](https://www.statsmodels.org/stable/examples/notebooks/generated/statespace_local_linear_trend.html)
and [Markov switching models](https://www.statsmodels.org/stable/examples/notebooks/generated/markov_autoregression.html).
The specific expert ensemble and adaptive update rules are declared implementation
choices; they are not claimed to be those libraries' fitted models.

## K 线展示

主图默认显示紫色「动态均衡 · 因果模型」，通过「显示 → 因果均衡」独立切换。
Light 与 HQ 共用名称、颜色、日期和值。`chartPath` 复用本次前缀滤波的历史状态，
不逐根求解首达概率；每个点使用该日及之前的已收盘数据，预热或无效段留空，
观察日之后没有延长线。切换观察日或标的时立即清空旧路径，待新查询完成再显示。
此线属于研究估计，不是实际持仓成本，也不直接生成挂单。
