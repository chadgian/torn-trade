# Torn Trade Analyzer

A Torn userscript focused on automatic item acquisition/sale history, FIFO profit analysis, player trades, and mobile-friendly analytics for Torn PDA.

**Current version:** v0.1.28

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

Torn Trade Analyzer builds a local trading/item ledger from Torn API data and turns it into profit analytics without requiring you to manually record every item.

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
