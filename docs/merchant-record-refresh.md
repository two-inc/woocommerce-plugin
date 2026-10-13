---
description: "When the merchant record is fetched and refreshed, what a failed fetch may and may not withhold, and the payment-term defaults derived from it."
---

# The merchant record refreshes on an event, never on expiry

- One read path fetches the merchant record and one fetch writes every derivative
  (terms, due-in-days, platform minimum, surcharge cap, buyer countries). Adding a
  per-consumer freshness clock is how those drift apart.
- Refreshed on three events: a key or environment save, a nightly cron re-anchored
  if a DST shift drifts it off midnight, and the Diagnostics refresh button. No
  render path refreshes on purpose; a render on a cold clock pays the fetch that
  repopulates it, bounded to one attempt per 60 seconds while the API is failing.
- **A failed fetch keeps last-known-good and advances no FRESHNESS clock** — only
  the attempt clock the 60-second bound reads — so it can neither overwrite a
  concurrent success nor blank a cached restriction to "unrestricted".
- A SURCHARGE input that pricing cannot resolve fails CLOSED for the BUYER — the
  availability gate withdraws Two rather than let an order be priced with the fee
  silently absent.
- **The api-key verdict is the only upstream failure that may withhold Two, and only
  its definitive-rejection categories do**:
  `WC_Twoinc::is_definitive_key_failure()` — `invalid_key` and `not_configured`.
  `unreachable`, `service_error` and `error` fall through to the cached merchant
  record, which never expires, so an outage leaves a correctly configured shop
  selling. A 200 carrying no merchant record is `error`, not `ok` — a proxy, a
  captive portal or a maintenance page answers 200 too — but it rejects no key and
  so withholds nothing. That predicate is the ONE definition of the set; do not
  re-list the categories at a gate, and do not add a second gate that withholds
  because a call to Two failed.
- **An unresolved offerable term set does NOT withhold Two**: the tile is
  offered with an EMPTY term set, aligning every platform on Magento. No term chip
  renders, no term is sent on the order and the account default applies; a preset
  term set must never be composed for a buyer. Empty whether the fetch never
  succeeded or the account offers nothing; the read is the same cached list every
  other consumer uses, so it adds no fetch of its own.
- **An unresolved term set is explained in the admin, and its cause is PERSISTED**.
 A fetch that lands no record writes its own category: unreachable,
  rejected key, rate limited, server error, another status, an answer that cannot be
  read — to a dedicated option row that the next success deletes, because the render
  that has to explain the state is rarely the request whose fetch failed. The Payment
  Terms field then states the cause, that buyers are offered no term to choose until
  one can be read, and when the terms were last read successfully; the install health
  summary carries the same verdict and that timestamp. A successful read of an empty
  list and a record carrying no term list at all are named separately. The API key is named only
  in the two states where it is actually implicated — none saved, or one the API
  rejected — never as a guess at an unexplained failure.
- **Only the gateway's own settings section re-verifies the stored key on load**.
 The hook it rides fires on every wp-admin request, so the screen check
  is what stops an unreachable API blocking the whole administration area; the
  cached verdict is read before a call is spent, and the call is capped well under
  wp_remote_request()'s own 30-second default.
- **Figures served from cache are never presented as current**. The
  recorded refresh failure is read before a term-set status resolves, so a set
  standing over failed refreshes carries the cause with it, and the age of the last
  successful read decides whether the install health summary paints it as healthy —
  the age half of that judgement being the refresh policy's own freshness test,
  negated, with the recorded failure an additional reason that clock cannot see. The
  summary names which of the two it is, because figures read minutes ago whose
  refresh then failed are not out of date. Withholding is unaffected: a cached set
  still resolves and the method is still offered.
- **A key check that reached no verdict degrades nothing in the admin**.
  Only a definitive rejection blanks the Merchant ID and marks the key bad, and
  which verdicts those are is decided by the same predicate the gate uses, sent
  with the verdict rather than re-listed in the admin script. An unreachable API,
  a service error, an unexpected status or a request that never left the site
  leave the identity block and the key indicator exactly as they were, and say
  the check did not complete in a tone that is not an error colour. A green tick
  applies only to the key it was earned for.
- **The admin save stays possible whatever the verification says**. An
  unreachable API judges nothing about the key, and refusing the save locks the
  merchant out of storing the key that would fix the outage; the verdict is reported
  beside the save instead. A key Two rejected (401/403) is the one submitted value
  the save discards, and the message says the stored key was kept.
- The payment-terms type setting is rendered only for a merchant already set to end
  of month (TWO-25656); a merchant not on it is not offered it.
- **A stored custom term day the account does not offer never reaches a buyer**:
  the effective set is the configured terms narrowed to the offered
  list, the custom day included, and an unresolved list is unknown rather than
  empty so it narrows nothing. Refusing such a day at save time is deferred.
- **The preselected term prefers 30 days**: `get_default_term()`
  resolves the admin's stored default, the merchant's own default term, 30, and
  finally the shortest offered term, each only while it is in the offered set.
  An empty offered set has no default at all. The differential surcharge basis
  reads the same resolver, so the reference term it prices against moves with
  the preference.
- **Nothing but the admin puts a day count in `default_payment_term`.** The
  field's first option is Automatic, an empty value; the save validator stores
  empty for any posted default the offered set does not carry, except where
  that set is empty — an unresolved backend list, or a selection with nothing
  ticked, which the terms validator refuses — and it keeps whatever was stored
  rather than reading a set no merchant chose as a decision. The admin JS that rebuilds the
  select as terms are ticked re-creates that option and keeps only a selection
  still offered. Anything that synthesises a day count there instead is stored
  by the next save, becomes the resolver's first step, and makes every later
  step unreachable on that shop.
- **The merchant's own default term is 0 in its option row when the record
  carries none**, and the row written under the rule that stored 14 there is
  dropped once on upgrade — a shop whose record never resolves would otherwise
  keep reading a fabricated 14 as a real term. The record's freshness stamp is
  deliberately left alone: the admin's terms-state notice reads it, and
  dropping it reports a term set the shop holds as never fetched.
