# LuxAlgo Integration

Assessment and migration date: 2026-10-08. The official PineTS skill is installed locally and the actual canonical Pine source runs successfully in PineTS and in an isolated Vela browser chart. The workbench now replaces Lightweight Charts with Vela and retains HQChart; the initial probe and subsequent migration evidence are recorded separately below.

## Installed Skill

The unmodified [LuxAlgo Codex skill](https://github.com/LuxAlgo/pinets-cli/blob/main/SKILL.md/openai-codex/SKILL.md) is installed at `.agents/skills/pinets/SKILL.md`. This directory is local and ignored under the repository's existing policy. The skill is available to Codex on the next turn; its contents were also read during this assessment.

The skill teaches command-line indicator execution, OHLCV JSON input, plot output, and warmup. It does not teach Vue chart integration. Its command examples use `pinets-cli`, which bundles its own runtime independently of the `pinets` package.

`pinets-cli@0.1.15` successfully executed a basic SMA/EMA script over local BTC bars, but executing `bl-esw-pinbar-market-lab.pine` failed with `Execution failed: $.get(...) is not a function`. The same original source succeeded with `pinets@0.11.0`. Use the pinned runtime gate below for this project's canonical source; do not interpret this CLI failure as a failure of the current standalone runtime. The precise bundled-runtime defect has not been localized.

## Reproducible Runtime Gate

```bash
pnpm install --frozen-lockfile
pnpm run verify:pinets
```

`pinets@0.11.0` is an exact dependency. It is not imported into production UI or domain modules. The gate executes the actual Pine source, using the existing CSV parser and market-specific session basis:

| Sample  | Bars at assessment | Trading sessions/year |
| ------- | -----------------: | --------------------: |
| GOOG    |               1437 |                   252 |
| AAPL    |               1437 |                   252 |
| 600519  |               1389 |                   242 |
| BTCUSDT |               2092 |                   365 |

The independent JS twin supplies expected cost anchor, cost bands, GetDelta bands, and LP ranges at six historical checkpoints per sample. Missing values are checked as missing. Three independently executed prefixes per sample must reproduce the full run's numeric values and five signal plots at the same observation cutoff. Timestamps must remain epoch milliseconds.

The first run passed 288 numeric assertions plus signal/presence/length/timestamp assertions, with maximum observed relative numerical difference `3.552e-10`. Cost comparisons allow `1e-8` and other numerical comparisons `1e-6`, accommodating distinct floating-point implementations; prefix comparisons allow `1e-10`.

The existing `verify:pine` gate compares the JS twin with domain outputs and checks Pine source invariants. `verify:pinets` adds actual compilation/execution. Neither gate proves TradingView execution parity, all API coverage, or broker-emulator fill parity.

## Browser Feasibility

An isolated Vite 8.0.12 probe used these exact versions:

| Package                | Version | Published license |
| ---------------------- | ------- | ----------------- |
| `@luxalgo/vela`        | 0.8.3   | Apache-2.0        |
| `@luxalgo/vela-pinets` | 0.2.15  | AGPL-3.0-only     |
| `pinets`               | 0.11.0  | AGPL-3.0-only     |

The probe passed 2092 local BTC candles to Vela as `{ time, open, high, low, close, volume }`, registered `PineWorkerEngine`, and awaited `chart.runIndicator()` for the unchanged canonical script. The browser visibly rendered candles, cost/GetDelta bands, signal markers, backgrounds, both Pine tables, volume, and Vela attribution. Both the development server and the compiled static artifact served by Vite preview executed successfully in the browser. The single probe bundle was about 2480 kB minified / 654 kB gzip. Production integration therefore needs a lazy chunk.

This is browser feasibility evidence from an isolated probe, not a third engine released inside Market Lab. It covers one sample and initial rendering; drawing persistence, resize, theme changes, teardown, recovery, interactions, and strategy fills remain acceptance work.

## Implemented Migration

Lightweight Charts has been removed from the package manifest, lockfile, chart workspace, Vite chunk rules, component, series/theme/legend composables and adapter. The default research engine is Vela; persisted `lightweight` preferences normalize to `vela`. Existing HQ preferences remain HQ. Vela uses its official single-chart Workspace and native legends/drawings; HQ keeps its original drawing state and shared business legend.

The user confirmed the replacement scope as Lightweight Charts content only, and selected separate panes by magnitude for Greeks and LP. HQChart remains the mainland formula/tool engine: its original `hqchart` runtime import, native catalog, local data bridge, pane preferences and drawing state remain. HQChart advertises analysis/TDX/Mai syntax; individual user formulas still require fixtures, and existing UI exposes the controlled native indicator catalog rather than a new arbitrary formula editor. No custom legacy formulas were supplied in this iteration.

| Existing capability              | Migration contract / evidence                                                                                                                                                                                                                |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Candles and volume               | UTC epoch milliseconds; local OHLCV only; auto-volume disabled, managed native Volume in its own pane with numeric axis and existing domain regime backgrounds                                                                               |
| Cost/GetDelta/LP price bands     | Same domain fields, names, styles and price scale; no formula reimplementation                                                                                                                                                               |
| Causal equilibrium               | Same historical-prefix output; prewarm, missing and cutoff dates preserved as explicit null gaps                                                                                                                                             |
| Greeks/LP/Carry/equity/KDJ/RSI   | Every active domain catalog series and guide transported; Greeks and LP split by scale                                                                                                                                                       |
| Replay/decision/research markers | Existing `buildChartMarkers` output with only time conversion and renderer marker sizing                                                                                                                                                     |
| Research chips                   | Native VRVP (36 bins / 70% value area / visible range), compact OHLCV-proxy label and desktop gating; user selected native option A. HQ retains its old bounded proxy                                                                        |
| Drawing persistence              | Native Vela toolbar, geometry, editing, shortcuts and history; legacy horizontal/trend/range migrated to hline/trendline/box; original `lab.chartDrawings.v1` retained as backup; native documents stored per scope in `lab.velaDrawings.v1` |
| Cursor/parameters/theme/fit      | Native Statusline/indicator legends/DataWindow; existing cursor/parameter command events; native reset/range controls; fit only on changed data/scope; subscriptions cleaned on unmount                                                      |
| Startup/cancel/error             | Bounded ready/first-paint waits; canceled loads ignored; engine preference committed after paint; retry targets the failed engine; restore the last ready engine if available                                                                |
| Static packaging                 | Lazy Vela/HQ imports; Vela watermark retained; readable notices/licenses shipped under `public/licenses/`                                                                                                                                    |

`velaChartAdapter.js` owns the renderer and native-indicator lifecycle; `velaResearchAdapter.js` converts the renderer-neutral domain model. `VelaChart.vue` orchestrates the shared view controls. Domain boundary checks forbid Vela, the addon and PineTS imports. The formula audit checks the domain catalog instead of scanning the removed `MainChart.vue` for field strings.

PineTS executes the unchanged canonical source in `verify:pinets`. The Worker addon was verified with the isolated browser probe above, but this replacement does **not** introduce a general-purpose Pine editor or consume Pine values into the default plan. Existing chart behavior is supplied from the domain model. This avoids treating the canonical Pine script, which omits several current domain overlays, as a replacement for all current formulas.

Before the native-drawing refactor, the browser rendered 2092 BTC bars with the domain bands, causal equilibrium, volume, chips, KDJ/RSI and attribution; custom horizontal-line placement and undo worked, and HQ switched successfully with the same domain legend values. The final static build contains the completed native drawing/Volume/VRVP migration and removes the Lightweight Charts chunk. After a connection interruption the browser tool rejected binding the localhost tab with a URL-protocol policy error, so the final static build and narrow-screen interaction could not be revisited automatically. Browser acceptance of the final build, trend/range dragging, and real user legacy formulas remain explicitly bounded; unit contracts and lifecycle regressions passed.

Previous migration validation (before the native-drawing refactor): 99 Vitest files / 704 tests plus 8 skill-runtime tests, production build, source/inventory/wiring/chart/formula audits, Pine equivalence and PineTS execution. Existing size/data/large-chunk warnings remain. At that validation checkpoint, the compiled project was served locally at `http://127.0.0.1:5199/`; no cloud deployment, commit, merge or push had been performed.

## Native Capability Audit

The installed Vela core owns its default drawing toolbar, placement, selection, anchor/body dragging, eraser/clear, settings, rich native drawing documents, keyboard shortcuts and undo/redo. The old `ChartDrawingToolbar`, `useChartDrawings` and `ChartDrawingsPrimitive`, including their hit-testing and custom history implementation, were deleted. Host commands now only coordinate per-symbol persistence and invoke native history. Legacy inputs are tested against the actual Vela `DrawingStore`; generated study-pane ids are converted to semantic keys before storage. The native toolbar requires no workspace shell or Pine engine. Its final browser interaction has not been validated because of the browser-tool policy rejection above.

Native Volume is implemented in a dedicated pane with its actual numeric volume axis. The earlier claim that it lacked a numeric axis was corrected after inspecting `volumeOwnsPane`, native volume autoscale and volume axis formatting. A native Volume factory hook adds existing domain regime backgrounds, keyed by the public chart DataControl, including indicators added through the native picker or Undo. Unmanaged charts keep the original output and the last helper restores the global descriptors. The core keeps its original Volume type, renderer, settings and scale. Native VRVP differs from the old bounded 500-session proxy in window, bin boundaries and value-area tie-breaking. The user selected option A, accepting native VRVP. The Vela custom chip overlay, coordinate bridge and `useStockChipViewport` were removed; HQ still uses its original proxy. VRVP stays on the price pane and cannot bypass desktop-only suppression through its eye control. Its native title carries the OHLCV-proxy source label. Domain formulas and default-plan queries are not replaced with Vela's generic classic indicators.

## Native Workspace Controls

The user additionally requested replacement of the custom top hover legend and maximum use of Vela's original controls. Vela now runs through `VelaWorkspace({ layout: false })`: official chart-style menu, indicator picker, unified Undo/Redo, data-window/object-tree panels, screenshot export, drawing toolbar, context menus, range controls, timezone and chart settings. The host's duplicate hover legend, drawing-history buttons, fit button and floating chip-source label have been removed from the Vela view. HQ retains its existing legend and controls.

The official `Statusline` is used directly. Vela 0.8.3 does not emit a `bar` event for static history; a subscription bridge seeds only that Statusline with the latest real local bar and lets the official component handle hover, formatting and layout. No synthetic tick enters the chart's event bus or domain. Its right-click native menu remains available; because the shell's unseeded status line is disabled, its dedicated Status line section is absent from the main settings dialog.

| Compatibility choice             | Implemented behavior                                                                                                                                                                                                                                                                                            |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Daily source/timeframe           | Market Lab owns the real local source and 1D bars. Native range presets remain native commands, with resolution constrained to 1D. Symbol/timeframe typing and mobile commands cannot switch to an unsupported source or resolution.                                                                            |
| Native price legends             | Cost, GetDelta, LP, causal equilibrium, entry and target/stop are separate native groups mapped to their actual host toggles. Native eye hiding retains the legend for showing again.                                                                                                                           |
| Latest-price line                | The duplicate Lab constant-close line is replaced by Vela's native current-price line and price-axis readout. HQ still consumes the unchanged domain constant.                                                                                                                                                  |
| OHLC/change/date/volume          | Statusline uses Vela's open-to-close change, rather than the old previous-close daily change. Date and complete OHLCV are available in the native DataWindow and time axis/Volume pane. The static source has no fabricated open-market badge.                                                                  |
| Ratios and percentages           | Native legends and DataWindow keep the original decimal values. Titles explicitly label `1=100%`; no domain numbers or drawing units are rescaled.                                                                                                                                                              |
| History and source changes       | Host updates are muted through the public unified-history API. Each source scope gets a fresh Workspace and its saved drawing document, preventing Undo from resurrecting another source's data. Native removal/Undo can recreate registered domain types; inactive cached values are cleared to explicit gaps. |
| Native default/input restoration | VRVP defaults remain 36 rows, 70% value area and 26% width, including picker/Undo additions. Vela's native delete/Undo re-adds by type and may reset user-edited inputs; full parameter restoration is not claimed.                                                                                             |
| Persistence                      | Existing per-source drawing persistence remains owned by Market Lab. Workspace full-state persistence is disabled to avoid restoring a different market or transient domain descriptors. Native generic study/settings edits live in the current session.                                                       |

These controls use offline bars and do not create a trading connection, alter the default plan, or enable multi-chart research/Pine editing. Final UI interaction still requires browser acceptance under the tool limitation recorded above.

Workspace iteration validation, before GitFlow delivery: 100 Vitest files / 703 tests plus 8 skill-runtime checks, production build, source/inventory/wiring/chart/formula audits, 30 Pine-equivalence tests, 288 PineTS numeric checks, targeted ESLint and `git diff --check` passed. Vela remains a lazy 1247 kB minified chunk; HQ is unchanged at 3127 kB. Existing size/data/chunk warnings remain. At that checkpoint, the local preview process served this checkout's `dist/` on port 5199; no commit, merge, push or cloud deployment had been performed. This evidence verifies code and the static artifact, not a browser replay of the new controls.

Native drawing/Volume iteration validation, before the Workspace shell: 98 Vitest files / 685 tests plus 8 skill-runtime tests; production build, source/inventory/wiring/chart/formula audits, 30 Pine-equivalence tests, and 288 actual PineTS numeric checks passed (max relative error `3.552e-10`). The static artifact contains lazy Vela/HQ chunks and no Lightweight Charts chunk. The migration test loads legacy geometry into the installed Vela DrawingStore; adapter regressions defer native start until readiness, matching the installed library rather than the former synchronous mock. Markers, backgrounds and series schema use structural native input commands because Vela value patches do not cover them. Native eye/remove commands update host overlay flags and discarded handles can be recreated. These checks do not establish final native-toolbar browser acceptance.

Drawing documents store semantic pane keys only after native panes exist. Numeric updates and study toggles that do not require drawing-document rebinding preserve native undo history. If a drawing is attached to a recreated study pane, its geometry is rebound and retained, but `fromJSON` resets history for the entire native drawing document, including any main-price drawings: Vela 0.8.3 has no public history-rebind API. Symbol changes and reloads also start fresh native history. This limitation is triggered by the newly available study-pane drawings; full TradingView interaction parity is not claimed.

## Official References

- [Vela quickstart and offline data](https://github.com/LuxAlgo/Vela/blob/main/docs/user/quickstart.md)
- [Vela public API](https://github.com/LuxAlgo/Vela/blob/main/docs/user/api-reference.md)
- [Vela PineTS addon and Worker engine](https://github.com/LuxAlgo/Vela-pinets)
- [PineTS coverage](https://docs.luxalgo.com/developers/pinets/api-coverage)
- [Vela attribution requirements](https://github.com/LuxAlgo/Vela#license-and-attribution)

Market Lab declares AGPL-3.0-or-later. Vela attribution remains enabled, and its NOTICE/LICENSE and the PineTS/addon licenses are copied into the static artifact.

The earlier assessment passed 98 Vitest files / 702 tests. The implemented migration validation above supersedes that assessment count.
