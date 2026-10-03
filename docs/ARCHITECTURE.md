# Architecture And Validation

## Runtime

One dependency-free userscript retains the original Torn match, PDA placeholder and storage namespace. A deterministic Node build assembles modules in a private closure. Production exposes no debug globals and sends no diagnostic telemetry.

| Module | Ownership |
| --- | --- |
| state.js | Preferences, typed storage reads, paced requests and sanitized API errors |
| diagnostics.js | Bounded notices, quality checks, whitelist and report export |
| persistence.js | Validated imports and write-ahead recovery journal |
| launcher.js | Mount, draggable launcher and Torn navigation lifecycle |
| fifo.js | Pure lot matching and acquisition/sale provenance |
| accounting.js | Shared caches, periods, acquisition ledger and summaries |
| parsers.js | Logs, quantities, cash, gifts, item use and trades |
| sync.js | Pagination, checkpoints, retries, repair and verification |
| views.js / settings.js | Overview, ledgers, charts, snapshots and insights |
| controller.js | Actions, navigation, focus, scroll and loading states |
| bootstrap.js | Migrations, recovery, cross-tab updates and scheduling |
| fixtures.js | Explicit sample data for disconnected preview |
| styles.css | Scoped responsive product interface |

## Invariants

- Raw events can project into multiple workspaces; a paid item transaction owns its cash movement, preventing double extraction.
- Deterministic IDs deduplicate logs. Authoritative trade details replace all rows for a trade. Changes invalidate dependent caches.
- One FIFO engine supplies analytics and acquisitions. Latest sale time and source come from the same matched event.
- Profit requires known cost and proceeds. Unknown/unmatched units remain visible without inventing profit.
- Gifts and consumption remove inventory without a sale or profit.
- Money entries determine actual player-trade cash. Item allocation does not alter Cash Flow.
- Successful watermarks require both source scans to finish and their result to persist. Deferred details always retain warnings.
- Precise Torn cursors are preserved. Full pages without cursors, repeated cursors and foreign sources fail visibly.
- Recent/modified trades are rechecked; transaction existence alone cannot prove verification.
- Rebuilds back up history before clearing. Imports journal prior values before writes. Storage failures cannot claim success.
- Calendar boundaries use UTC/TCT. Current chart buckets are not proof of coverage; quality state reports freshness separately.

Pagination/access follow Torn's [official schema](https://www.torn.com/swagger/openapi.json) and [API docs](https://www.torn.com/api.html).

## Feature Preservation

| Existing workflow | Rebuilt surface |
| --- | --- |
| Daily cash overview | Overview with in/out/net and current position |
| Cash categories/search/charts | Cash Flow with filters, progressive loading and export |
| FIFO items/profit charts | Trade Analysis; acquisition attribution retained |
| Acquisition lots/filter/sort | Acquisitions with shared engine, gifts/use and provenance |
| Catalog/tracking/pin/hide | Item search/add and Settings restore controls |
| Money/net-worth/daily changes | Net Worth with date picker, timeline and allocation |
| Inventory valuation | Recorded portfolio remains distinct from Torn inventory |
| Director company profit | Daily income minus wages and advertising |
| Spending/income/goals | Insights and goal management |
| Unrecognized financial events | Insights and Data Quality |
| Quick/full/background/resume | Checkpointed verification and cancellation recovery |
| Key/PDA/configuration | Settings and injected-key fallback |
| JSON/CSV | Validated import, recovery and original export formats |
| Launcher/help | Draggable launcher, workspace navigation and Help |

## Validation

Fixtures cover city shops, FIFO conservation, gifts/use, unknown/unmatched stock, latest-sale provenance, corrected/deferred trades, mixed/unsupported assets, cash projection, TCT dates, precise pagination, schema errors, cancellation, redaction, limits, key failures, malformed storage and import rollback. No real key or account history is committed.

Browser checks capture all views at four widths, inspect shell/navigation overflow and charts, and exercise sales filters, search focus, keyboard expansion and sorting. Artifact consistency and PDA-substituted syntax are checked separately. CI runs fixture tests and artifact checks.

Manual release checks still requiring a real Torn/PDA session:

- Export a representative account backup, update and verify the parser migration notice.
- Compare new city-shop and player-trade sales with official logs/details after sync.
- Full rebuild, cancel, reload/resume and compare quantities, cash and profit.
- Validate the Torn PDA injected key and native HTTP bridge on the target device.
- Exercise scoped keys, rate-limit recovery and very large storage histories.

No merge, deployment or production endpoint update is part of this PR.
