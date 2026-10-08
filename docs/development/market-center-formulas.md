# Independent Market Centers

The research workbench exposes five independent formulas through
`graph.marketCenters`. They do not replace `costAnchor`, GetDelta, OrderPlan,
entry prices, or execution gates. The legacy `causalModel` remains a separate
price-filter reference, with its historical storage keys retained.

| Formula                | Estimated object                                                         | Input boundary                                                                           | Missing / rejected result                                                         |
| ---------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Statistical center     | exp of a stationary AR(1) log-price mean                                 | Fixed trailing closed-session window, intercept, no trend; no positive-coefficient prior | No center when insufficient, degenerate, nonstationary or unit-root gate fails    |
| Volume centroid        | Amount/volume VWAP with declared conversion, otherwise HLC3 volume proxy | One consistent basis per trailing window                                                 | Missing amounts or conversions cannot silently use mixed proxy prices             |
| Turnover cohort cost   | Conditional cost of modeled traded cohorts                               | Same-day observed free-float history and explicit volume-to-share conversion             | Initial holdings remain unknown; missing or late float data is not forward-filled |
| Supply/demand clearing | Intersection of supplied linear schedules                                | Explicit current-observation scenario in UI                                              | K lines do not identify demand and supply parameters                              |
| Dividend valuation     | Gordon constant-growth value                                             | Expected next annual dividend, annual r and g; r > g                                     | No default cash flows or implied fundamental value                                |

Statistical center and cost paths use only their historical prefixes. Missing
values are gaps. Supply/demand and dividend scenarios are plotted only at the
selected observation, never extended backward. A zero-dividend model value is
reported as zero in the panel and omitted from the logarithmic price plot.

The statistical formula additionally rejects residual autocorrelation with a
fixed five-lag Ljung–Box test (one fitted AR degree of freedom; chi-square four
degrees of freedom at 5%). Failure to reject is only an assumption gate; it
does not establish iid innovations, homoskedasticity or parameter stability.
The oracle fixture matches statsmodels 0.14.4 for phi, DF, center uncertainty,
Ljung–Box Q and p-value. Explicitly late bar availability breaks its window.

The statistical formula's half-life describes decay of a conditional mean
deviation envelope. It is not first-passage time. Its DF lag-0 assumptions,
MacKinnon reference law and conditional coefficient uncertainty are reported
separately; rejection does not establish an economic restoring mechanism.
None of these formulas identifies structural causation from OHLCV.

## Commands and isolation

`useMarketCenters` owns source-scoped persisted settings, immutable query
captures, immediate invalidation and stale-result rejection. Empty numeric
fields remain null. Scenario application records the selected session's close
and requires explicit application when changing observation date.

Vela owns indicator selection, visibility, settings and Undo. Native statistical,
volume-unit, supply/demand and dividend edits emit `center-input-change` commands to the ViewModel.
Host synchronization is silent and does not reset user inputs. Native legends
remain available while values are missing. HQ consumes the same domain outputs.

Nullable economic numbers use Vela's native text input and translate to numeric
or null commands. The upstream float spinner coerces blanks to zero; no invented
economic zero is supplied. Required integer-window spinners still show zero if
cleared; the domain retains the invalid/missing parameter and does not fall back
to 120. Native selection alone does not enable an economic scenario.

Parameter changes are recorded through the public active cell's unified
`history.push` API. Tests execute actual VelaWorkspace history undo/redo,
including a removed and restored indicator instance. Host synchronization and
invalid rejected text do not add history. Settings are per input; Cancel's
reversion is another parameter action. Scenario actions cannot be replayed on a
different observation date, and destroyed source sessions cannot replay at all.
Once Vela reports ready, the side panel hides duplicate numeric/scenario editors
and directs edits to native indicator settings. Float JSON import, provenance
status and explicit current-date application remain workbench commands. The
shared numeric editors remain available in HQ and while the engine is unavailable.

## Flow of observed free-float data

The JSON import contains a declared document source and availability boundary,
plus a same-day observation and availability proof for each traded session.
`volumeUnit` must match the consumed bar units; `volumeToShares` is explicit.
The UI uses `reported-volume` for CSV volume whose share unit is not independently
specified. Setting the conversion is a source declaration, not verification by
the app. The domain rejects scenario float history and observations learned
after their session. Imports cannot overwrite a newer file or another source.
Appending a future revision of a historical float observation cannot invalidate
its previously known historical value. Same-day ambiguous records are rejected.

Optional CSV `amount`, `Amount` or `成交额` columns are preserved. A declared but
missing amount is not replaced with HLC3. A converted traded mean outside that
session's valid high/low range is rejected, requiring aligned currency, unit and
adjustment bases; the app does not infer a correction factor or certify a source.

```json
{
  "unit": "shares",
  "volumeUnit": "reported-volume",
  "volumeToShares": 1,
  "provenance": {
    "kind": "observed",
    "source": "replace-with-actual-source",
    "asOfDate": "2026-01-01",
    "availableAt": "2026-01-01:close"
  },
  "observations": [
    {
      "date": "2026-01-01",
      "value": 1000000,
      "provenance": {
        "kind": "observed",
        "source": "replace-with-actual-source",
        "asOfDate": "2026-01-01",
        "availableAt": "2026-01-01:close"
      }
    }
  ]
}
```

This illustrates the schema; its values are not a supplied market dataset.
Random replacement uses `1-exp(-tradedShares/floatShares)`, a declared cohort
assumption. Coverage and unknown initial fraction remain separate outputs.

## Compatibility boundaries

The old stored price-filter key remains available. It is not the statistical
center and is no longer labeled as identified economic equilibrium. A failed
statistical gate produces a gap instead of an always-present filter level.
The new defaults use 120 closed sessions; cohort data and structural/fundamental
scenarios have no invented inputs. Scenarios stay disabled until explicitly set.

Changing a formula window or unit declaration recalculates the research path
under the selected specification. Each point still reads only its own data
prefix. This is not an archive of each historical user's parameter vintage.
GetDelta, costAnchor and the default OrderPlan retain their prior definitions.

## References

- [DF assumptions and MacKinnon critical values](https://www.statsmodels.org/stable/generated/statsmodels.tsa.stattools.adfuller.html)
- [MacKinnon response-surface coefficients](https://github.com/statsmodels/statsmodels/blob/v0.14.4/statsmodels/tsa/adfvalues.py)
- [Ljung–Box residual diagnostic](https://www.statsmodels.org/stable/generated/statsmodels.stats.diagnostic.acorr_ljungbox.html)
- [NYSE amount/volume VWAP definition](https://www.nyse.com/publicdocs/nyse/data/Volume_Summary_Client_Spec_v1.1c.pdf)
- [Supply/demand clearing](https://openstax.org/books/principles-macroeconomics-3e/pages/3-1-demand-supply-and-equilibrium-in-markets-for-goods-and-services)
- [Gordon dividend model](https://pages.stern.nyu.edu/adamodar/New_Home_Page/lectures/ddm.html)
