# Historical Release Notes

These describe older releases. Current behavior is documented in the README.

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


## v0.2.11 — Clean Bento runtime rebuild

- Rebuilt from the proven v0.2.1 launcher/runtime instead of layering additional launcher watchdogs.
- Reapplies the Bento/glass dashboard and current-TCT daily cash-flow view as presentation-only changes.
- Restores the original floating launcher mount, drag, click and visibility code verbatim from v0.2.1.
- Prevents page-wide horizontal scrolling while keeping financial navigation and wide ledgers independently scrollable.
- Consolidated cash flow today is money in minus money out for the current TCT day; internal transfers remain separate.
- Source validation includes the original baseline, current production source, rebuilt source and a Torn-PDA-style API-key substituted source.


## v0.2.12 — Torn PDA parser compatibility

- Fixes a startup failure reported by Torn PDA as `Uncaught SyntaxError: Unexpected identifier 's'`.
- Removes the Bento dashboard's nested pluralization template expression and precomputes the movement labels with plain statements.
- Simplifies newly introduced dashboard strings while preserving the v0.2.11 Bento layout and current-TCT calculations.
- Keeps the proven v0.2.1 floating-launcher runtime unchanged byte-for-byte.
- No accounting, sync, FIFO, acquisition-history or net-worth calculation changes.


## v0.2.13 — Mugging direction and director company profit

- Corrects mugging accounting: Torn log 8155 (Attack Mug) is money in for the mugger; 8156 (Attack Mug Receive) is money out for the victim.
- Repairs already cached mugging cash-flow rows automatically after updating.
- Company deposits and withdrawals are excluded from cash-flow rows.
- If the API-key owner is the company director, each sync adds/updates one current-TCT-day Company Profit / Loss row calculated as daily company income minus employee wages minus advertisement budget.
- The daily company row is updated rather than duplicated when syncing again on the same TCT day.
