---
description: "How tax codes on 0% lines are resolved, recorded on the order and sent, and how the buyer VAT number is read."
---

# Tax codes on 0% lines have one resolver

`WC_Twoinc_Helper::apply_tax_codes()`, called at the end of `get_line_items()`,
is the only place a `tax_code` is added (TWO-24877). Every builder that sends
lines goes through it, so a new payload type gets codes by using the line
builder, not by calling the resolver again. The order intent is the one
exception: it uses the line builder, then strips the codes (see below).

The merchant defines the receivable; the plugin only reads which of the
merchant's rows a 0% line falls under (TWO-26153), and never picks a code
itself: a line no row covers gets none, and Two's API refuses it where a code
is required. Do not add goods-versus-services, territory or per-country
fallback logic: the merchant's tax classes and rates carry it.
The `tax_code_map` setting is keyed by row: `<class>|exempt`, `<class>|none`
and `rate:<tax_rate_id>`, with the standard class as `standard`
(`WC_Twoinc::tax_code_*_key()`). First match wins: (1) the exempt row, when
the billing address and the tax address (`get_taxable_location()`) are both in
the EU VAT area (EU27, MC, GB with a `BT` postcode) and neither is the recorded
merchant country, and the VAT number is non-empty; never while the merchant
country is unknown; (2) the first rate id on the line's own taxes, which keep
0% rates, when every rate on the line is 0% (any rate above 0% gives no code);
(3) the class's no-rule row for a line with no rate ids, whether no rate covers
the address or its tax status is not taxable. Only a taxable line on a
VAT-exempt order is looked up (`find_rates()`, or `find_shipping_rates()` for
shipping) at the tax address, and taxes off shop-wide give no code; (4) a
line with no class (shipping whose inherited class finds none) takes the one
code steps 1 to 3 gave the order, none if they disagree. A matched row on
(none) never falls through. The admin rows come from
`WC_Twoinc::tax_code_map_rows()`; the form posts the whole map as one JSON
field (`{"rows": n, "map": {...}}`, written by `admin.js`), and the save
refuses one whose count does not match rather than deleting rows. Never go
back to one input per row: `max_input_vars` drops the excess silently.
`migrate_tax_code_map_to_rows()` (gated on `TAX_CODE_MAP_VERSION`) fans an
old per-class map out to the rows once. A shop that maps nothing must not pay
for any of this: no exempt test with an empty map, and no order reads
`zero_tax_rates()`, which only the admin rows and the migration list, memoised
per class per request (`testAnUnconfiguredShopLooksNothingUp` counts both). The memo is reset on
WooCommerce's tax rate added, updated and deleted actions.

The placement record is order meta `_<prefix>_tax_codes`, written through
`update_meta_data()` while the order is not yet placed with Two and saved with
the order after a successful create. Each entry, by order item id (a refund
line uses `_refunded_item_id`), holds the code and the step that reached it
(`row` or `keyless`; a pre-release build also wrote `derived`). Only resolved
codes are recorded (TWO-26309): `stored_tax_codes()` drops an entry with no
code, and a record with none left reads as no record, so a line placed with no
code is resolved again on an update. A create attempt that resolves no code
clears an earlier attempt's record. Placed orders send recorded codes; an
unrecorded line is resolved now, and step 4's pool takes only `row` codes. An
order with no code recorded (placed with none, with no row mapped, or before the
record existed): its keyless line takes the one code all the other 0% lines
in the request being sent resolve to, and none when they disagree or one has none. A partial build (the
shipping-only one for tax subtotals, the intent) passes
`$record_tax_codes = false`.

The buyer VAT number comes from `get_buyer_vat_number()`, the first of
`BUYER_VAT_NUMBER_META_KEYS` read with `$order->get_meta()` that is non-empty
once trimmed, passed through the `twoinc_buyer_vat_number` filter, then trimmed
again. Trimming leading and trailing whitespace is the only change made to it:
no case change, stripping, prefix rewrite or added prefix. Step 1 needs only a
non-empty number, never a particular prefix. A key listed in
`BUYER_VAT_NUMBER_REFUSED` whose VAT plugin recorded an answered check as
invalid gives no number and stops the lookup; a failed check keeps the number.
List a plugin there only once its source shows it stores an invalid answer
differently from a failed check (Aelia EU VAT Assistant does; WooCommerce EU VAT
Number stores both alike, EU VAT for WooCommerce stores no result, and EU/UK VAT
Compliance writes its result only in its premium edition, so none of those is
confirmed). Add a key only once its plugin is confirmed to store it; anything
else is the filter's job. Only the order create sends it, as top-level
`buyer_vat_number`, and only for a Spanish merchant and a buyer company outside
Spain; otherwise the key is absent. Edits and refunds never send the number,
and send the codes the placement record holds for the lines it covers, so a
number changed since create does not move them.
The intent carries no tax code at all (TWO-26226): `compose_twoinc_intent`
strips `tax_code` and `tax_exemption_reason_code` from every line, because
buyer details such as the VAT number may still be partial when it is raised.
Codes are chosen, and checked by Two, at order create.

- A non-zero line, and every line of a merchant with no mapping,
  must stay byte-identical: the spec compares those payloads with the builder
  goldens and with a resolver-free build.
- The resolver never refuses and never changes a rate. Two's API validates the
  code; the plugin is only an aid.
- The merchant country is the Two merchant record's `country_code`, cached by
  the merchant-record refresh; the resolver reads the cache and never fetches.
