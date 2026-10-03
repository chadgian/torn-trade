# Torn Cash Flow Analyzer

A local-first Torn and Torn PDA userscript for cash flow, net worth and FIFO trading.

**Source version: 0.4.0.** The classic blue-green glass theme, readable text and page-width tables are retained. Zero nanostamps are no longer sent as pagination cursors or compared against valid timestamps. Short zero-cursor pages are independently checked with an inclusive date-bounded request before being accepted as terminal; older or additional same-second rows are checkpointed and scanning continues. Dense 99/full pages and unverified responses still pause without claiming complete coverage. Saved scans from older cursor policies rewind safely; Full Resync replaces a paused Quick Sync and retains rebuild recovery. Accounting formulas remain unchanged from v0.3.3. Reports include sanitized cursor and failed-checkpoint context without API keys or raw responses.

## Features

- TCT daily overview: money in, money out, net flow and financial position.
- Searchable Cash Flow ledger, category filters, progressive loading and interactive charts.
- Compact responsive tables stay visually tabular on phones and tablets; lower-priority fields fold into concise secondary text instead of turning each row into a card.
- Trade Analysis with a single FIFO engine, acquisition-attributed profit and actual sale-date quantities.
- Latest Sales across city shops, item markets, bazaars and completed player trades, with source filters, trade IDs and excluded-unit indicators.
- Acquisition History with source, cost, proceeds, status, transfers, consumption, sorting and filters.
- Net Worth snapshots, daily changes, allocation, recorded portfolio and director company P/L, with a denser mobile layout and collapsible calculation/breakdown details.
- Income/spending insights, goals and unrecognized financial events.
- Catalog search, tracked items, pin/hide/restore and a draggable compact launcher.
- Quick Sync, background refresh, resumable Full Resync, cancellation and recovery.
- JSON backup/import, Cash Flow CSV, Net Worth CSV and redacted diagnostic reports.
- A built-in What's New page covering user-facing changes since v0.3.0.

## Installation

Install the generated [userscript](torn-trade-analyzer.user.js) in Torn PDA or a userscript manager. The main-branch raw URL remains:

```text
https://raw.githubusercontent.com/chadgian/torn-trade/main/torn-trade-analyzer.user.js
```

For PR testing, use the review branch's raw file rather than main. Existing metadata still points to the original Worker update/download endpoint; this change does not publish to that endpoint.

Create or save a key in Settings, or use Torn PDA's injected key. Required selections are User Log, Trade, Trades, Money, Networth; Torn Items, Logtypes; and Company Profile, Employees for director accounting. Restricted log scopes are flagged.

## Storage Backends

Large analyzer datasets no longer depend on the browser's small shared `localStorage` quota.

- **Torn PDA:** automatically uses `PDA_storage`, Torn PDA's native per-script SQLite-backed storage. Existing history is migrated from `localStorage`, verified, and only then removed from the old store. Torn PDA can expose its per-script storage-limit control for the analyzer.
- **Other modern browsers/userscript managers:** uses IndexedDB for large history and caches.
- **Fallback:** if neither native Torn PDA storage nor IndexedDB is available, the analyzer keeps working with `localStorage` and shows a Data Quality warning about the limited backend.
- Small synchronous preferences and resumable-sync metadata stay in `localStorage`; large transaction, trade, cash-flow, snapshot, catalog and log-type datasets use the durable backend.
- Data Quality shows the active history backend and the available usage/quota information. A successful sync watermark is not advanced until queued durable writes have finished. Short repeated Player Trades pages are independently checked with an older date boundary instead of aborting near the end of Full Resync; dense repeated pages still pause rather than risk skipping trades.

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

A compact quality strip summarizes issues. Details shows stable codes, severity, sanitized context, timestamps and report export. Each diagnostic also includes a suggested action. Errors that are not safely fixable on the user's device provide a developer-contact path and a compact support detail to include with the exported report.

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
node tools/recovery-check.cjs
node tools/zero-cursor-check.cjs
```

`PLAYWRIGHT_MODULE` can point to an existing Playwright module; `BROWSER_CHANNEL` defaults to `chrome`. Screenshots go to ignored `test-results/`. Tests cover every view at 320, 360, 390, 768, 1024 and 1440 px, table widths, sales filtering, focus, keyboard expansion, navigation labels and charts. Recovery checks cover quota failures, reloads, cancellation and cross-tab locks. The zero-cursor check exercises the generated userscript's Full Resync button against the reported failure shape. Live API calls are blocked; sync tests use synthetic responses and a dummy key.

See [architecture and validation](docs/ARCHITECTURE.md) and [historical release notes](docs/LEGACY_CHANGELOG.md).

## Use

A community userscript for personal Torn gameplay analytics. Review the source before installing and use it at your discretion.
