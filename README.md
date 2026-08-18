# Torn Trade Analyzer

A Torn userscript focused on automatic item acquisition/sale history, FIFO profit analysis, player trades, and mobile-friendly analytics for Torn PDA.

**Current version:** v0.1.20

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
- Incremental syncing: previously known records are skipped and only missing/new data is added where possible.
- Persistent/resumable sync across Torn page reloads and navigation.
- **FIFO accounting** for realized profit.
- Profit is attributed to the **date the matched acquisition lot was originally acquired**, while Sold quantity remains on the actual sale date.
- Multi-item Player Trade allocation using each item type's market value plus an equal share of the trade's overall cash surplus/deficit.
- Acquisition History ledger with chronological acquisition lots, source, cost, FIFO-matched sale proceeds, realized profit, and Sold/Partial/Unsold status.
- Searchable, sortable and filterable ledger.
- Interactive Day / Week / Month profit charts with exact-value hover/tap tooltips.
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
- After historical coverage is established, routine syncs focus mainly on the interval since the last successful sync, with a small overlap for safety.
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
