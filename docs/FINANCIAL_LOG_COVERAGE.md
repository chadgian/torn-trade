# TCFA financial log coverage: field-aware review

**Status: v0.5.9 domain classification shipped; v0.5.12 hunting/general cash updates under review.** This design is conservative, **not a claim that every Torn log payload has been independently verified**. Real sanitized log samples are still necessary to validate unfamiliar types.

## Evidence and source of truth

- Torn's official API v2 OpenAPI definition:
  https://www.torn.com/swagger/openapi.json
  - /user/log returns UserLog entries with `id`, `timestamp`, `details.id`,
    `details.title`, `details.category`, `data`, and `params`.
  - Both `data` and `params` are documented as **dynamic key-value objects**;
    the OpenAPI document does **not** guarantee a fixed currency/amount field for
    each log type.
  - /torn/logtypes supplies the actual type ID/title catalogue.
- Official API reference: https://www.torn.com/api.html
  - /user/log requires full access and may be category/type restricted.
- Official gym wiki: https://wiki.torn.com/wiki/Gym
  - Gym memberships are purchased; training itself spends energy, not cash.
- Existing TCFA mappings in src/state.js have independently maintained known IDs
  for item trades, bounty events, wages, player transfers and several other flows.

**New log ID verification:** No unverified numeric log IDs were hardcoded. TCFA
downloads and uses the live /torn/logtypes ID/title catalogue. This validates
which current IDs are *selected for scanning*, but it does not prove their
individual data/params semantics. The fixture IDs in tests are deliberate
dummy IDs and must not be treated as real Torn type IDs.

**Missing evidence:** An authorized redacted sample for each domain is required
to verify field meaning (especially `cost`, `amount`, `price`, `winnings`,
`principal`, `payout`, `rent`) and establish a regression fixture keyed to the
actual type ID. Until then, unknown or ambiguous values are omitted from totals
and shown in Data Quality. No API key or raw transaction log is written to a
diagnostic export.

## Domain-by-domain accounting contract

| Torn financial event | Accepted fields (when explicitly present) | TCFA treatment | Limitations / pending verification |
| --- | --- | --- | --- |
| Gym membership purchase | cost / money_spent / amount_paid / price | Personal expense | ID and field semantics need a live example; gym energy training is ignored |
| Education course started/enrolled | cost / price / amount_paid | Personal expense | Course completions are not charged |
| Racing upgrade / entry fee | cash_spent / money_paid / amount_paid / cash_cost | Personal expense | Race points and generic cost are NOT dollars without proof |
| Casino outcomes | money_gained / money_lost (net), or bet + gross payout | Cash in/out; two rows if gross bet and payout separately confirmed | `winnings` may be net or gross: quarantined without disambiguation |
| Property sale | money_received / proceeds / sale_total / sale_price | Capital transfer IN, not profit | Ambiguous `cost`-only sale is **not** reversed or counted; fee and cost basis unverified |
| Property purchase | money_spent / total_cost / amount_paid | Capital transfer OUT | Asset acquisition is not classified as operating loss |
| Property rent received/paid | rent_received / rent / money_received / rent_paid | Income or expense based on title | Rent title must explicitly distinguish landlord vs tenant |
| Bank deposit/withdrawal | deposit / invested / withdrawn / amount with clear direction | Principal transfer | Snapshot change alone is not an event |
| Bank maturity/interest | interest, principal_returned | Interest income and separate capital principal return | Never treat full matured balance as interest |
| Stock buy/sell | cost / total_cost for buy; proceeds / money_received for sale | Capital transfer OUT/IN | Stock sale profit/loss requires acquisition basis not available from one log |
| Cash stock dividend | money_received / money_gained | Income | Pre-existing type 5531 remains authoritative |
| Hunting | `cost` and `income` (or explicitly named money/cash alternatives) | One cash expense and one cash receipt; net equals `income - cost` | Third-party documented example for type 6020. `hunting_skill`, session type and skill gain do not imply cash. A missing cost or income is flagged as partial in Data Quality; zero income is valid |
| Cashier's check | issued/paid amount or cashing/received amount | Transfer, not earned/spent | Check issuer/recipient differences still require sample logs |
| Bail | cost / amount, with paid/posting title | Expense | Being bailed by another player is not a personal expense |
| Loans | principal and interest when separate, or total_paid minus known interest | Principal transfer plus interest expense | Unsplit repayments treated as principal transfer rather than invented interest |
| Auction listing fees | fee / listing_fee / cost | Expense | Auction item buy/sell remains under inventory/FIFO parser |
| Other services | money_spent/cost on explicit paid title | Expense | Donations/real-money subscriptions need currency proof |

**Nonpersonal company operations:** Company daily profit/loss is retained in
existing company records and Net Worth analysis but is excluded from the user's
personal Cash Flow/Dashboard earned/spent totals. Business profit is not a
wallet credit until the player receives an actual payment. Company wages and
advertising are still available as business-level daily breakdown, not
individually reconstructed historical payments.

**General cash identification:** Unknown activity titles may still supply explicit
cash-direction fields. TCFA now recognizes a small allowlist of top-level and
safe nested `money_*` / `cash_*` keys without requiring a known financial title.
It captures one incoming and one outgoing component per event at most, choosing
one alias for each direction to avoid duplication. Mere `cost`, `income`,
`value`, `points`, `credits` or `balance` are never sufficient on their own,
and specialized handling for item acquisitions, transfers, gambling, banking,
property, and mission credits takes precedence. Actual account-lifetime
completeness requires API availability and verified `/torn/logtypes` coverage.

**Unclassified financial events:** Events whose name suggests financial activity,
but whose payment, direction, currency or amount cannot be confirmed, are
persisted in the existing capped local audit. Data Quality displays the event's
log ID/title, sanitized field name and verification reason. Export includes
only normalized information, not a raw Torn response. Recheck with Full Resync
after verifying mappings.

## Safety and migration

1. A known Torn item transaction remains handled by the established item/FIFO
   parser; domain cash parsing does not double-count it.
2. Transfers and capital asset purchases are visible as transfers, not operating
   income/spending. The Net Worth snapshot remains authoritative for valuation.
3. Specialized domains run before the currency-aware general cash parser. The general parser accepts only explicit positive amount fields identifying **both cash currency and direction**, e.g. `money_received` and `cash_spent`, including a small set of safe nested containers. These take priority over the older inferred generic fallback. They do not reclassify capital asset transfers or infer dollars from ambiguous `amount`, `cost`, `income`, `value`, balance or points fields.
4. Multi-component logs use deterministic IDs and are replaced on re-scan,
   protecting against double counting.
5. **Accounting version changes to 0.5.12.** Existing cached records are not silently interpreted as newly discovered hunting income. The UI warns that Full Resync is required to reparse past hunting sessions and newly included cash events.
6. Existing sync scheduling, API-key permissions, privacy controls and cloud-storage behavior are unchanged. The logtype catalogue selects a broader but still targeted set of monetary-looking titles/categories. **It does not scan all 1,000+ Torn log types**, and the generic rules cannot infer missing or ambiguous monetary units.

## Before approval or live deployment

- Collect **redacted** examples of /user/log events for each domain, retaining
  the numeric `details.id`, generic `details.title`, and relevant
  numeric field names, but removing keys, user IDs, names, messages and raw
  private payloads.
- Compare event amount/direction to the in-game Activity Log and wallet delta.
- Verify monetary **unit** (Torn dollars vs racing points, casino tokens,
  points, external payment, or inventory value).
- Add actual-ID fixtures and test any contradicted assumptions. Full Resync
  representative data in a disposable copy with rollback before production.
- Verify special cases: property listing/sale price vs fee, net casino winnings
  vs gross payout, bank principal vs total maturity, stock broker fees, and
  company P/L reconciliation.

**Verification limits:** The hunting `{cost, income}` schema and log type 6020 are evidenced by an external TornCashflow userscript's documented examples (https://greasyfork.org/en/scripts/584478-torncashflow/code); they have not yet been compared to a consenting TCFA user's current API output. Passing synthetic tests confirms the *rules*, not every live log payload. This change remains review-gated until merged.
