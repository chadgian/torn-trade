# Torn Cash Flow Analyzer

A Torn PDA-friendly financial analytics userscript centered on cash flow, spending, earnings and net worth, with the original FIFO Trade Analyzer retained as a dedicated feature.

**Current version:** v0.2.10

## Install

### Torn PDA / userscript URL

```text
https://raw.githubusercontent.com/chadgian/torn-trade/main/torn-trade-analyzer.user.js
```

Repository source:

```text
https://github.com/chadgian/torn-trade/blob/main/torn-trade-analyzer.user.js
```

The userscript contains `@updateURL` and `@downloadURL` metadata pointing to the raw file above so future versions can continue updating from this repository.

## What it does

Torn Cash Flow Analyzer builds a local financial ledger from Torn API data. Cash flow, spending, earnings and net worth are the primary system; the original FIFO Trade Analyzer remains available as a dedicated feature.

### Main features

- Automatic acquisition and sale discovery from Torn logs.
- Completed **Player Trade** support with detailed outgoing/incoming item quantities.
- Incremental syncing: previously known records are skipped while live-period syncs also recheck the most recent 72 hours of User Logs so delayed travel/market logs can be recovered.
- Persistent/resumable sync across Torn page reloads and navigation.
- **FIFO accounting** for realized profit.
- Profit is attributed to the **date the matched acquisition lot was originally acquired**, while Sold quantity remains on the actual sale date.
- Multi-item Player Trade allocation using each item type's market value plus an equal share of the trade's overall cash surplus/deficit.
- Acquisition History ledger with chronological acquisition lots, source, cost, FIFO-matched sale proceeds, realized profit, and Sold/Partial/Unsold status.
- Searchable, sortable and filterable ledger.
- Interactive Day / Week / Month profit charts with exact-value hover/tap tooltips.
- Profit charts use Torn City Time (TCT/UTC) calendar buckets and keep every date/week/month in sequence, including zero-profit buckets, so checked days never visually disappear.
- Scrollable Day charts so larger date ranges remain readable on mobile.
- Item Market, Bazaar, Foreign Market, Torn Shop, player trades, crimes, finds, gifts/rewards and other recognized acquisition sources.
- Local caching for faster analytics and reduced repeated API work.
- Designed for Torn PDA / mobile use.

## Profit calculation

The analyzer uses **FIFO (First In, First Out)**.

Example:

1. You acquire 100 units at $10,000 each.
2. Later you sell 40 units at $13,000 each.
3. Those 40 sold units are matched against the oldest recorded acquisition lot.
4. Realized profit for those units is calculated from their matched acquisition cost and actual sale proceeds.

The realized profit is displayed under the acquisition date of the FIFO lot, not the later sale date. The actual Sold quantity and sale event still remain associated with the real sale timestamp.

## Player Trade allocation

When a completed Player Trade contains multiple item types, Torn does not necessarily provide a direct per-item cash price. The analyzer therefore:

1. Calculates the current market-value subtotal for each item type.
2. Determines the overall cash surplus/deficit of the trade.
3. Distributes that adjustment equally between the different item types.
4. Uses the resulting allocated totals for FIFO acquisition/sale accounting.

This is an accounting estimate for mixed trades, not a claim that Torn itself assigned that exact per-item price.

## Acquisition History

The Acquisition History page treats each acquisition event as its own FIFO lot and can show:

- Date and time acquired
- Item and quantity
- Acquisition source/method
- Total acquisition cost and unit cost
- FIFO-matched sold quantity
- Matched sale proceeds
- Realized profit
- Sold / Partial / Unsold status
- Sale source and latest matched sale time

The table supports search, filters, sorting, and progressive loading for large histories.

## Sync behavior

Sync is designed to avoid repeating work unnecessarily:

- Existing normalized transaction IDs are skipped.
- Previously verified Player Trade IDs can skip repeated detailed-trade requests.
- After historical coverage is established, routine live-period syncs still recheck the most recent **72 hours of User Logs** and **6 hours of Player Trades**. This deliberately catches late-visible Torn logs while deterministic transaction IDs prevent duplicate accounting.
- A pending sync can resume after Torn navigation/page reload.

For the first sync after a major parser/accounting change, a larger date range or **All** may still be useful to establish complete local history.

## API and privacy

Your analyzer data stays on your device in local browser/Torn PDA storage.

The userscript communicates with Torn's official API to retrieve the data required for analysis. It does not send your Torn API key, transaction history, or analyzer data to this GitHub repository or to a third-party analytics service.

Do **not** post your Torn API key in issues, forum posts, screenshots, or bug reports.

## Limitations

- Profit accuracy depends on having the acquisition history needed for FIFO matching. A sale whose original acquisition predates your cached history can have unmatched units.
- Current inventory shown by the analyzer is based on recorded transaction history; it is not intended to be a live authoritative Torn inventory count.
- Mixed Player Trade per-item values are allocated estimates as described above.
- Torn log structures/API behavior can change, so unusual or newly introduced transaction types may require parser updates.

## Reporting bugs

When reporting a missing or incorrect acquisition/sale, useful information includes:

- Item name / Torn item ID
- Approximate transaction date/time
- How it was acquired or sold (Item Market, Bazaar, Foreign Market, Player Trade, crime, gift, etc.)
- Expected quantity versus quantity shown
- Analyzer version
- Relevant diagnostics from Settings

Please **never include your API key**.

## License / use

This repository contains a community userscript intended for personal Torn gameplay analytics. Review the source before installing and use it at your own discretion.


## v0.1.22 freshness fix

- Live-period Sync now rechecks the most recent 72 hours of User Logs instead of only a five-minute overlap.
- This is intended to recover delayed Foreign Market/travel purchases that may appear after a previous sync already advanced coverage.
- Player Trades use a six-hour recent recheck window; already verified trade details remain skipped.
- Foreign Market acquisition rows and quantities detected in the latest scan are shown in Settings diagnostics.
- Item-log parsing accepts additional item/cash field aliases and nested purchase/travel structures for resilience against API schema variation.


## v0.1.23 live-date / stale checkpoint fix

- Manual Sync no longer resumes an old saved checkpoint indefinitely. A stale or date-range-mismatched checkpoint is retired safely, while rows already downloaded remain cached.
- Fresh sync setup asks Torn's `/user/timestamp` endpoint for current server time and refreshes the live scan window before requesting logs/trades.
- Old checkpoints are not automatically resumed on page load once their end time is stale.
- Profit charts now append the current selected Day/Week/Month bucket at `$0` when necessary, so an up-to-date sync does not visually look two days old simply because there was no acquisition-attributed profit today.
- The existing 72-hour User Log recheck remains enabled for delayed overseas/travel acquisition logs.


## v0.1.24 TCT day-gap sync

- Sync now gets the current Torn server timestamp first and treats that as the authoritative Torn City Time (TCT) target.
- Finite selected periods are tracked by TCT calendar-day coverage, independent of the phone/browser timezone.
- A day can be marked scanned even when it contains zero item transactions, so an empty day is no longer confused with an unchecked day.
- Every Sync identifies uncovered TCT day ranges in the selected period, starts from the earliest missing segment, and fills those gaps through the current TCT target.
- The current TCT day is refreshed through the current server time, and the recent safety window remains in place for delayed Torn logs.
- Deterministic transaction IDs still prevent duplicate accounting when covered days are rechecked.


## v0.1.25 continuous TCT timeline

- Day/Week/Month profit charts now use TCT (UTC) boundaries instead of the device timezone.
- Every bucket between the selected period start and the latest successfully synced TCT time is generated, even when profit is $0.
- This prevents dates from disappearing simply because there was no realized acquisition-attributed profit on that day.
- Sync coverage remains separate from activity: a checked-empty TCT day is still a checked day.


## v0.1.26 abroad acquisition verification

- User Log filtering is split into batches of at most 10 log IDs.
- Every Sync performs an independent `4201` (Item abroad Buy) verification pass, so Foreign Market acquisitions do not depend on a larger mixed-log filter batch.
- The dedicated verification uses the selected finite period; for All History it checks the latest 30 days to keep routine API usage bounded.
- Settings diagnostics show raw 4201 rows, parsed rows/items, the latest raw Abroad Buy timestamp, and the latest parsed acquisition timestamp.
- Existing transaction IDs remain duplicate-safe, so the dedicated verification can recover missing purchases without double-counting rows already stored.


## v0.1.27 period presets and compact launcher

- Dashboard period presets are now **7 days, 14 days, 30 days, All, and Custom**.
- The former **1 month** preset was removed; saved users on that preset are migrated to **30 days**.
- The draggable floating launcher is now a compact 40x40 icon-only button so it covers less of the Torn interface.
- While sync is running, the compact launcher shows only the spinner and remains tappable to reopen sync progress.


## v0.1.28 launcher icon

- Replaced the floating launcher emoji with a custom inline SVG terminal/data-pulse icon.
- The icon uses the analyzer's green/blue cyber palette and remains a compact 40×40 draggable button.
- During sync, the launcher still switches to the compact spinner-only state.


## v0.2.0 — Cash Flow Analyzer

The project is now centered on financial analysis rather than only trading.

- **Today overview (TCT):** earned, spent, net cash flow, and internal transfers.
- **Cash Flow ledger:** recognized incoming/outgoing money movements with categories and searchable history.
- **Transfers:** bank/vault/faction/company transfers are recorded but excluded from earnings/spending totals.
- **Trade Analysis:** the original FIFO acquisition/sale/profit system remains as a separate feature.
- **Net Worth:** current Torn-reported money, item holdings, assets and points from `/user/networth`, plus `/user/money` snapshots.
- **Analyzer portfolio:** acquisition cost, remaining FIFO basis, current analyzer-recorded market value, unrealized gain/loss, realized profit, and acquisition-source breakdown.
- **Player Trades:** cash-flow uses actual cash exchanged; allocated item values remain confined to trade accounting.

Torn currently marks API v2 `/user/networth` as unstable. The analyzer therefore labels Torn-reported snapshots separately from locally calculated accounting history.


## v0.2.1 — Quick Sync and Full Resync

Syncing is now split into two explicit modes:

- **Quick Sync** is the normal everyday action. It ignores the selected analytics period and scans only from the last successful Torn City Time sync through the current TCT. If no successful sync exists yet, it starts at the beginning of the current TCT day.
- **Full Resync** clears locally discovered transaction/cash-flow history and sync coverage, then rebuilds from the beginning of available history. It preserves analyzer settings such as API configuration, pins, hidden items and display preferences.
- Saved sync jobs remember which mode they belong to, so a Quick Sync cannot accidentally resume an old Full Resync and vice versa.


## v0.2.2 — Bento UI refresh

- Dashboard redesigned into a lighter Bento-style glass layout with clearer visual hierarchy and more readable text.
- Financial navigation cards now scroll horizontally inside their own strip; the analyzer page itself is constrained from horizontal scrolling.
- Today is always based on the current Torn City Time day, not the previous sync date.
- Added a top-level consolidated cash-flow figure: money in minus money out for the current TCT day. Internal transfers remain separate.
- Added consistent flow legend and clearer + / − / ↔ symbols for money in, money out and transfers.
- Recent cash movements on the dashboard are explicitly limited to the current TCT day.


## v0.2.3 — Floating launcher reliability

- Restores the compact floating launcher after the Bento UI refresh.
- Gives the launcher an isolated top-level stacking context and explicit visible/hidden state.
- Recreates the launcher automatically if Torn page navigation removes it.
- Re-clamps saved launcher coordinates to the current viewport.


## v0.2.4 — isolated Torn PDA launcher

- Mounts the floating launcher directly under the document root rather than inside Torn's body layout.
- Forces critical launcher visibility, size, position and stacking styles inline with `!important`.
- Resets an invalid/off-screen saved launcher position back to a safe default.
- Embeds the terminal/data-pulse SVG styling directly in the icon so Torn CSS cannot make the icon disappear.
- Rechecks launcher presence and viewport visibility during Torn SPA navigation.


## v0.2.5 — Shadow DOM launcher

- Moves the floating launcher into a valid host under `body` instead of placing the button directly under `html`.
- Isolates the launcher button in Shadow DOM so Torn/Torn PDA page CSS cannot hide or restyle it.
- Reattaches the Shadow DOM host if Torn SPA navigation replaces the body content.
- Keeps the compact draggable terminal/data-pulse button and sync spinner.


## v0.2.6 — Floating launcher reliability

- Reverted the floating launcher from the experimental Shadow DOM/zero-size host architecture to the known-working direct document-body button model.
- The launcher is appended after the analyzer root and forced to the top compositor layer with a maximum practical z-index.
- Removed the Shadow DOM lookup mismatch that caused the watchdog to repeatedly think the FAB was missing.
- Keeps draggable position, terminal/data-pulse icon, sync spinner and automatic remount checks.
- Bento dashboard and financial UI remain unchanged.


## v0.2.7 — Launcher runtime isolation

- Root-cause hardening after comparing the last known-good pre-Bento launcher with the Bento-era releases. The Bento commit did not delete the launcher functions, so the repair now targets indirect/runtime conflicts instead of only CSS.
- Uses new isolated DOM ids for the current launcher, analyzer root and style tag so older installed/stale copies cannot move, hide or restyle the current UI.
- Uses a runtime ownership token so duplicate copies of the same current release do not create competing watchdogs.
- Suppresses legacy `#tta-fab`, `#tta-fab-host`, `#tta-root` and `#tta-css` UI nodes while keeping the existing local accounting data namespace intact.
- Resets the old saved launcher coordinate once and clamps future positions against Android's visual viewport.
- Adds element hit-testing and several safe fallback positions when a DOM layer covers the button.
- Forces the launcher into its own compositor layer and keeps it alive even if dashboard rendering throws.


## v0.2.8 — Torn PDA launcher lifecycle repair

- Root cause: Torn PDA can tear down a userscript execution context while leaving the same-version runtime marker on `window`. The old guard then returned before remounting the launcher.
- Every new injection now supersedes the prior runtime token and mounts a fresh launcher/watchdog instead of trusting a stale marker.
- Legacy launcher nodes are hidden only after the current launcher is confirmed interactable, preserving a fallback during recovery.
- Launcher visibility now depends on the actual visible analyzer overlay, not only the `state.open` boolean.
- Stale open-state recovery and old watchdog cleanup are included; Bento card scrolling remains isolated and unchanged.


## v0.2.9 — Floating launcher restoration

- Restores the original known-working `#tta-fab` / `#tta-root` DOM contract used before the launcher regression.
- Removes the experimental alternate launcher namespace and legacy-suppression stack.
- The launcher uses inline visibility safeguards and is recreated if Torn SPA navigation removes it.
- Same-version userscript reinjection replaces the launcher node so click/drag listeners always belong to the live execution context.
- Automated DOM validation checks initial visibility, click-to-open, removal recovery, body replacement recovery, and reinjection.


## v0.2.10 — Launcher diagnostics

- Adds structured console diagnostics prefixed with `[TTA]` around userscript boot, CSS injection, root/FAB mounting, state application, rendering and Torn-SPA watchdog recovery.
- FAB snapshots report its DOM attachment, bounding rectangle, computed display/visibility/opacity/z-index/pointer-events, saved coordinates, viewport metrics, and the topmost element at the launcher center.
- Browser/runtime errors and unhandled promise rejections are surfaced with `[TTA]` diagnostics.
- Run `window.__TTA_DEBUG_DUMP__()` in the console for an on-demand launcher snapshot.
- This release is diagnostic only; cash-flow, sync, trade/FIFO, net-worth and Bento accounting behavior are unchanged.
