# Torn Cash Flow Analyzer

A local-first Torn and Torn PDA userscript for cash flow, net worth and FIFO trading.

**Source version: 0.3.4.** The classic blue-green glass theme and readable text are retained. Transaction, sales and acquisition tables fit the page width; narrow screens use labelled rows with every field and sorting control preserved. This UI-only update does not invalidate history verified by v0.3.3. Page and filter transitions show loading status; full rebuild recovery copies use IndexedDB where available to avoid duplicating history in localStorage. Precise log cursors, trade-list continuation, bounded stalled-page retries and failed-attempt diagnostics improve resync reliability without claiming incomplete coverage is complete.

## Features

- TCT daily overview: money in, money out, net flow and financial position.
- Searchable Cash Flow ledger, category filters, progressive loading and interactive charts.
- Trade Analysis with a single FIFO engine, acquisition-attributed profit and actual sale-date quantities.
- Latest Sales across city shops, item markets, bazaars and completed player trades, with source filters, trade IDs and excluded-unit indicators.
- Acquisition History with source, cost, proceeds, status, transfers, consumption, sorting and filters.
- Net Worth snapshots, daily changes, allocation, recorded portfolio and director company P/L.
- Income/spending insights, goals and unrecognized financial events.
- Catalog search, tracked items, pin/hide/restore and a draggable compact launcher.
- Quick Sync, background refresh, resumable Full Resync, cancellation and recovery.
- JSON backup/import, Cash Flow CSV, Net Worth CSV and redacted diagnostic reports.

## Installation

Install the generated [userscript](torn-trade-analyzer.user.js) in Torn PDA or a userscript manager. The main-branch raw URL remains:

```text
https://raw.githubusercontent.com/chadgian/torn-trade/main/torn-trade-analyzer.user.js
```

For PR testing, use the review branch's raw file rather than main. Existing metadata still points to the original Worker update/download endpoint; this change does not publish to that endpoint.

Create or save a key in Settings, or use Torn PDA's injected key. Required selections are User Log, Trade, Trades, Money, Networth; Torn Items, Logtypes; and Company Profile, Employees for director accounting. Restricted log scopes are flagged.

## Accounting And Freshness

FIFO consumes the oldest recorded acquisitions for sales, outgoing gifts and item use. Profit/chart attribution remains on acquisition dates; Latest Sales is ordered by actual sale time in TCT. These are intentionally different views.

Missing costs or proceeds are **not** treated as free inventory. Unmatched or unknown-value sold units are excluded from profit and surfaced in Data Quality. Explicit free/reward acquisitions still have a valid zero cost.

Single-item cash trades use actual cash. Multi-item/mixed trades retain the previous market-value-plus-equal-cash-adjustment allocation, labeled as an estimate. Unsupported assets or missing mixed-trade prices make item profit unavailable. Cash Flow always uses actual player-trade cash, not allocated item values.

- First Quick Sync starts at today's TCT midnight.
- Manual Quick Sync rechecks at least 72 hours of logs and trades, including any gap since the last successful sync.
- One-minute background checks use 15-minute log and one-hour trade repair windows, widening to 72 hours at least hourly.
- Recent/modified trades are reverified. Incomplete details remain pending after leaving the recent scan window.
- Exact Torn links/nanostamps are retained. Missing/repeated cursors cannot silently establish complete coverage.
- Full Resync loads all API-available history. Previous history is recoverable on cancellation; older parsed caches remain flagged until a successful full rebuild.
- Rebuilds commit a recovery copy before clearing history. IndexedDB avoids the old double-history localStorage quota failure; browsers without it retain the legacy backup path and refuse to clear history when the backup cannot fit. Long rebuilds retain their frozen scan endpoint across reloads; Quick Sync subsequently repairs freshness.
- Diagnostic exports separate the last successful scan from the pending/failed attempt. Permanently stalled cursors pause after three attempts without advancing coverage or skipping same-second events.
- Web Locks coordinate Torn tabs when available. Otherwise the interface warns to keep one tab syncing.

## Data Quality And Bug Reports

A compact quality strip summarizes issues. Details shows stable codes, severity, sanitized context, timestamps and report export. Errors and low-severity inference warnings are retained without repeating long messages in every view.

Examples: `HISTORY_STALE`, `FIFO_UNMATCHED`, `ITEM_VALUE_MISSING`, `VALUATION_INFERRED`, `TRADE_DEFERRED`, `TRADE_SOURCE_MISMATCH`, `PAGE_INCOMPLETE`, `RATE_LIMIT`, `LOG_SCOPE` and `STORAGE_WRITE`.

Attach an exported Data Quality report with the item/trade ID, expected quantity, source and approximate TCT time. Reports exclude keys, URLs, raw payloads and counterparty names. History backups contain gameplay data and should not be posted publicly.

## Privacy And Limits

Requests go to Torn's official API. Keys and caches remain in this browser/PDA storage; no third-party analytics are added. All scripts on the Torn origin can access local storage, so this is not encrypted secret storage.

Recorded inventory is not authoritative live inventory. API visibility, permissions and delayed events constrain completeness. Estimates, stale catalogs and partial snapshots are labeled. Failed storage writes pause sync instead of claiming success. Snapshot retention remains 180 observations; unrecognized-event review remains bounded to 300 entries.

No real key is needed for tests. Live Torn/PDA bridge behavior and representative full-account history still require manual validation before release.

## Development

Node.js 20 or newer; no build or unit-test dependencies.

```sh
npm run build
npm run check
npm test
npm run preview
```

Edit `src/`, not the generated userscript. Build checks normal syntax and PDA key substitution. Preview creates `.preview/index.html`; open it directly in a browser.

Optional browser checks use an installed Playwright package and Chrome:

```sh
node tools/browser-check.cjs
```

`PLAYWRIGHT_MODULE` can point to an existing Playwright module; `BROWSER_CHANNEL` defaults to `chrome`. Screenshots go to ignored `test-results/`. Tests cover every view at 360, 390, 768 and 1440 px, sales filtering, focus, keyboard expansion, navigation labels and charts. Official API calls are blocked during preview tests.

See [architecture and validation](docs/ARCHITECTURE.md) and [historical release notes](docs/LEGACY_CHANGELOG.md).

## Use

A community userscript for personal Torn gameplay analytics. Review the source before installing and use it at your discretion.
